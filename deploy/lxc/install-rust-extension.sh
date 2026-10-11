#!/usr/bin/env bash
# Install the native PyO3 security extension using the upstream dependency group.
# Run as root only inside the dedicated LXC. Preserves application data.
set -Eeuo pipefail
if (( EUID != 0 )); then echo "Execute como root dentro da LXC." >&2; exit 1; fi
if [[ "$(systemd-detect-virt --container 2>/dev/null || true)" != "lxc" ]]; then
  echo 'Recusado fora de LXC.' >&2; exit 1
fi
test -f /opt/openjarvis/pyproject.toml
test -x /opt/openjarvis/.venv/bin/python
apt-get update
apt-get install -y --no-install-recommends build-essential pkg-config libssl-dev ca-certificates curl
if ! runuser -u openjarvis -- env HOME=/home/openjarvis bash -lc 'export PATH="$HOME/.cargo/bin:$PATH"; command -v cargo >/dev/null'; then
  echo "Instalando Rust estável no HOME do usuário openjarvis..."
  runuser -u openjarvis -- env HOME=/home/openjarvis sh -c 'curl --proto "=https" --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal'
fi
echo "Sincronizando dependências desktop, voz e extensão nativa..."
runuser -u openjarvis -- env HOME=/home/openjarvis bash -c '
  set -Eeuo pipefail
  export PATH="$HOME/.cargo/bin:/usr/local/bin:$PATH"
  cd /opt/openjarvis
  uv sync --frozen --python 3.12 --extra desktop --extra voice --group desktop-native
  .venv/bin/python -c "import openjarvis_rust; print(\"PASS: openjarvis_rust importado\")"
'
systemctl restart openjarvis-lider.service
for i in $(seq 1 60); do
  if curl -fsS -m 3 http://127.0.0.1:8000/health >/dev/null 2>&1; then
    echo 'PASS: OpenJarvis respondeu /health apos restart.'
    exit 0
  fi
  sleep 2
done
journalctl -u openjarvis-lider --no-pager -n 60
echo 'ERRO: servidor não iniciou após instalar a extensão.' >&2
exit 1
