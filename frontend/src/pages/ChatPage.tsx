import { ChatArea } from '../components/Chat/ChatArea';
import { InputArea } from '../components/Chat/InputArea';
import { SystemPanel } from '../components/Chat/SystemPanel';
import { useAppStore } from '../lib/store';

export function ChatPage() {
  const systemPanelOpen = useAppStore((s) => s.systemPanelOpen);
  const immersiveMode = useAppStore((s) => s.settings.immersiveMode);

  if (immersiveMode) return <InputArea immersive />;

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 min-w-0">
        <ChatArea />
      </div>
      {systemPanelOpen && <SystemPanel />}
    </div>
  );
}
