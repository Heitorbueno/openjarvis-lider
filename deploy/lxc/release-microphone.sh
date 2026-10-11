#!/usr/bin/env bash
# OpenJarvis Lider: install PCM/WAV microphone fix, preserving backend and Ollama.
# Run as root INSIDE the dedicated LXC. No database/config/Ollama changes.
set -Eeuo pipefail
umask 027
if (( EUID != 0 )); then echo 'Execute como root dentro da LXC.' >&2; exit 1; fi
[[ "$(systemd-detect-virt --container 2>/dev/null || true)" == "lxc" ]] || {
  echo 'RECUSADO: isto nao e uma LXC.' >&2; exit 1;
}
RELEASE_SHA="${RELEASE_SHA:-}"
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || {
  echo 'Informe RELEASE_SHA=SHA_COMPLETO do commit validado no GitHub CI.' >&2; exit 1;
}
BRANCH='fix/jarvis-microphone-wav-ptbr'
ROOT='/opt/openjarvis'
ACTIVE="$ROOT/src/openjarvis/server/static"
test -d "$ACTIVE"
test -f "$ACTIVE/index.html"
systemctl is-active --quiet openjarvis-lider
test "$(curl -sS -m 8 -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/v1/models)" = '401' || {
  echo 'API sem protecao de chave (401 esperado). Deploy bloqueado.' >&2; exit 1;
}
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE="/home/openjarvis/jarvis-microphone-release-$STAMP"
OLD_DIR="$ROOT/src/openjarvis/server/.static-before-microphone-$STAMP"
STAGE_DIR="$ROOT/src/openjarvis/server/.static-next-microphone-$STAMP"
ROLLBACK_REQUIRED=0
rollback() {
  code=$?
  if (( ROLLBACK_REQUIRED )); then
    echo '[ROLLBACK] Restaurando PWA anterior...'
    if [[ -d "$ACTIVE" ]]; then mv "$ACTIVE" "$STAGE_DIR.failed" || true; fi
    if [[ -d "$OLD_DIR" ]]; then mv "$OLD_DIR" "$ACTIVE" || true; fi
    systemctl restart openjarvis-lider || true
  fi
  exit "$code"
}
trap rollback ERR INT TERM
echo '===== CHECKOUT ISOLADO ====='
runuser -u openjarvis -- git clone --depth 1 --branch "$BRANCH" \
  https://github.com/Heitorbueno/openjarvis-lider.git "$RELEASE"
DEPLOY_SHA="$(runuser -u openjarvis -- git -C "$RELEASE" rev-parse HEAD)"
if [[ "$DEPLOY_SHA" != "$RELEASE_SHA" ]]; then
  echo "Branch mudou: commit obtido $DEPLOY_SHA difere do aprovado $RELEASE_SHA" >&2
  exit 1
fi
echo "SHA VALIDADO: $DEPLOY_SHA"
echo '===== BUILD ISOLADO ====='
runuser -u openjarvis -- env HOME=/home/openjarvis NODE_OPTIONS=--max-old-space-size=2048 \
  bash -c 'set -Eeuo pipefail; cd "$1/frontend"; npm ci --no-fund --no-audit; npm run build' _ "$RELEASE"
BUILD="$RELEASE/src/openjarvis/server/static"
test -s "$BUILD/index.html"
test -s "$BUILD/manifest.webmanifest"
test -s "$BUILD/sw.js"
test -d "$BUILD/assets"
grep -q 'Jarvis Líder' "$BUILD/index.html" || {
  echo 'A pagina gerada nao contem a identidade Jarvis Lider.' >&2; exit 1;
}
echo '===== TROCA DO FRONTEND COM ROLLBACK ====='
cp -a "$BUILD" "$STAGE_DIR"
mv "$ACTIVE" "$OLD_DIR"
ROLLBACK_REQUIRED=1
mv "$STAGE_DIR" "$ACTIVE"
chown -R openjarvis:openjarvis "$ACTIVE"
systemctl restart openjarvis-lider
READY=0
for i in $(seq 1 60); do
  if curl -fsS -m 4 http://127.0.0.1:8000/health >/dev/null 2>&1; then READY=1; break; fi
  sleep 2
done
[[ "$READY" == 1 ]] || { echo 'Healthcheck falhou.' >&2; exit 1; }
[[ "$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/manifest.webmanifest)" == 200 ]]
[[ "$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/v1/models)" == 401 ]]
ROLLBACK_REQUIRED=0
trap - ERR INT TERM
echo '===== RELEASE CONCLUIDA ====='
echo "RELEASE_SHA=$DEPLOY_SHA"
echo "BACKUP=$OLD_DIR"
echo "STATIC=$ACTIVE"
echo 'API health 200; manifest 200; acesso sem chave 401.'
echo 'Para desfazer: pare o servico, preserve o STATIC atual, renomeie BACKUP como STATIC e reinicie.'
echo 'No navegador, feche/reabra o PWA para atualizar o service worker.'
