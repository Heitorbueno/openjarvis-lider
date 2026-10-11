# JARVIS LÍDER — CONTINUIDADE TÉCNICA / GOAL

**Estado do trabalho em 11/10/2026.** Documento para retomar em qualquer nova conversa sem reconstruir o histórico. Atualizar a cada release. **Não contém chaves.**

## Ambiente e rota de produção

- Host: `bot@crmlider`; LXC: `jarvis` (Ubuntu 24.04; limite de RAM ~6 GiB).
- Código instalado: `/opt/openjarvis`; Python: `/opt/openjarvis/.venv`; serviço: `openjarvis-lider.service`.
- URL privada via Tailscale Serve (não Funnel): `https://jarvis-crmlider.tail136d61.ts.net/`.
- Ollama local: `qwen3.5:2b-q4_K_M`. PWA hospedado por `jarvis serve`, 127.0.0.1:8000.
- STT: `faster-whisper`, idioma `pt`; TTS: `kokoro`, voz `pf_dora`.
- Chave interna no guest: `/etc/openjarvis/openjarvis.env` — **não publicar valores**; requisição /v1 sem chave deve retornar 401.
- Última release **confirmada implantada**: `0d11d56cdbbc52ed5bf96a3e36eb0c0d35258e39` (PWA + rota de clima).
- Backup de rollback dessa versão: static `/opt/openjarvis/src/openjarvis/server/.static-before-weather-20261011T212208Z`; rotas `/opt/openjarvis/src/openjarvis/server/.api-routes-before-weather-20261011T212208Z.py`.
- Smoke da release de clima já passou: Open-Meteo Cuiabá 12/10/2026 máxima 34,9 °C / mínima 23,1 °C; health 200, manifest 200, sem chave 401.

## P0 — agente funcional ponta a ponta

1. **Microfone (bug confirmado):** gravação de fala no PWA retornou `Speech transcription failed: [Errno 541478725] End of file ... .webm`. O backend/PyAV tentou decodificar WebM inválido ou truncado. Branch `fix/jarvis-microphone-wav-ptbr` troca a captura principal por PCM real -> WAV 16 kHz mono com header completo, rejeita gravações vazias/curtas, valida containers no fallback, não envia áudio inválido ao backend; testes específicos estão na branch. **Não afirmar correção em produção sem teste do usuário.**
2. **Idioma:** Whisper recebe `language=pt` para pt-BR, `en` para inglês; arquivo MP4 do Safari respeitado.
3. **Resposta falada:** Kokoro local já gerou WAV HTTP 200 (`pf_dora`) via smoke; navegador e autoplay ainda precisam ser confirmados. TTS é disparado ao completar a mensagem, e seu analisador de amplitude alimenta a skin. Checar autoplay bloqueado pela política do navegador, estados e erros em Settings.
4. **Desempenho:** Qwen 2B local registrou ~15–45 s por resposta; medir separadamente gravação, transcrição, TTFT inferência, síntese e player. Não otimizar aleatoriamente sem medições; garantir fallback da nuvem só após autorização.
5. **Clima:** endpoint autenticado Open-Meteo já foi implantado; reconhecer perguntas explícitas para previsão de amanhã com cidade. Teste ao vivo pela skin e áudio ainda pendente.
6. **Segurança:** `openjarvis_rust` ausente no primeiro teste (rate limiter não inicializou); ver scripts em `deploy/lxc/install-rust-extension.sh`. A API key foi exposta anteriormente em material compartilhado: rotacionar com procedimento controlado e atualizar o navegador. CI `npm audit` identifica 13 vulnerabilidades (4 low, 8 high, 1 critical). Nunca desativar auditoria para simular aprovação.

### Teste de aceitação obrigatório

No PWA privado, selecionar `Configurações > Aparência > Skin / Skill > Orbital Core`, verificar `Speech-to-Text`, `Text-to-Speech`, `Speak replies automatically`. Reabrir PWA/service worker após deploy, permitir microfone; falar **“Jarvis, qual será a temperatura amanhã em Cuiabá?”**, aguardar pelo menos 1 segundo, tocar novamente. Confirmar:
- fala transcrita em pt-BR (sem árabe/inglês);
- solicitação de previsão respondida com data, temperaturas e fonte Open-Meteo;
- resposta realmente audível no navegador (não só o teste de Kokoro);
- skin pulsa em sincronia com WAV;
- latência detalhada e ausência de erros no console;
- teste em desktop e celular.

## P1 — provedores de IA

- A interface Tauri possui chaves para OpenAI/Anthropic/Google; no **PWA** `saveCloudKey` ainda rejeita (`desktop only`).
- Implementar armazenamento seguro de chaves no backend (não em `localStorage`), validação, listagem dinâmica de modelos via API oficial; seletor no chat clássico e na skin. Prever custo por provedor e fallback opt-in.
- Ollama continua local, nunca expor 11434.

## P2 — voz personalizada

- ElevenLabs: token seguro, listagem de modelos e vozes, geração e streaming TTS.
- Clonagem da **própria** voz mediante consentimento, upload de gravações válidas, exclusão e retenção claras.
- Skin compartilha analisador Web Audio independentemente do motor TTS.

## P3 — UI avançada / widgets / novas skills

- Separar **Skin** (HUD visual) de **Skill** (capacidade funcional).
- Widgets interativos contextuais: clima, horários, gráficos financeiros/CRM e resumos, sem interromper modo imersivo.
- Ferramentas futuras: busca web verificável, calendário, documentos, GitHub, diagnóstico de servidores com permissões mínimas.
- Skins disponíveis: Orbital, Nebula, Avatar Holográfico, Cloud Voice. Modo imersivo remove laterais, toque para ouvir, dock de texto recolhível, CSS 3D/SVG reativo ao áudio (não é animação facial WebGL).

## Repositório / PRs / implantação

- Repositório: `Heitorbueno/openjarvis-lider`.
- PR #1: skins pt-BR + imersivo; PR #2: reparos transcrição/autoplay; PR #3: clima Open-Meteo. Histórico empilhado.
- Branch atual P0: `fix/jarvis-microphone-wav-ptbr`, **baseada em `0d11d56...`**, para não apagar o endpoint de clima.
- Script desta correção: `deploy/lxc/release-microphone.sh`, instala **somente** os estáticos do PWA com SHA fixo e backup/rollback. Não mexe em backend.
- Regra: validar `npm test`, `tsc --noEmit`, `npm run build` no GitHub Actions; `npm audit` é etapa separada e continua sinalizando pendências. Testar no PWA real depois do deploy antes de declarar aceitação.
- O container pode ter uma árvore de código sem `.git`. **Nunca exigir `git -C /opt/openjarvis diff`** sem verificar repositório. Na release weather houve falha por isso; instalador novo corrigido no commit `0d11d56...` fez inserção aditiva.
- Não enviar valores de chaves/token, nem fazer deploy ou migrations sem snapshot e rollback.

### Frase para retomar em novo chat

> Continue o /goal do Jarvis Líder a partir do documento `docs/JARVIS_LIDER_CONTINUIDADE_2026-10-11.md` no GitHub `Heitorbueno/openjarvis-lider`. O P0 é resolver erro de WebM EOF, validação de gravação WAV, fala pt-BR, TTS/skin, desempenho; depois integrações de IA/ElevenLabs e widgets. Consulte o HEAD e testes da branch mais recente, sem repetir etapas anteriores.
