#!/usr/bin/env bash
# OpenJarvis Lider: speech-latency fix (PWA + token cap). No DB/Ollama changes.
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
BRANCH='fix/jarvis-weather-voice-latency'
ROOT='/opt/openjarvis'
ACTIVE="$ROOT/src/openjarvis/server/static"
ROUTES="$ROOT/src/openjarvis/server/routes.py"
test -s "$ROUTES"
test -d "$ACTIVE"
test -f "$ACTIVE/index.html"
systemctl is-active --quiet openjarvis-lider
test "$(curl -sS -m 8 -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/v1/models)" = '401' || {
  echo 'API sem protecao de chave (401 esperado). Deploy bloqueado.' >&2; exit 1;
}
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE="/home/openjarvis/jarvis-voice-fast-release-$STAMP"
OLD_DIR="$ROOT/src/openjarvis/server/.static-before-voice-fast-$STAMP"
STAGE_DIR="$ROOT/src/openjarvis/server/.static-next-voice-fast-$STAMP"
ROUTES_NEXT="$ROOT/src/openjarvis/server/.routes-next-voice-fast-$STAMP.py"
ROUTES_OLD="$ROOT/src/openjarvis/server/.routes-before-voice-fast-$STAMP.py"
ROLLBACK_REQUIRED=0
rollback() {
  code=$?
  if (( ROLLBACK_REQUIRED )); then
    echo '[ROLLBACK] Restaurando PWA anterior...'
    if [[ -f "$ROUTES_OLD" ]]; then cp -a "$ROUTES_OLD" "$ROUTES" || true; fi
    if [[ -d "$OLD_DIR" ]]; then
      if [[ -d "$ACTIVE" ]]; then mv "$ACTIVE" "$STAGE_DIR.failed" || true; fi
      mv "$OLD_DIR" "$ACTIVE" || true
    fi
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
echo '===== PATCH ISOLADO DE LIMITES DE RESPOSTA ====='
cp -a "$ROUTES" "$ROUTES_NEXT"
python3 - "$ROUTES_NEXT" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
code=p.read_text(encoding="utf-8")
edits=[
('''            # Bump max_tokens when complexity suggests more than what
            # the client requested — never reduce below the request value.
            if suggested > request_body.max_tokens:
                request_body.max_tokens = suggested''',
'''            # Preserve explicit client budgets, including immersive voice requests.
            if "max_tokens" not in request_body.model_fields_set and suggested > request_body.max_tokens:
                request_body.max_tokens = suggested'''),
('''    with _get_agent_model_lock(agent):
        original_model = agent._model
        if model:
            agent._model = model
        try:''',
'''    with _get_agent_model_lock(agent):
        original_model = agent._model
        has_max_tokens = hasattr(agent, "_max_tokens")
        original_max_tokens = getattr(agent, "_max_tokens", None)
        if model:
            agent._model = model
        if has_max_tokens and "max_tokens" in req.model_fields_set and 0 < req.max_tokens <= 8192:
            agent._max_tokens = req.max_tokens
        try:'''),
('''        finally:
            agent._model = original_model

    usage = UsageInfo(''',
'''        finally:
            agent._model = original_model
            if has_max_tokens:
                agent._max_tokens = original_max_tokens

    usage = UsageInfo(''')
]
for old,new in edits:
    if code.count(old)!=1:
        raise SystemExit("ABORTADO: backend difere do padrão esperado; nenhuma rota original será sobrescrita.")
    code=code.replace(old,new,1)
p.write_text(code,encoding="utf-8")
print("OK: limites de tokens do agente corrigidos, demais rotas preservadas.")
PY
"$ROOT/.venv/bin/python" -m py_compile "$ROUTES_NEXT"
echo '===== TROCA DO FRONTEND E PATCH DE BACKEND COM ROLLBACK ====='
cp -a "$BUILD" "$STAGE_DIR"
cp -a "$ROUTES" "$ROUTES_OLD"
ROLLBACK_REQUIRED=1
cp -a "$ROUTES_NEXT" "$ROUTES"
mv "$ACTIVE" "$OLD_DIR"
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
echo "BACKUP_STATIC=$OLD_DIR"
echo "BACKUP_BACKEND=$ROUTES_OLD"
echo "STATIC=$ACTIVE"
echo 'API health 200; manifest 200; acesso sem chave 401.'
echo 'Para desfazer: pare o servico, preserve o STATIC atual, renomeie BACKUP como STATIC e reinicie.'
echo 'No navegador, feche/reabra o PWA para atualizar o service worker.'
