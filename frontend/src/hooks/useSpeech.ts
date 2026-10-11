import { useState, useCallback, useRef, useEffect } from 'react';
import { transcribeAudio, fetchSpeechHealth } from '../lib/api';
import { encodeSpeechWav, MAX_SPEECH_RECORDING_SECONDS, validRecordedContainer } from '../lib/speech-wav';

export type SpeechState = 'idle' | 'recording' | 'transcribing';

type PcmCapture = {
  kind: 'pcm';
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  silentOutput: GainNode;
  chunks: Float32Array[];
  sampleCount: number;
  tooLong: boolean;
};

type ContainerCapture = {
  kind: 'container';
  stream: MediaStream;
  recorder: MediaRecorder;
  chunks: Blob[];
  done: Promise<void>;
};

type Capture = PcmCapture | ContainerCapture;

const MIN_RECORDING_MS = 450;

function releaseCapture(capture: Capture): void {
  if (capture.kind === 'pcm') {
    capture.processor.onaudioprocess = null;
    capture.source.disconnect();
    capture.processor.disconnect();
    capture.silentOutput.disconnect();
    void capture.context.close().catch(() => {});
  } else if (capture.recorder.state !== 'inactive') {
    capture.recorder.ondataavailable = null;
    capture.recorder.onstop = null;
    capture.recorder.onerror = null;
    capture.recorder.stop();
  }
  capture.stream.getTracks().forEach(track => track.stop());
}

/** Record actual mono samples and encode as a complete WAV.
 *
 * WebM MediaRecorder chunks can fail on short recordings, yielding the
 * ffmpeg/PyAV "End of file" error. PCM capture avoids containers entirely.
 * MediaRecorder remains a fallback only for browsers without Web Audio.
 */
export function useSpeech(locale: 'pt-BR' | 'en-US' = 'pt-BR') {
  const [state, setState] = useState<SpeechState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState(false);
  const captureRef = useRef<Capture | null>(null);
  const statusRef = useRef<'idle' | 'starting' | 'recording' | 'transcribing'>('idle');
  const startedAt = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    fetchSpeechHealth().then(result => {
      if (mounted.current) setAvailable(result.available);
    }).catch(() => {
      if (mounted.current) setAvailable(false);
    });
    return () => {
      mounted.current = false;
      const active = captureRef.current;
      captureRef.current = null;
      if (active) releaseCapture(active);
      statusRef.current = 'idle';
    };
  }, []);

  const startRecording = useCallback(async (): Promise<void> => {
    if (statusRef.current !== 'idle') return;
    statusRef.current = 'starting';
    setError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      statusRef.current = 'idle';
      setError('Este navegador não permite acesso ao microfone.');
      return;
    }
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (!mounted.current || statusRef.current !== 'starting') {
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      // Prefer PCM for reliable mono WAV upload. Requires an audible browser
      // processing graph, but the output gain is ZERO to prevent local echo.
      if (typeof AudioContext !== 'undefined') {
        context = new AudioContext();
        if (context.createScriptProcessor) {
          const source = context.createMediaStreamSource(stream);
          const processor = context.createScriptProcessor(4096, 1, 1);
          const silentOutput = context.createGain();
          silentOutput.gain.value = 0;
          const pcm: PcmCapture = {
            kind: 'pcm', stream, context, source, processor, silentOutput,
            chunks: [], sampleCount: 0, tooLong: false,
          };
          processor.onaudioprocess = event => {
            if (captureRef.current !== pcm) return;
            const channel = event.inputBuffer.getChannelData(0);
            if (pcm.sampleCount + channel.length > context!.sampleRate * MAX_SPEECH_RECORDING_SECONDS) {
              pcm.tooLong = true;
              return;
            }
            pcm.chunks.push(new Float32Array(channel));
            pcm.sampleCount += channel.length;
          };
          source.connect(processor);
          processor.connect(silentOutput);
          silentOutput.connect(context.destination);
          await context.resume();
          captureRef.current = pcm;
          context = null; // ownership transferred to pcm
        } else {
          await context.close();
          context = null;
        }
      }

      if (!captureRef.current) {
        if (typeof MediaRecorder === 'undefined') throw new Error('Gravação de áudio não suportada neste navegador.');
        const formats = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
        const preferred = formats.find(type => MediaRecorder.isTypeSupported(type));
        const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
        const chunks: Blob[] = [];
        let resolveDone!: () => void;
        let rejectDone!: (reason?: unknown) => void;
        const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
        recorder.ondataavailable = event => { if (event.data.size > 0) chunks.push(event.data); };
        recorder.onstop = () => resolveDone();
        recorder.onerror = () => rejectDone(new Error('O navegador falhou ao finalizar a gravação.'));
        recorder.start();
        captureRef.current = { kind: 'container', stream, recorder, chunks, done };
      }
      startedAt.current = performance.now();
      statusRef.current = 'recording';
      if (mounted.current) setState('recording');
    } catch (err) {
      if (context) void context.close().catch(() => {});
      if (captureRef.current) { releaseCapture(captureRef.current); captureRef.current = null; }
      stream?.getTracks().forEach(track => track.stop());
      statusRef.current = 'idle';
      if (mounted.current) {
        setState('idle');
        setError(err instanceof Error ? err.message : 'Não foi possível iniciar o microfone.');
      }
    }
  }, []);

  const stopRecording = useCallback(async (): Promise<string> => {
    if (statusRef.current !== 'recording' || !captureRef.current) {
      throw new Error('O microfone não está gravando.');
    }
    const active = captureRef.current;
    const elapsed = performance.now() - startedAt.current;
    statusRef.current = 'transcribing';
    if (mounted.current) setState('transcribing');
    try {
      if (elapsed < MIN_RECORDING_MS) {
        throw new Error('Gravação muito curta. Fale durante pelo menos um segundo antes de finalizar.');
      }
      let blob: Blob;
      let filename = 'recording.wav';
      if (active.kind === 'pcm') {
        // Detach from the audio graph before encoding: all buffers are complete.
        active.processor.onaudioprocess = null;
        blob = encodeSpeechWav(active.chunks, active.context.sampleRate);
        if (active.tooLong) throw new Error('Gravação longa demais. Limite: 75 segundos.');
      } else {
        active.recorder.stop();
        await active.done;
        const mime = active.recorder.mimeType || active.chunks[0]?.type || '';
        blob = new Blob(active.chunks, { type: mime });
        if (!(await validRecordedContainer(blob, mime))) {
          throw new Error('A gravação ficou incompleta. Tente novamente ou utilize outro navegador.');
        }
        filename = /mp4|m4a/i.test(mime) ? 'recording.m4a'
          : /ogg/i.test(mime) ? 'recording.ogg' : 'recording.webm';
      }
      // No empty, header-only or tiny compressed streams go to Whisper.
      if (blob.size < 1024) throw new Error('Nenhum áudio válido foi capturado. Verifique seu microfone.');
      releaseCapture(active);
      captureRef.current = null;
      const result = await transcribeAudio(blob, filename, locale === 'pt-BR' ? 'pt' : 'en');
      if (!result.text?.trim()) throw new Error('Nenhuma fala identificada. Fale mais perto do microfone.');
      return result.text.trim();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha na transcrição de voz.';
      if (mounted.current) setError(message);
      throw err;
    } finally {
      if (captureRef.current === active) {
        releaseCapture(active);
        captureRef.current = null;
      }
      statusRef.current = 'idle';
      if (mounted.current) setState('idle');
    }
  }, [locale]);

  return {
    state, error, available,
    startRecording, stopRecording,
    isRecording: state === 'recording',
    isTranscribing: state === 'transcribing',
  };
}
