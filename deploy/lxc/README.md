# OpenJarvis Líder — instalação em LXC privada com PWA

Projeto-base: [open-jarvis/OpenJarvis](https://github.com/open-jarvis/OpenJarvis).
Fork de desenvolvimento: [Heitorbueno/openjarvis-lider](https://github.com/Heitorbueno/openjarvis-lider).
Ambiente: host LXD **lider**; nova LXC **openjarvis-lider**; **não** reutilizar a LXC atual `jarvis`.

## Arquitetura

```text
iPhone / notebook / desktop (Tailscale ligado, HTTPS)
       |
       v
Tailscale Serve (somente Tailnet; nunca Funnel)
       |
       v
LXC openjarvis-lider, Ubuntu 24.04
  127.0.0.1:8000  OpenJarvis (API + PWA estático)
  127.0.0.1:11434 Ollama (Gemma 4 CPU)
  systemd: openjarvis-lider, ollama, tailscaled
  ~/.openjarvis     configuração, sessões e perfis
```

A interface web usa o microfone **do dispositivo cliente** (MediaRecorder/getUserMedia),
envia o áudio para transcrição via API e pode receber áudio de volta por Kokoro.
O microfone físico da máquina host NÃO é repassado para a LXC.
Permissão de microfone no navegador requer contexto seguro (HTTPS) e aprovação do usuário.

## Instalar no host LXD

Abra terminal SSH do host `lider` com acesso ao comando `lxc`.

```bash
cd ~
git clone https://github.com/Heitorbueno/openjarvis-lider.git openjarvis-lider-src
cd openjarvis-lider-src
bash deploy/lxc/provision-host.sh
```

Padrão: LXC nova com 8 vCPU compartilhadas, limite de 16 GiB RAM,
modelo `qwen3.5:2b-q4_K_M` (quantizado para CPU) e nome `openjarvis-lider`.
O download dos modelos e dependências pode consumir vários gigabytes.
Verifique espaço disponível antes de executar; **não apague nenhuma outra LXC**.

Personalizar recursos antes da execução, se necessário:

```bash
NAME=openjarvis-lider CPU=8 MEMORY=16GiB MODEL=qwen3.5:2b-q4_K_M bash deploy/lxc/provision-host.sh
```

O script interrompe se o nome da LXC já existir; nunca recria nem deleta automaticamente.

## Ativar acesso privado pela Tailnet

Depois de a instalação terminar, no terminal do host:

```bash
lxc exec openjarvis-lider -- tailscale up --hostname=openjarvis-lider
```

Acesse a URL de autenticação exibida, usando a Tailnet existente.
Não divulgue auth keys.

```bash
lxc exec openjarvis-lider -- tailscale serve --bg http://127.0.0.1:8000
lxc exec openjarvis-lider -- tailscale serve status
lxc exec openjarvis-lider -- tailscale ip -4
```

O último `serve status` mostra a URL **real** de HTTPS para abrir no celular/desktop.
É necessário que os dispositivos também estejam conectados ao Tailscale e
que o recurso HTTPS esteja habilitado na Tailnet. Não usar `tailscale funnel`.

## Autenticação do OpenJarvis

Além da restrição por Tailscale, o backend usa `OPENJARVIS_API_KEY`.
A chave única foi gerada localmente, fora do Git:

```bash
lxc exec openjarvis-lider -- cat /etc/openjarvis/openjarvis.env
```

Cadastre o valor da chave de API em **Settings** da interface web
(campo de API Key do OpenJarvis, não em um commit).
O front-end envia `Authorization: Bearer ...` em requisições privadas.
Sem chave, a API deve responder **401**. Trate a chave como senha.
A página principal pode carregar antes da configuração da chave.

## Instalar o PWA

- **Android/Chrome:** abrir HTTPS da Tailnet → menu ⋮ → `Instalar app`.
- **iPhone/Safari:** abrir HTTPS da Tailnet → Compartilhar → `Adicionar à Tela de Início`.
- **Windows/Chrome ou Edge:** abrir HTTPS da Tailnet → `Instalar aplicativo` na barra/menu.

O PWA é uma interface, **não** copia o Ollama para o celular.
Para conversar, é necessário que a LXC e a conexão Tailscale estejam acessíveis.
Microfone e reprodução de áudio precisam de permissões no próprio dispositivo.

## Verificar serviço, API, modelo e PWA

```bash
lxc exec openjarvis-lider -- systemctl is-active openjarvis-lider
lxc exec openjarvis-lider -- systemctl is-active ollama
lxc exec openjarvis-lider -- curl -fsS http://127.0.0.1:8000/health
lxc exec openjarvis-lider -- curl -I http://127.0.0.1:8000/manifest.webmanifest
lxc exec openjarvis-lider -- ollama list
lxc exec openjarvis-lider -- journalctl -u openjarvis-lider --no-pager -n 80
```

Comandos úteis:

```bash
lxc exec openjarvis-lider -- runuser -u openjarvis -- env HOME=/home/openjarvis /opt/openjarvis/.venv/bin/jarvis doctor
lxc exec openjarvis-lider -- runuser -u openjarvis -- env HOME=/home/openjarvis /opt/openjarvis/.venv/bin/jarvis ask "Responda em português: quem é você?"
lxc exec openjarvis-lider -- systemctl restart openjarvis-lider
```

## Comandos essenciais captados da página de referência

O artigo usa `git clone https://github.com/open-jarvis/OpenJarvis jarvis`,
`uv sync --extra desktop --extra voice`, `ollama pull gemma4:e4b`,
`uv run jarvis _bootstrap --write-config --engine ollama --model gemma4:e4b`,
`uv run jarvis config set security.profile personal`,
`uv run jarvis config set speech.voice_id pf_dora`,
`uv run jarvis config set speech.language pt`,
`cd frontend && npm install && npm run build`, `uv run jarvis start`,
`uv run jarvis doctor`, `uv run jarvis ask "..." ` e
`uv run jarvis chat --voice`.

Para servidor Linux persistente, a instalação acima usa **systemd + `jarvis serve`**
em vez de um daemon interativo ou Vite development server.

`jarvis-show` (duas palmas + jingle) **não é nativo do upstream**.
Detecção por palmas precisa ser implementada **no navegador**
para usar o microfone de iPhone/desktop; um detector de palmas na LXC não
ouve automaticamente o dispositivo remoto.

## Segurança e evolução

- Sem Cloudflare, portas públicas ou Funnel.
- Restrição inicial das ferramentas do agente: apenas `think`, `calculator`, `web_search`.
  O bootstrap upstream pode ligar `shell_exec` por padrão; não habilitar execução remota
  sem política explícita de permissões, confirmação e auditoria.
- Não commitar `.env`, chaves de API, dados do usuário, diretórios de modelos ou `~/.openjarvis`.
- O fork mantém remote `upstream` para receber atualizações oficiais.
- Fazer melhorias em branches de feature e integrar por PR, após testes.
- Testes reais de microfone, áudio pt-BR e PWA em iOS/Windows precisam
  ser feitos com a LXC no ar; o material nesta pasta não afirma deploy efetuado.

Fonte do roteiro: https://posts.curtasolucoes.com.br/entregaveis/jarvis.html#prompt

## LXC já existente (servidor crmlider)

Quando a LXC **jarvis** já existe no servidor **crmlider**, **não use** `provision-host.sh` (ele cria outra LXC). Entre na LXC pelo host:

```bash
lxc exec jarvis -- bash
```

Verifique primeiro a rede, pois houve falha de acesso a `github.com:443` no host anterior. A rede do novo container deve ser testada separadamente:

```bash
getent ahostsv4 github.com | head -3
ip -4 route
curl -4 -IL --max-time 12 https://github.com
curl -4 -IL --max-time 12 https://raw.githubusercontent.com
```

Somente se o HTTPS funcionar e o container for Ubuntu 24.04 limpo, instale o projeto **dentro** da LXC existente:

```bash
curl -4 -fLSs --retry 3 \
  https://raw.githubusercontent.com/Heitorbueno/openjarvis-lider/main/deploy/lxc/bootstrap-guest.sh \
  -o /root/bootstrap-openjarvis-lider.sh
bash /root/bootstrap-openjarvis-lider.sh
```

O bootstrap usa o fork GitHub como código-fonte, compila o PWA, instala um Ollama próprio,
cria `openjarvis-lider.service` e gera uma chave privada de API no guest.
Ele **não** cria ou apaga containers e não instala Tailscale automaticamente.
Não execute sobre LXC que tenha instalação ou dados do Jarvis antigo.

Para configurar o acesso privado, ainda no guest:

```bash
curl -fsSL https://tailscale.com/install.sh | bash
systemctl enable --now tailscaled
tailscale up --hostname=jarvis-crmlider
tailscale serve --bg http://127.0.0.1:8000
tailscale serve status
```

Caso `/dev/net/tun` não exista no guest, volte ao host `crmlider` e adicione
TUN apenas ao container `jarvis` (verifique antes se o device já existe):

```bash
lxc config device add jarvis tailscale-tun unix-char path=/dev/net/tun
lxc restart jarvis
lxc exec jarvis -- bash
```

O acesso permanece privado à Tailnet; **não** usar Funnel.
