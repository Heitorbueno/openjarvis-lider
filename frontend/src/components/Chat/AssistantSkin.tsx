import { useMemo, type CSSProperties } from 'react';
import { useTtsStore } from '../../lib/tts';
import type { JarvisSkin } from '../../lib/store';

interface Props {
  skin: JarvisSkin;
  compact?: boolean;
  preview?: boolean;
}

const PARTICLES = Array.from({ length: 56 }, (_, index) => {
  // Repeatable geometry, never rerandomize on audio frames.
  const theta = index * 2.399963229728653;
  const radius = Math.sqrt((index + 0.5) / 56) * 44;
  return {
    left: 50 + Math.cos(theta) * radius,
    top: 50 + Math.sin(theta) * radius * 0.83,
    size: index % 7 === 0 ? 3.6 : index % 3 === 0 ? 2.5 : 1.6,
    delay: (index % 17) * -0.27,
  };
});

const BARS = Array.from({ length: 21 }, (_, i) => i);

function HolographicFace() {
  return (
    <svg className="jarvis-hud-face" viewBox="0 0 260 275" aria-hidden="true">
      <defs>
        <linearGradient id="jarvis-face-tone" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#b6ffff" stopOpacity=".55" />
          <stop offset="54%" stopColor="#1e91ce" stopOpacity=".3" />
          <stop offset="100%" stopColor="#09436a" stopOpacity=".08" />
        </linearGradient>
      </defs>
      <path d="M45 241 Q62 224 86 218 L91 194 Q62 169 60 118 Q38 113 44 94 Q43 21 129 20 Q216 22 215 94 Q223 111 204 119 Q198 164 169 194 L174 217 Q195 223 216 241" fill="url(#jarvis-face-tone)" stroke="#49cfff" strokeWidth="1.8" />
      <path d="M58 106 Q49 34 128 27 Q207 30 201 106 Q199 71 172 66 Q124 86 75 58 Q65 78 58 106" fill="#0a558a" fillOpacity=".5" stroke="#80e9ff" strokeWidth="1.2" />
      <path d="M73 122 Q94 107 113 123 M145 123 Q165 106 188 123 M80 124 Q94 136 109 124 M151 124 Q166 135 181 124" fill="none" stroke="#aff9ff" strokeWidth="2" />
      <circle cx="94" cy="124" r="4.5" fill="#93faff" /><circle cx="166" cy="124" r="4.5" fill="#93faff" />
      <path d="M130 127 L123 163 Q132 167 142 163 M107 180 Q130 193 154 180 M116 183 Q129 179 144 183" fill="none" stroke="#a6edff" strokeWidth="1.4" />
      <path d="M69 139 Q76 196 116 202 M191 139 Q180 197 146 203 M128 26 V206" fill="none" stroke="#44deff" strokeOpacity=".3" strokeDasharray="3 6" />
      <path d="M47 246 H213 M56 256 H204" stroke="#49d4ff" strokeOpacity=".6" />
    </svg>
  );
}

function HolographicCloud() {
  return (
    <svg className="jarvis-hud-cloud" viewBox="0 0 280 194" aria-hidden="true">
      <defs>
        <radialGradient id="jarvis-cloud-tone"><stop stopColor="#a5ffff" stopOpacity=".44"/><stop offset="100%" stopColor="#0163a4" stopOpacity=".08"/></radialGradient>
      </defs>
      <path d="M63 144 Q18 139 24 104 Q28 73 66 72 Q79 25 135 27 Q193 28 203 75 Q245 72 256 111 Q267 152 223 156 H73 Q66 153 63 144Z" fill="url(#jarvis-cloud-tone)" stroke="#62e5ff" strokeWidth="3" />
      <path d="M68 141 H219" stroke="#9fffff" strokeWidth="1.5" strokeDasharray="5 6"/>
      <g className="jarvis-cloud-waveform">
        {BARS.map((n) => <rect key={n} x={61 + n * 8} y={100 - (n % 5) * 5} width="3.5" height={10 + (n % 5) * 10} rx="1.5" fill="#a0fbff" style={{ animationDelay: `${(n % 9) * -0.12}s` }} />)}
      </g>
    </svg>
  );
}

export function AssistantSkin({ skin, compact = false, preview = false }: Props) {
  const state = useTtsStore((s) => s.state);
  const level = useTtsStore((s) => s.audioLevel);
  const positions = useMemo(() => PARTICLES, []);
  const speaking = state === 'speaking' && !preview;
  const loading = state === 'loading' && !preview;
  const style = {
    '--voice-level': speaking ? Math.max(0.04, level).toFixed(3) : '0',
  } as CSSProperties;

  return (
    <div
      className={`jarvis-skin jarvis-skin--${skin} ${compact ? 'jarvis-skin--compact' : ''} ${preview ? 'jarvis-skin--preview' : ''} ${speaking ? 'jarvis-skin--speaking' : ''} ${loading ? 'jarvis-skin--loading' : ''}`}
      style={style}
      role={preview ? undefined : 'img'}
      aria-label={preview ? undefined : speaking ? 'Jarvis falando' : loading ? 'Preparando resposta em áudio' : 'Visual 3D do Jarvis'}
    >
      <div className="jarvis-skin__nebula" />
      <div className="jarvis-skin__rotor jarvis-skin__rotor--outer" />
      <div className="jarvis-skin__rotor jarvis-skin__rotor--middle" />
      <div className="jarvis-skin__rotor jarvis-skin__rotor--inner" />
      <div className="jarvis-skin__track jarvis-skin__track--a" />
      <div className="jarvis-skin__track jarvis-skin__track--b" />
      <div className="jarvis-skin__track jarvis-skin__track--c" />
      <div className="jarvis-skin__particles">
        {positions.map((p, i) => (
          <span key={i} className="jarvis-skin__particle" style={{
            left: `${p.left}%`, top: `${p.top}%`,
            width: p.size, height: p.size, animationDelay: `${p.delay}s`,
          }} />
        ))}
      </div>
      {skin === 'avatar' ? <HolographicFace /> : skin === 'cloud' ? <HolographicCloud /> : (
        <div className="jarvis-skin__core"><div className="jarvis-skin__core-highlight" /></div>
      )}
      <div className="jarvis-skin__audio-ring" />
      {!preview && <div className="jarvis-skin__state" aria-live="off">
        {speaking ? 'JARVIS FALANDO' : loading ? 'PREPARANDO VOZ' : 'JARVIS LÍDER'}
      </div>}
    </div>
  );
}
