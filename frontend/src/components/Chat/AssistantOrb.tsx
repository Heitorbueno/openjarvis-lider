/**
 * Lightweight perspective / CSS-3D status orb for the private Jarvis PWA.
 * No WebGL dependency, mic access, background network activity or tracking.
 */
export function AssistantOrb() {
  return (
    <div className="jarvis-orb-scene" aria-hidden="true">
      <div className="jarvis-orb-glow" />
      <div className="jarvis-orb-core" />
      <div className="jarvis-orb-ring jarvis-orb-ring-a" />
      <div className="jarvis-orb-ring jarvis-orb-ring-b" />
      <div className="jarvis-orb-ring jarvis-orb-ring-c" />
      <div className="jarvis-orb-dot" />
    </div>
  );
}
