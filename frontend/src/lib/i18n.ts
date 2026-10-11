/**
 * UI strings for the Jarvis Líder PWA.
 * Localization is client-side only; no translation service or outgoing network request.
 */
export type AppLanguage = 'pt-BR' | 'en-US';

const strings = {
  "navChat": {
    "en-US": "Chat",
    "pt-BR": "Conversas"
  },
  "navDashboard": {
    "en-US": "Dashboard",
    "pt-BR": "Painel"
  },
  "navSources": {
    "en-US": "Data Sources",
    "pt-BR": "Fontes de dados"
  },
  "navAgents": {
    "en-US": "Agents",
    "pt-BR": "Agentes"
  },
  "navLogs": {
    "en-US": "Logs",
    "pt-BR": "Registros"
  },
  "navSettings": {
    "en-US": "Settings",
    "pt-BR": "Configurações"
  },
  "navStart": {
    "en-US": "Get Started",
    "pt-BR": "Primeiros passos"
  },
  "newChat": {
    "en-US": "New chat",
    "pt-BR": "Nova conversa"
  },
  "searchChats": {
    "en-US": "Search chats...",
    "pt-BR": "Buscar conversas..."
  },
  "selectModel": {
    "en-US": "Select model",
    "pt-BR": "Selecionar modelo"
  },
  "loadingModel": {
    "en-US": "Loading model...",
    "pt-BR": "Carregando modelo..."
  },
  "deepResearch": {
    "en-US": "Deep Research",
    "pt-BR": "Pesquisa profunda"
  },
  "backendOffline": {
    "en-US": "Cannot reach OpenJarvis backend",
    "pt-BR": "Não foi possível acessar o servidor OpenJarvis"
  },
  "changeUrl": {
    "en-US": "Change URL",
    "pt-BR": "Alterar endereço"
  },
  "settingsIntro": {
    "en-US": "App preferences — appearance, model defaults, keyboard shortcuts, and data management.",
    "pt-BR": "Preferências do aplicativo: aparência, modelos, atalhos e gerenciamento de dados."
  },
  "saved": {
    "en-US": "Saved",
    "pt-BR": "Salvo"
  },
  "appearance": {
    "en-US": "Appearance",
    "pt-BR": "Aparência"
  },
  "theme": {
    "en-US": "Theme",
    "pt-BR": "Tema"
  },
  "themeHelp": {
    "en-US": "Choose how OpenJarvis looks",
    "pt-BR": "Escolha a aparência do OpenJarvis"
  },
  "fontSize": {
    "en-US": "Font size",
    "pt-BR": "Tamanho da fonte"
  },
  "small": {
    "en-US": "Small",
    "pt-BR": "Pequeno"
  },
  "normal": {
    "en-US": "Default",
    "pt-BR": "Padrão"
  },
  "large": {
    "en-US": "Large",
    "pt-BR": "Grande"
  },
  "language": {
    "en-US": "Language",
    "pt-BR": "Idioma"
  },
  "languageHelp": {
    "en-US": "Choose the language of the interface",
    "pt-BR": "Escolha o idioma da interface"
  },
  "ui3d": {
    "en-US": "3D visual effects",
    "pt-BR": "Efeitos visuais 3D"
  },
  "ui3dHelp": {
    "en-US": "Show the animated assistant orb (respects reduced motion)",
    "pt-BR": "Exibir o orbe animado do assistente (respeita movimento reduzido)"
  },
  "connection": {
    "en-US": "Connection",
    "pt-BR": "Conexão"
  },
  "serverStatus": {
    "en-US": "Server status",
    "pt-BR": "Estado do servidor"
  },
  "notConnected": {
    "en-US": "Not connected",
    "pt-BR": "Não conectado"
  },
  "connected": {
    "en-US": "Connected",
    "pt-BR": "Conectado"
  },
  "disconnected": {
    "en-US": "Disconnected",
    "pt-BR": "Desconectado"
  },
  "checking": {
    "en-US": "Checking...",
    "pt-BR": "Verificando..."
  },
  "apiUrl": {
    "en-US": "API URL",
    "pt-BR": "Endereço da API"
  },
  "apiUrlHelp": {
    "en-US": "Set if backend runs on a different port or host",
    "pt-BR": "Defina caso a API esteja em outra porta ou servidor"
  },
  "apiKey": {
    "en-US": "API key",
    "pt-BR": "Chave da API"
  },
  "apiKeyHelp": {
    "en-US": "Required only if the server was started with an API key",
    "pt-BR": "Obrigatória quando o servidor exige autenticação"
  },
  "inferenceSource": {
    "en-US": "Inference source",
    "pt-BR": "Origem da inferência"
  },
  "models": {
    "en-US": "Models",
    "pt-BR": "Modelos"
  },
  "apiKeys": {
    "en-US": "API Keys",
    "pt-BR": "Chaves de provedores"
  },
  "tools": {
    "en-US": "Tools",
    "pt-BR": "Ferramentas"
  },
  "memory": {
    "en-US": "Memory",
    "pt-BR": "Memória"
  },
  "defaults": {
    "en-US": "Model Defaults",
    "pt-BR": "Parâmetros do modelo"
  },
  "speech": {
    "en-US": "Speech",
    "pt-BR": "Voz"
  },
  "data": {
    "en-US": "Data",
    "pt-BR": "Dados"
  },
  "updates": {
    "en-US": "Updates",
    "pt-BR": "Atualizações"
  },
  "about": {
    "en-US": "About",
    "pt-BR": "Sobre"
  },
  "stt": {
    "en-US": "Speech-to-Text",
    "pt-BR": "Reconhecimento de voz"
  },
  "sttHelp": {
    "en-US": "Enable microphone input for voice dictation",
    "pt-BR": "Habilitar microfone para ditar mensagens"
  },
  "tts": {
    "en-US": "Text-to-Speech",
    "pt-BR": "Resposta falada"
  },
  "ttsHelp": {
    "en-US": "Show a read-aloud button on assistant replies",
    "pt-BR": "Exibir botão para ouvir as respostas do assistente"
  },
  "autoplay": {
    "en-US": "Speak replies automatically",
    "pt-BR": "Falar respostas automaticamente"
  },
  "autoplayHelp": {
    "en-US": "Read every assistant reply aloud as soon as it finishes",
    "pt-BR": "Reproduzir a resposta falada ao término de cada mensagem"
  },
  "voice": {
    "en-US": "Voice",
    "pt-BR": "Voz"
  },
  "voiceHelp": {
    "en-US": "Backend and voice used for spoken replies",
    "pt-BR": "Motor e voz das respostas faladas"
  },
  "voiceBackend": {
    "en-US": "Backend status",
    "pt-BR": "Estado do motor de voz"
  },
  "greetingMorning": {
    "en-US": "Good morning",
    "pt-BR": "Bom dia"
  },
  "greetingAfternoon": {
    "en-US": "Good afternoon",
    "pt-BR": "Boa tarde"
  },
  "greetingEvening": {
    "en-US": "Good evening",
    "pt-BR": "Boa noite"
  },
  "askAnything": {
    "en-US": "Ask anything. Your AI runs locally — private, fast, and always available.",
    "pt-BR": "Pergunte o que quiser. Sua IA funciona localmente, com privacidade e acesso pela sua rede."
  },
  "connectSources": {
    "en-US": "Connect Data Sources",
    "pt-BR": "Conectar fontes"
  },
  "connectSourcesIntro": {
    "en-US": "Connect your data sources (Gmail, iMessage, Slack, etc.) to get personalized answers.",
    "pt-BR": "Conecte fontes como Gmail e Slack para receber respostas personalizadas."
  },
  "connect": {
    "en-US": "Connect",
    "pt-BR": "Conectar"
  },
  "hideSystem": {
    "en-US": "Hide system panel",
    "pt-BR": "Ocultar painel do sistema"
  },
  "showSystem": {
    "en-US": "Show system panel",
    "pt-BR": "Exibir painel do sistema"
  },
  "messagePlaceholder": {
    "en-US": "Message OpenJarvis...",
    "pt-BR": "Escreva para o Jarvis Líder..."
  },
  "pickModel": {
    "en-US": "Pick a model first (⌘K)...",
    "pt-BR": "Escolha um modelo primeiro (Ctrl/⌘ K)..."
  },
  "sendMessage": {
    "en-US": "Send message",
    "pt-BR": "Enviar mensagem"
  },
  "stopGenerating": {
    "en-US": "Stop generating",
    "pt-BR": "Parar resposta"
  },
  "researchOn": {
    "en-US": "Deep Research: on",
    "pt-BR": "Pesquisa profunda: ativada"
  },
  "researchOff": {
    "en-US": "Deep Research: off",
    "pt-BR": "Pesquisa profunda: desativada"
  },
  "micEnable": {
    "en-US": "Enable in Settings",
    "pt-BR": "Ative nas configurações"
  },
  "micMissing": {
    "en-US": "Speech backend not configured",
    "pt-BR": "Reconhecimento de voz indisponível"
  },
  "micWait": {
    "en-US": "Wait for response",
    "pt-BR": "Aguarde a resposta"
  },
  "micStop": {
    "en-US": "Stop recording",
    "pt-BR": "Parar gravação"
  },
  "micTranscribing": {
    "en-US": "Transcribing...",
    "pt-BR": "Transcrevendo..."
  },
  "micInput": {
    "en-US": "Voice input",
    "pt-BR": "Entrada por voz"
  }
} as const;

export type TranslationKey = keyof typeof strings;

export function t(language: AppLanguage, key: TranslationKey): string {
  return strings[key][language];
}
