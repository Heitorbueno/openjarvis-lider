#!/usr/bin/env bash
# OpenJarvis LXC guest bootstrap, Ubuntu 24.04.
# Executar apenas dentro da LXC dedicada; nao no host nem na LXC "jarvis".
set -Eeuo pipefail
trap 'echo "[ERRO] Linha $LINENO: instalacao interrompida, sem apagar dados." >&2' ERR

if (( EUID != 0 )); then echo "Execute como root na LXC dedicada." >&2; exit 1; fi
# Impede execucao acidental no host LXD, que tambem pode estar com root.
VIRT="$(systemd-detect-virt --container 2>/dev/null || true)"
if [[ "$VIRT" != "lxc" ]]; then
  echo "Recusado: rode este bootstrap DENTRO de uma LXC. Detectado: ${VIRT:-host}" >&2
  exit 1
fi
. /etc/os-release
if [[ "$ID" != "ubuntu" || ! "$VERSION_ID" =~ ^(22[.]04|24[.]04)$ ]]; then
  echo "Ubuntu 22.04 ou 24.04 necessario; detectado: $PRETTY_NAME" >&2
  exit 1
fi
MODEL="${MODEL:-qwen3.5:2b}"
if [[ ! "$MODEL" =~ ^[a-zA-Z0-9._:-]+$ ]]; then echo "MODEL invalido" >&2; exit 1; fi
export DEBIAN_FRONTEND=noninteractive

echo "===== DEPENDENCIAS UBUNTU ====="
apt-get update
apt-get install -y ca-certificates curl git gnupg build-essential pkg-config   python3 ffmpeg espeak-ng libsndfile1 portaudio19-dev libffi-dev libssl-dev

echo "===== NODE.JS >=22.22 / NPM 11.19 ====="
if ! command -v node >/dev/null 2>&1 || ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22 || (a===22 && b>=22) ? 0:1)'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
npm install -g npm@11.19.0
node --version; npm --version

echo "===== UV ====="
if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh
fi
uv --version

echo "===== OLLAMA (SOMENTE LOCAL) ====="
if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL https://ollama.com/install.sh | sh
fi
systemctl enable --now ollama
# Manter a API do Ollama limitada a loopback; nunca expor 11434 via Tailscale Serve.
if ! systemctl is-active --quiet ollama; then
  echo "Ollama nao iniciou; veja journalctl -u ollama -n 100." >&2; exit 1
fi
ollama pull "$MODEL"

echo "===== USUARIO DE SERVICO E CODIGO DO FORK ====="
if ! id -u openjarvis >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /home/openjarvis --shell /bin/bash openjarvis
fi
install -d -o openjarvis -g openjarvis -m 0755 /opt/openjarvis
if [[ ! -d /opt/openjarvis/.git ]]; then
  if [[ -n "$(ls -A /opt/openjarvis)" ]]; then echo "/opt/openjarvis ocupado, recusando sobrescrever." >&2; exit 1; fi
  runuser -u openjarvis -- git clone --depth 1 --branch main https://github.com/Heitorbueno/openjarvis-lider.git /opt/openjarvis
fi
if ! runuser -u openjarvis -- git -C /opt/openjarvis remote get-url upstream >/dev/null 2>&1; then
  runuser -u openjarvis -- git -C /opt/openjarvis remote add upstream https://github.com/open-jarvis/OpenJarvis.git
fi

echo "===== PYTHON 3.12 / VOZ / PWA ====="
runuser -u openjarvis -- env HOME=/home/openjarvis MODEL="$MODEL" bash -c '
  set -Eeuo pipefail
  cd /opt/openjarvis
  uv python install 3.12
  uv sync --frozen --python 3.12 --extra desktop --extra voice
  cd frontend
  npm ci --no-audit --no-fund
  npm run build
  test -e ../src/openjarvis/server/static/manifest.webmanifest
  cd ..
  .venv/bin/jarvis _bootstrap --write-config --engine ollama --model "$MODEL"
  .venv/bin/jarvis config set security.profile personal
  .venv/bin/jarvis config set speech.voice_id pf_dora
  .venv/bin/jarvis config set speech.language pt
  .venv/bin/jarvis config set speech.device cpu
  .venv/bin/jarvis config set speech.compute_type int8
  .venv/bin/python - <<"PY"
from pathlib import Path
import tomlkit
p = Path.home() / ".openjarvis" / "config.toml"
doc = tomlkit.parse(p.read_text(encoding="utf-8"))
# O bootstrap habilita shell_exec/file_read; manter fora do ambiente remoto inicial.
if "tools" not in doc:
    doc["tools"] = tomlkit.table()
doc["tools"]["enabled"] = ["think", "calculator", "web_search"]
p.write_text(tomlkit.dumps(doc), encoding="utf-8")
PY
'

echo "===== CHAVE DE API / SERVICO SYSTEMD ====="
install -d -m 0700 /etc/openjarvis
if [[ ! -f /etc/openjarvis/openjarvis.env ]]; then
  KEY="$(python3 -c 'import secrets; print("oj_sk_"+secrets.token_urlsafe(32))')"
  printf 'OPENJARVIS_API_KEY=%s\n' "$KEY" > /etc/openjarvis/openjarvis.env
  chmod 0600 /etc/openjarvis/openjarvis.env
  unset KEY
fi
cat >/etc/systemd/system/openjarvis-lider.service <<EOF
[Unit]
Description=OpenJarvis Lider - PWA e API locais
After=network-online.target ollama.service
Wants=network-online.target
Requires=ollama.service

[Service]
Type=simple
User=openjarvis
Group=openjarvis
WorkingDirectory=/opt/openjarvis
Environment=HOME=/home/openjarvis
Environment=PYTHONUNBUFFERED=1
EnvironmentFile=/etc/openjarvis/openjarvis.env
ExecStart=/opt/openjarvis/.venv/bin/jarvis serve --host 127.0.0.1 --port 8000 --engine ollama --model $MODEL --agent simple
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
UMask=0077
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now openjarvis-lider.service

echo "===== VERIFICACOES ====="
READY=0
for i in $(seq 1 45); do
  if curl -fsS -m 3 http://127.0.0.1:8000/health >/dev/null; then READY=1; break; fi
  sleep 2
done
if (( READY == 0 )); then
  journalctl -u openjarvis-lider --no-pager -n 90
  echo "Health nao respondeu; servico precisa de diagnostico." >&2
  exit 1
fi
test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/v1/models)" = "401"
curl -fsS -m 10 http://127.0.0.1:8000/manifest.webmanifest >/dev/null
systemctl --no-pager --full status openjarvis-lider.service | head -n 16 || true
echo "PASS: API 127.0.0.1:8000, 401 sem chave, PWA entregue. Tailscale ainda exige login."
echo "Chave de API: sudo cat /etc/openjarvis/openjarvis.env (na LXC, nao publique o valor)."
