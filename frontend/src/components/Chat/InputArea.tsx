import { useState, useRef, useCallback, useEffect } from 'react';
import { Send, Square, Paperclip, Search, Keyboard, Settings2, PanelLeftOpen, Mic, Volume2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { AssistantSkin } from './AssistantSkin';
import './immersive.css';
import { useTtsStore, shouldAutoplayFinishedReply, unlockVoicePlayback } from '../../lib/tts';
import { speakCompletedReply } from '../../lib/voice-autoplay';
import { getTomorrowWeatherCity, getTomorrowForecast, describeTomorrowForecast } from '../../lib/weather-forecast';
import { stripThinkTags } from '../../lib/message-text';
import { toast } from 'sonner';
import { useAppStore, generateId } from '../../lib/store';
import { streamChat, streamResearch } from '../../lib/sse';
import { fetchSavings, getBase } from '../../lib/api';
import { listConnectors, getSyncStatus } from '../../lib/connectors-api';
import { serializeToolCallArguments } from '../../lib/tool-call';
import {
  engineFromCompletionChunk,
  resolveChatEngine,
} from '../../lib/chat-telemetry';
import { MicButton } from './MicButton';
import { useSpeech } from '../../hooks/useSpeech';
import { t } from '../../lib/i18n';
import type {
  ChatMessage,
  MessageTelemetry,
  ResearchSearchTrace,
  ResearchSource,
  TokenUsage,
  ToolCallInfo,
} from '../../types';

// While Deep Research is toggled on, poll connected sources for sync
// progress so we can surface "Searching over N items — sync in progress"
// next to the toggle. Polling is gated on `enabled` so toggling DR off
// stops the network chatter immediately.
function useResearchCorpusSync(enabled: boolean): {
  syncing: boolean;
  itemsSynced: number;
} {
  const [state, setState] = useState({ syncing: false, itemsSynced: 0 });

  useEffect(() => {
    if (!enabled) {
      setState({ syncing: false, itemsSynced: 0 });
      return;
    }
    let cancelled = false;

    const poll = async () => {
      try {
        const list = await listConnectors();
        const connected = list.filter((c) => c.connected);
        if (connected.length === 0) {
          if (!cancelled) setState({ syncing: false, itemsSynced: 0 });
          return;
        }
        const results = await Promise.all(
          connected.map(async (c) => {
            try {
              return await getSyncStatus(c.connector_id);
            } catch {
              return null;
            }
          }),
        );
        let syncing = false;
        let itemsSynced = 0;
        for (const r of results) {
          if (!r) continue;
          if (r.state === 'syncing') syncing = true;
          itemsSynced += r.items_synced ?? 0;
        }
        if (!cancelled) setState({ syncing, itemsSynced });
      } catch {
        // Network blip — leave previous state intact.
      }
    };

    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled]);

  return state;
}

export function InputArea({ immersive = false }: { immersive?: boolean } = {}) {
  const navigate = useNavigate();
  const [composerOpen, setComposerOpen] = useState(false);
  const voiceSubmitPending = useRef(false);
  const lastStreamingId = useRef<string | null>(null);
  const ttsState = useTtsStore((s) => s.state);
  const ttsError = useTtsStore((s) => s.error);
  const ttsAvailable = useTtsStore((s) => s.available);
  const voiceAutoplay = useAppStore((s) => s.settings.voiceAutoplay);
  const voiceOutputEnabled = useAppStore((s) => s.settings.voiceOutputEnabled);
  const jarvisSkin = useAppStore((s) => s.settings.jarvisSkin);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const activeId = useAppStore((s) => s.activeId);
  const language = useAppStore((s) => s.settings.language);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const streamState = useAppStore((s) => s.streamState);
  const messages = useAppStore((s) => s.messages);
  const speechEnabled = useAppStore((s) => s.settings.speechEnabled);
  const maxTokens = useAppStore((s) => s.settings.maxTokens);
  const temperature = useAppStore((s) => s.settings.temperature);
  const createConversation = useAppStore((s) => s.createConversation);
  const addMessage = useAppStore((s) => s.addMessage);
  const updateLastAssistant = useAppStore((s) => s.updateLastAssistant);
  const setStreamState = useAppStore((s) => s.setStreamState);
  const resetStream = useAppStore((s) => s.resetStream);
  const modelLoading = useAppStore((s) => s.modelLoading);
  const deepResearch = useAppStore((s) => s.deepResearch);
  const setDeepResearch = useAppStore((s) => s.setDeepResearch);
  const corpusSync = useResearchCorpusSync(deepResearch);
  const isCurrentChatStreaming = streamState.isStreaming && streamState.conversationId === activeId;

  const {
    state: speechState,
    error: speechError,
    available: speechAvailable,
    startRecording,
    stopRecording,
  } = useSpeech(language);

  // Abort in-flight stream when the user switches models mid-generation.
  // This prevents errors from trying to continue a stream with a stale model.
  const prevModelRef = useRef(selectedModel);
  useEffect(() => {
    if (prevModelRef.current !== selectedModel && streamState.isStreaming) {
      abortRef.current?.abort();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      resetStream();
      abortRef.current = null;
    }
    prevModelRef.current = selectedModel;
  }, [selectedModel, streamState.isStreaming, resetStream]);

  const micDisabled = !speechEnabled || !speechAvailable || streamState.isStreaming;
  const micReason: 'not-enabled' | 'no-backend' | 'streaming' | undefined =
    !speechEnabled ? 'not-enabled'
    : !speechAvailable ? 'no-backend'
    : streamState.isStreaming ? 'streaming'
    : undefined;

  useEffect(() => {
    if (speechError) {
      toast.error(speechError, { duration: 8000 });
    }
  }, [speechError]);

  const handleMicClick = useCallback(async () => {
    unlockVoicePlayback();
    if (speechState === 'recording') {
      try {
        const text = await stopRecording();
        if (text) {
          if (immersive) {
            voiceSubmitPending.current = true;
            setInput(text);
          } else {
            setInput((prev) => (prev ? prev + ' ' + text : text));
          }
        }
      } catch {
        // Error is captured in useSpeech
      }
    } else if (speechAvailable && speechEnabled) {
      useTtsStore.getState().stop(); // Avoid feeding synthesized speech into microphone.
      await startRecording();
    } else {
      toast.error(language === 'pt-BR' ? 'Microfone indisponível. Verifique Voz em Configurações e o serviço Whisper.' : 'Microphone unavailable. Check Speech settings and Whisper backend.');
    }
  }, [speechState, startRecording, stopRecording, immersive, speechAvailable, speechEnabled, language]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [input]);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    resetStream();
  }, [resetStream]);

  const sendMessage = useCallback(async () => {
    unlockVoicePlayback();
    const content = input.trim();
    if (!content || streamState.isStreaming) return;
    if (!selectedModel) {
      toast.error('Pick a model first (⌘K)');
      return;
    }

    setInput('');

    let convId = activeId;
    if (!convId) {
      convId = createConversation(selectedModel);
    }

    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: Date.now(),
    };
    addMessage(convId, userMsg);

    // Build API messages before adding assistant placeholder
    const currentMessages = useAppStore.getState().messages;
    const dialog = currentMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    // STT is fixed to the selected language; keep the model output in that
    // same language even when previous conversation turns were multilingual.
    // This is a response-language preference, not a web-search capability.
    const uiLanguage = useAppStore.getState().settings.language;
    const replyMaxTokens = immersive ? Math.min(maxTokens, 360) : maxTokens;
    const apiMessages = [
      {
        role: 'system',
        content: uiLanguage === 'pt-BR'
          ? 'Responda sempre em português brasileiro (pt-BR), de maneira natural. Não traduza a pergunta para outro idioma. Se precisar de informação atual e não houver ferramenta confiável, admita isso sem inventar dados.' + (immersive ? ' Em conversação por voz, responda objetivamente em até três frases, salvo quando o usuário pedir detalhes.' : '')
          : 'Answer in English (en-US). Do not switch languages without user request. Never invent live data when no current source is available.',
      },
      ...dialog,
    ];

    const assistantMsg: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isResearch: deepResearch || undefined,
    };
    addMessage(convId, assistantMsg);

    // Start streaming
    const startTime = Date.now();
    const timer = setInterval(() => {
      setStreamState({ elapsedMs: Date.now() - startTime });
    }, 100);
    timerRef.current = timer;

    const controller = new AbortController();
    abortRef.current = controller;

    let accumulatedContent = '';
    let usage: TokenUsage | undefined;
    let complexity: { score: number; tier: string; suggested_max_tokens: number } | undefined;
    let routedEngine: string | undefined;
    const toolCalls: ToolCallInfo[] = [];
    const researchTraces: ResearchSearchTrace[] = [];
    const researchSourcesByRef = new Map<number, ResearchSource>();
    const flushSources = () =>
      Array.from(researchSourcesByRef.values()).sort((a, b) => a.ref - b.ref);
    let lastFlush = 0;
    let ttftMs: number | undefined;

    setStreamState({
      conversationId: convId,
      isStreaming: true,
      phase: deepResearch ? 'Researching...' : 'Generating...',
      elapsedMs: 0,
      activeToolCalls: [],
      content: '',
    });
    useAppStore.getState().addLogEntry({
      timestamp: Date.now(),
      level: 'info',
      category: 'chat',
      message: deepResearch
        ? `Research: "${content.slice(0, 80)}${content.length > 80 ? '...' : ''}"`
        : `Request: "${content.slice(0, 80)}${content.length > 80 ? '...' : ''}" → ${selectedModel}`,
    });

    try {
      // Deterministic weather skill: the 2B local model does not need to
      // invent forecasts or call a tool via unreliable multi-step prompting.
      const tomorrowCity = !deepResearch ? getTomorrowWeatherCity(content) : null;
      if (tomorrowCity) {
        setStreamState({ phase: 'Consultando Open-Meteo...' });
        const forecast = await getTomorrowForecast(tomorrowCity, controller.signal);
        accumulatedContent = describeTomorrowForecast(forecast, uiLanguage);
        setStreamState({ phase: '', content: accumulatedContent });
      } else if (deepResearch) {
        for await (const ev of streamResearch(
          content,
          selectedModel,
          controller.signal,
        )) {
          if (ev.type === 'search_call') {
            const trace: ResearchSearchTrace = {
              id: generateId(),
              query: ev.arguments?.query ?? '',
              person: ev.arguments?.person,
              timeRange: ev.arguments?.time_range,
              status: 'pending',
            };
            researchTraces.push(trace);
            setStreamState({ phase: `Searching: ${trace.query}` });
            updateLastAssistant(
              convId,
              accumulatedContent,
              undefined,
              undefined,
              undefined,
              undefined,
              [...researchTraces],
              flushSources(),
            );
            useAppStore.getState().addLogEntry({
              timestamp: Date.now(),
              level: 'info',
              category: 'tool',
              message: `Search: "${trace.query}"${trace.person ? ` (person: ${trace.person})` : ''}`,
            });
          } else if (ev.type === 'search_result') {
            const pending = [...researchTraces].reverse().find((t) => t.status === 'pending');
            if (pending) {
              pending.status = 'complete';
              pending.numHits = ev.num_hits;
              pending.topTitles = ev.top_titles;
            }
            if (ev.sources) {
              for (const src of ev.sources) {
                if (src && typeof src.ref === 'number' && !researchSourcesByRef.has(src.ref)) {
                  researchSourcesByRef.set(src.ref, src);
                }
              }
            }
            updateLastAssistant(
              convId,
              accumulatedContent,
              undefined,
              undefined,
              undefined,
              undefined,
              [...researchTraces],
              flushSources(),
            );
          } else if (ev.type === 'synthesis') {
            if (!ttftMs) ttftMs = Date.now() - startTime;
            accumulatedContent += ev.text;
            setStreamState({ content: accumulatedContent, phase: '' });
            const now = Date.now();
            if (now - lastFlush >= 80) {
              updateLastAssistant(
                convId,
                accumulatedContent,
                undefined,
                undefined,
                undefined,
                undefined,
                [...researchTraces],
                flushSources(),
              );
              lastFlush = now;
            }
          } else if (ev.type === 'system_metrics') {
            // Live GPU sample — feed straight to the System panel so Power
            // (W) and Energy (kJ) tick up in real time as the agent runs.
            useAppStore.getState().setLiveEnergy({
              power_w: ev.power_w,
              energy_j: ev.energy_j,
              duration_s: ev.duration_s,
            });
          } else if (ev.type === 'error') {
            // Backend setup/worker failure (Ollama down, planner model
            // missing, KnowledgeStore locked, etc.). Without surfacing the
            // message, the user sees only the generic "No response was
            // generated" fallback and has no way to self-diagnose.
            const msg = ev.message || 'Research failed (no detail provided)';
            accumulatedContent = accumulatedContent
              ? `${accumulatedContent}\n\n**Research stopped:** ${msg}`
              : `**Research failed:** ${msg}`;
            setStreamState({ content: accumulatedContent, phase: '' });
            useAppStore.getState().addLogEntry({
              timestamp: Date.now(),
              level: 'error',
              category: 'chat',
              message: `Deep Research error: ${msg}`,
            });
            toast.error(msg, { duration: 8000 });
          } else if (ev.type === 'done') {
            if (ev.usage) {
              usage = {
                prompt_tokens: ev.usage.prompt_tokens ?? 0,
                completion_tokens: ev.usage.completion_tokens ?? 0,
                total_tokens:
                  ev.usage.total_tokens ??
                  (ev.usage.prompt_tokens ?? 0) +
                    (ev.usage.completion_tokens ?? 0),
              };
              // Optimistically roll this research turn into the session
              // counters so the Session panel updates the moment the
              // stream finishes, regardless of how /v1/savings aggregates
              // research telemetry server-side.
              useAppStore.getState().incrementSavings(usage);
            }
            // Hold the final live numbers visible for a beat so the panel
            // doesn't flash to 0 between the SSE close and the next
            // /v1/telemetry/energy poll picking up the persisted record.
            window.setTimeout(() => {
              useAppStore.getState().setLiveEnergy(null);
            }, 1500);
            break;
          }
        }
      } else {
      for await (const sseEvent of streamChat(
        { model: selectedModel, messages: apiMessages, stream: true, temperature, max_tokens: replyMaxTokens },
        controller.signal,
      )) {
        const eventName = sseEvent.event;

        if (eventName === 'agent_turn_start') {
          setStreamState({ phase: 'Agent thinking...' });
        } else if (eventName === 'inference_start') {
          setStreamState({ phase: 'Generating...' });
          useAppStore.getState().addLogEntry({
            timestamp: Date.now(), level: 'info', category: 'chat',
            message: `Generating with ${selectedModel}...`,
          });
        } else if (eventName === 'tool_call_start') {
          try {
            const data = JSON.parse(sseEvent.data);
            const tc: ToolCallInfo = {
              id: generateId(),
              tool: data.tool,
              arguments: serializeToolCallArguments(data.arguments),
              status: 'running',
            };
            toolCalls.push(tc);
            setStreamState({
              phase: `Calling ${data.tool}...`,
              activeToolCalls: [...toolCalls],
            });
            updateLastAssistant(convId, accumulatedContent, [...toolCalls]);
            useAppStore.getState().addLogEntry({
              timestamp: Date.now(), level: 'info', category: 'tool',
              message: `Calling ${data.tool}(${serializeToolCallArguments(data.arguments)})`,
            });
          } catch {}
        } else if (eventName === 'tool_call_end') {
          try {
            const data = JSON.parse(sseEvent.data);
            const tc = toolCalls.find(
              (t) => t.tool === data.tool && t.status === 'running',
            );
            if (tc) {
              tc.status = data.success ? 'success' : 'error';
              tc.latency = data.latency;
              tc.result = data.result;
            }
            setStreamState({
              phase: 'Generating...',
              activeToolCalls: [...toolCalls],
            });
            updateLastAssistant(convId, accumulatedContent, [...toolCalls]);
          } catch {}
        } else {
          try {
            const data = JSON.parse(sseEvent.data);
            const delta = data.choices?.[0]?.delta;
            if (data.usage) usage = data.usage;
            if (data.complexity) complexity = data.complexity;
            routedEngine = engineFromCompletionChunk(data) ?? routedEngine;
            if (delta?.content) {
              if (!ttftMs) ttftMs = Date.now() - startTime;
              accumulatedContent += delta.content;
              setStreamState({ content: accumulatedContent, phase: '' });

              const now = Date.now();
              if (now - lastFlush >= 80) {
                updateLastAssistant(
                  convId,
                  accumulatedContent,
                  toolCalls.length > 0 ? [...toolCalls] : undefined,
                );
                lastFlush = now;
              }
            }
            if (data.choices?.[0]?.finish_reason === 'stop') break;
          } catch {}
        }
      }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // User cancelled or model switch — keep whatever was accumulated
        if (!accumulatedContent) accumulatedContent = '(Generation stopped)';
      } else {
        const errMsg = err?.message || String(err);
        accumulatedContent =
          accumulatedContent || `Error: ${errMsg}`;
        useAppStore.getState().addLogEntry({
          timestamp: Date.now(), level: 'error', category: 'chat',
          message: `Stream error: ${errMsg}`,
        });
      }
      // If we tore out mid-research, make sure the live System panel
      // numbers don't get stuck on the last sample.
      useAppStore.getState().setLiveEnergy(null);
    } finally {
      if (!accumulatedContent) {
        accumulatedContent = 'No response was generated. Please try again.';
      }
      const totalMs = Date.now() - startTime;
      const appState = useAppStore.getState();
      const selectedOwner = appState.models.find((m) => m.id === selectedModel)?.owned_by;
      const engineLabel = resolveChatEngine({
        routedEngine,
        serverEngine: appState.serverInfo?.engine,
        selectedModel,
        selectedOwner,
      });
      const telemetry: MessageTelemetry = {
        engine: engineLabel,
        model_id: selectedModel,
        total_ms: totalMs,
        ttft_ms: ttftMs,
        tokens_per_sec: usage?.completion_tokens
          ? usage.completion_tokens / (totalMs / 1000)
          : undefined,
        complexity_score: complexity?.score,
        complexity_tier: complexity?.tier,
        suggested_max_tokens: complexity?.suggested_max_tokens,
      };
      // Check if the response has digest audio available
      let audioMeta: { url: string } | undefined;
      try {
        const digestRes = await fetch(`${getBase()}/api/digest`);
        if (digestRes.ok) {
          const digest = await digestRes.json();
          if (digest.audio_available) {
            audioMeta = { url: `${getBase()}/api/digest/audio` };
          }
        }
      } catch {
        // Not a digest response or server unavailable — skip
      }

      updateLastAssistant(
        convId,
        accumulatedContent,
        toolCalls.length > 0 ? toolCalls : undefined,
        usage,
        telemetry,
        audioMeta,
        researchTraces.length > 0 ? researchTraces : undefined,
        researchSourcesByRef.size > 0 ? flushSources() : undefined,
      );
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      resetStream();
      // Durable completion event. Relying solely on a React falling-edge
      // misses autoplay in fast streams or batched state transitions.
      // The helper is idempotent with the existing ChatArea effect.
      void speakCompletedReply(convId, assistantMsg.id);
      useAppStore.getState().addLogEntry({
        timestamp: Date.now(), level: 'info', category: 'chat',
        message: `Response: ${accumulatedContent.length} chars`,
      });
      abortRef.current = null;

      // Research path updates session counters optimistically from the
      // `done` event's usage payload — re-fetching here would overwrite
      // it with a potentially stale snapshot if the server's research
      // telemetry hasn't been merged into /v1/savings yet.
      if (!deepResearch) {
        fetchSavings()
          .then((data) => useAppStore.getState().setSavings(data))
          .catch(() => {});
      }
    }
  }, [
    input,
    activeId,
    selectedModel,
    streamState.isStreaming,
    createConversation,
    addMessage,
    updateLastAssistant,
    setStreamState,
    resetStream,
    deepResearch,
    temperature,
    maxTokens,
  ]);

  // Immersive mode reuses the existing authenticated SSE conversation pipeline.
  // Speech transcription sets the same input state used by text entry, then
  // dispatches it once React has rendered the new value.
  useEffect(() => {
    if (!immersive || !voiceSubmitPending.current || !input.trim()) return;
    if (streamState.isStreaming) return;
    voiceSubmitPending.current = false;
    void sendMessage();
  }, [immersive, input, sendMessage, streamState.isStreaming]);

  // ChatArea normally owns TTS autoplay, but it is not mounted while immersive.
  useEffect(() => {
    if (!immersive) return;
    const last = messages[messages.length - 1];
    const tts = useTtsStore.getState();
    const done = shouldAutoplayFinishedReply(
      lastStreamingId.current, activeId, isCurrentChatStreaming,
      last, tts.autoSpokenId,
    );
    lastStreamingId.current = isCurrentChatStreaming ? activeId : null;
    if (!done || !voiceAutoplay || !voiceOutputEnabled || !last?.content) return;
    const id = last.id;
    const conv = activeId;
    void tts.ensureHealth().then(() => {
      const app = useAppStore.getState();
      const current = useTtsStore.getState();
      if (app.activeId !== conv || app.streamState.isStreaming || current.available !== true) return;
      if (current.autoSpokenId === id || app.messages[app.messages.length - 1]?.id !== id) return;
      const text = stripThinkTags(last.content);
      if (!text || /^Error:|^No response was generated/i.test(text)) return;
      current.markAutoSpoken(id);
      void current.speak(id, text);
    });
  }, [immersive, messages, activeId, isCurrentChatStreaming, voiceAutoplay, voiceOutputEnabled]);

  useEffect(() => {
    if (immersive && voiceOutputEnabled) void useTtsStore.getState().ensureHealth();
  }, [immersive, voiceOutputEnabled]);

  const currentAssistant = [...messages].reverse().find((m) => m.role === 'assistant' && m.content.trim());
  const visualStatus = speechState === 'recording' ? (language === 'pt-BR' ? 'Ouvindo — toque para enviar' : 'Listening — tap to send')
    : speechState === 'transcribing' ? (language === 'pt-BR' ? 'Transcrevendo áudio...' : 'Transcribing audio...')
    : ttsState === 'loading' ? (language === 'pt-BR' ? 'Preparando resposta falada...' : 'Preparing speech...')
    : ttsState === 'speaking' ? (language === 'pt-BR' ? 'Respondendo em áudio' : 'Speaking response')
    : isCurrentChatStreaming ? (language === 'pt-BR' ? 'Processando resposta...' : 'Processing response...')
    : language === 'pt-BR' ? 'Toque no núcleo para falar' : 'Tap the core to speak';

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (immersive) {
    return (
      <section className="jarvis-immersive" aria-label={language === 'pt-BR' ? 'Assistente por voz' : 'Voice assistant'}>
        <header className="jarvis-immersive__header">
          <div className="jarvis-immersive__brand"><span className="jarvis-immersive__badge" aria-hidden="true">◉</span><strong>Jarvis Líder</strong></div>
          <div className="jarvis-immersive__actions">
            <span className="jarvis-immersive__connection" title={selectedModel || ''}>● {language === 'pt-BR' ? 'Privado' : 'Private'}</span>
            <button type="button" onClick={() => { updateSettings({ immersiveMode: false }); }} title={language === 'pt-BR' ? 'Abrir interface clássica' : 'Classic interface'} aria-label={language === 'pt-BR' ? 'Abrir interface clássica' : 'Classic interface'}><PanelLeftOpen size={18} /></button>
            <button type="button" onClick={() => navigate('/settings')} title={t(language, 'navSettings')} aria-label={t(language, 'navSettings')}><Settings2 size={19} /></button>
          </div>
        </header>
        <div className="jarvis-immersive__stage" onClick={(event) => {
          if ((event.target as HTMLElement).closest('button, a, textarea, input, select')) return;
          if (!isCurrentChatStreaming && speechState !== 'transcribing') void handleMicClick();
        }}>
          <button
            type="button"
            className="jarvis-immersive__skin-button"
            aria-label={speechState === 'recording' ? (language === 'pt-BR' ? 'Encerrar gravação' : 'Stop recording') : (language === 'pt-BR' ? 'Iniciar gravação' : 'Start recording')}
            onClick={() => { if (!isCurrentChatStreaming && speechState !== 'transcribing') void handleMicClick(); }}
            disabled={isCurrentChatStreaming || speechState === 'transcribing'}
          >
            <AssistantSkin skin={jarvisSkin} />
          </button>
          <div className="jarvis-immersive__status" role="status" aria-live="polite">{visualStatus}</div>
          <div className="jarvis-immersive__subtitle" aria-live="polite">
            {isCurrentChatStreaming ? (streamState.content || streamState.phase || '...').slice(-240)
              : currentAssistant ? stripThinkTags(currentAssistant.content).slice(0, 240)
              : language === 'pt-BR' ? 'Sua inteligência artificial local e privada.' : 'Your local, private artificial intelligence.'}
          </div>
          {ttsError && <p className="jarvis-immersive__error" role="alert">{ttsError}</p>}
          {!speechAvailable && <p className="jarvis-immersive__error">
            {language === 'pt-BR' ? 'Reconhecimento de voz indisponível: verifique o Whisper em Configurações.' : 'Voice recognition unavailable: check Whisper in Settings.'}
          </p>}
          {ttsAvailable === false && <p className="jarvis-immersive__error">
            {language === 'pt-BR' ? 'Voz de resposta indisponível: verifique o Kokoro.' : 'Speech synthesis unavailable: check Kokoro.'}
          </p>}
          <div className="jarvis-immersive__controls">
            <button type="button" className="jarvis-immersive__small-btn" onClick={() => {
              setComposerOpen((value) => !value);
              requestAnimationFrame(() => textareaRef.current?.focus());
            }} aria-label={language === 'pt-BR' ? 'Abrir campo de texto' : 'Open text input'} aria-expanded={composerOpen}><Keyboard size={21} /></button>
            <button type="button" className={`jarvis-immersive__mic ${speechState === 'recording' ? 'jarvis-immersive__mic--on' : ''}`}
              onClick={() => { if (!isCurrentChatStreaming && speechState !== 'transcribing') void handleMicClick(); }}
              aria-label={speechState === 'recording' ? 'Finalizar fala' : 'Toque para falar'}
              disabled={isCurrentChatStreaming || speechState === 'transcribing'}
            ><Mic size={30}/></button>
            <button type="button" className="jarvis-immersive__small-btn"
              onClick={() => {
                if (ttsState === 'speaking' || ttsState === 'loading') useTtsStore.getState().stop();
                else if (currentAssistant) void useTtsStore.getState().speak(currentAssistant.id, stripThinkTags(currentAssistant.content));
              }}
              disabled={!currentAssistant}
              aria-label={language === 'pt-BR' ? 'Ouvir resposta novamente ou parar' : 'Play or stop voice'}
            ><Volume2 size={21}/></button>
          </div>
          {composerOpen && <div className="jarvis-immersive__composer">
            <textarea ref={textareaRef} value={input} rows={2} onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isCurrentChatStreaming || modelLoading}
              placeholder={t(language, selectedModel ? 'messagePlaceholder' : 'pickModel')} />
            {isCurrentChatStreaming ? <button type="button" onClick={stopStreaming} aria-label={t(language, 'stopGenerating')}><Square size={19} /></button> :
              <button type="button" disabled={!input.trim() || modelLoading || !selectedModel}
                onClick={() => { void sendMessage(); setComposerOpen(false); }}
                aria-label={t(language, 'sendMessage')}><Send size={20} /></button>}
          </div>}
          <p className="jarvis-immersive__hint">
            {speechState === 'recording'
              ? (language === 'pt-BR' ? 'Toque novamente para transcrever e enviar' : 'Tap again to transcribe and send')
              : (language === 'pt-BR' ? 'Toque para falar · teclado para escrever' : 'Tap to speak · keyboard to type')}
          </p>
        </div>
      </section>
    );
  }

  return (
    <div className="px-4 pb-4 pt-2" style={{ maxWidth: 'var(--chat-max-width)', margin: '0 auto', width: '100%' }}>
      <div className="mb-2 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDeepResearch(!deepResearch)}
            disabled={streamState.isStreaming}
            aria-pressed={deepResearch}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-colors cursor-pointer disabled:cursor-default disabled:opacity-50"
            style={{
              background: deepResearch ? 'var(--color-accent-subtle)' : 'transparent',
              border: `1px solid ${deepResearch ? 'var(--color-accent)' : 'var(--color-border)'}`,
              color: deepResearch ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
            }}
            title={t(language, deepResearch ? 'researchOn' : 'researchOff')}
          >
            <Search size={12} />
            {t(language, 'deepResearch')}
          </button>
        </div>
        {deepResearch && corpusSync.syncing && corpusSync.itemsSynced > 0 && (
          <div
            className="text-[11px] leading-snug"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            Searching over{' '}
            <span key={corpusSync.itemsSynced} className="sync-bump" style={{ color: 'var(--color-text-secondary)' }}>
              {corpusSync.itemsSynced.toLocaleString()}
            </span>{' '}
            items — sync in progress, results will improve as more data is indexed.
          </div>
        )}
      </div>
      <div
        className="flex items-center gap-2 rounded-2xl px-4 py-3 transition-shadow"
        style={{
          background: 'var(--color-input-bg)',
          border: '1px solid var(--color-input-border)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t(language, selectedModel ? 'messagePlaceholder' : 'pickModel')}
          rows={1}
          className="flex-1 bg-transparent outline-none resize-none text-sm leading-relaxed"
          style={{ color: 'var(--color-text)', maxHeight: '200px' }}
          disabled={streamState.isStreaming || modelLoading}
        />
        {isCurrentChatStreaming ? (
          <button
            onClick={stopStreaming}
            className="p-2 rounded-xl transition-colors shrink-0 cursor-pointer"
            style={{ background: 'var(--color-error)', color: 'var(--color-on-accent)' }}
            title={t(language, "stopGenerating")}
          >
            <Square size={16} />
          </button>
        ) : (
          <div className="flex items-center gap-1">
            <MicButton
              state={speechState}
              onClick={handleMicClick}
              disabled={micDisabled}
              reason={micReason}
            />
            <button
              onClick={sendMessage}
              disabled={streamState.isStreaming || !input.trim() || modelLoading || !selectedModel}
              title={t(language, selectedModel ? 'sendMessage' : 'pickModel')}
              className="p-2 rounded-xl transition-colors shrink-0 cursor-pointer disabled:opacity-30 disabled:cursor-default"
              style={{
                background: input.trim() ? 'var(--color-accent)' : 'var(--color-bg-tertiary)',
                color: input.trim() ? 'white' : 'var(--color-text-tertiary)',
              }}
            >
              <Send size={16} />
            </button>
          </div>
        )}
      </div>
      <div className="flex items-center justify-center mt-2 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
        <span>
          <kbd className="font-mono">Enter</kbd> to send &middot;{' '}
          <kbd className="font-mono">Shift+Enter</kbd> for new line
        </span>
      </div>
    </div>
  );
}
