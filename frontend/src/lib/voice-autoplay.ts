import { useAppStore } from './store';
import { stripThinkTags } from './message-text';
import { useTtsStore } from './tts';

/**
 * A completed assistant reply must be queued from the conversation runner,
 * not only from a React useEffect falling-edge. React can batch the streaming
 * state transitions, particularly during fast replies and PWA re-mounts.
 *
 * This routine is idempotent across the classic and immersive modes. It never
 * speaks old conversation history and checks that the user hasn't switched
 * conversations while Kokoro's health probe was loading.
 */
export async function speakCompletedReply(
  conversationId: string,
  messageId: string,
): Promise<boolean> {
  const shouldSpeak = () => {
    const app = useAppStore.getState();
    if (!app.settings.voiceAutoplay || !app.settings.voiceOutputEnabled) return false;
    if (app.activeId !== conversationId || app.streamState.isStreaming) return false;
    const latest = app.messages[app.messages.length - 1];
    return latest?.id === messageId && latest.role === 'assistant';
  };

  if (!shouldSpeak()) return false;
  await useTtsStore.getState().ensureHealth();
  const voice = useTtsStore.getState();
  if (voice.available !== true || voice.autoSpokenId === messageId || !shouldSpeak()) return false;

  const currentMessages = useAppStore.getState().messages;
  const latest = currentMessages[currentMessages.length - 1];
  const content = stripThinkTags(latest?.content || '').trim();
  if (!content || /^(Error:|No response was generated|Erro:)/i.test(content)) return false;

  // Claim synchronously before triggering the async synthesize/playback path.
  voice.markAutoSpoken(messageId);
  void voice.speak(messageId, content);
  return true;
}
