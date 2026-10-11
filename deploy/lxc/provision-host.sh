#!/usr/bin/env bash
# Executar no host LXD "lider" (nao dentro da LXC "jarvis").
set -Eeuo pipefail
trap 'echo "[ERRO] Linha $LINENO; a LXC existente nao sera removida automaticamente." >&2' ERR
NAME="${NAME:-openjarvis-lider}"
MODEL="${MODEL:-qwen3.5:2b-q4_K_M}"
CPU="${CPU:-8}"
MEMORY="${MEMORY:-16GiB}"
BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ "$NAME" == "jarvis" || "$NAME" == "isa" || "$NAME" == "myhub" ]]; then
  echo "Nome reservado de producao, recusando sobrepor: $NAME" >&2; exit 1
fi
if [[ ! "$NAME" =~ ^[a-z][a-z0-9-]*$ ]]; then echo "Nome de LXC invalido: $NAME" >&2; exit 1; fi
command -v lxc >/dev/null || { echo "Cliente LXD (lxc) nao encontrado." >&2; exit 1; }
[[ -e /dev/net/tun ]] || { echo "Host sem /dev/net/tun; necessario para Tailscale na LXC." >&2; exit 1; }
if lxc info "$NAME" >/dev/null 2>&1; then
  echo "LXC $NAME ja existe; instalador NAO modificara uma LXC existente." >&2; exit 1
fi
echo "===== CRIAR LXC $NAME (CPU=$CPU RAM=$MEMORY) ====="
lxc launch ubuntu:24.04 "$NAME" -c limits.cpu="$CPU" -c limits.memory="$MEMORY"
echo "===== TUN PARA TAILSCALE ====="
lxc config device add "$NAME" tailscale-tun unix-char path=/dev/net/tun
lxc restart "$NAME"
echo "===== PREPARAR UBUNTU ====="
lxc exec "$NAME" -- cloud-init status --wait
lxc file push "$BASE/deploy/lxc/bootstrap-guest.sh" "$NAME/root/bootstrap-guest.sh"
echo "===== INSTALAR OPENJARVIS / OLLAMA / PWA ====="
lxc exec "$NAME" -- env MODEL="$MODEL" bash /root/bootstrap-guest.sh
echo "===== INSTALAR TAILSCALE NA LXC ====="
lxc exec "$NAME" -- bash -c 'curl -fsSL https://tailscale.com/install.sh | bash'
lxc exec "$NAME" -- systemctl enable --now tailscaled

cat <<EOF

===== INSTALACAO NA LXC CONCLUIDA =====
Nome: $NAME
Codigo: /opt/openjarvis
Backend+PWA: http://127.0.0.1:8000 (SOMENTE dentro da LXC)
Modelo: $MODEL

FALTAM A AUTENTICACAO DO TAILSCALE E A PUBLICACAO PRIVADA.
Execute NO HOST, com seu usuario que acessa LXD:
  lxc exec $NAME -- tailscale up --hostname=$NAME
Abra o link de autenticacao que aparecer.
Depois execute:
  lxc exec $NAME -- tailscale serve --bg http://127.0.0.1:8000
  lxc exec $NAME -- tailscale serve status
  lxc exec $NAME -- systemctl is-active openjarvis-lider
Para ver a chave privada que sera cadastrada no PWA:
  lxc exec $NAME -- cat /etc/openjarvis/openjarvis.env
Nao divulgue essa chave nem coloque em commits.

ATENCAO: acesso so via Tailnet, sem Funnel/Cloudflare/portas publicas.
EOF
