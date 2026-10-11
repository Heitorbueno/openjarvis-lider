#!/usr/bin/env bash
# Deploy weather endpoint and its PWA together; refuse unreviewed source edits.
# Run as root inside LXC jarvis; no migrations, database or Ollama changes.
set -Eeuo pipefail
umask 027
(( EUID == 0 )) || { echo 'Execute como root na LXC.' >&2; exit 1; }
[[ "$(systemd-detect-virt --container 2>/dev/null || true)" == lxc ]] || {
  echo 'RECUSADO fora de LXC.' >&2; exit 1;
}
SHA="${RELEASE_SHA:-}"
[[ "$SHA" =~ ^[a-f0-9]{40}$ ]] || { echo 'Informe RELEASE_SHA=SHA_COMPLETO' >&2; exit 1; }
ROOT=/opt/openjarvis
DIR="$ROOT/src/openjarvis/server"
ACTIVE="$DIR/static"
ROUTES="$DIR/api_routes.py"
WEATHER="$DIR/weather_routes.py"
test -f "$ROUTES" && test -s "$ACTIVE/index.html"
systemctl is-active --quiet openjarvis-lider
test "$(curl -sS -m 10 -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/v1/models)" = 401 || {
  echo 'Protecao por API key ausente. Implantacao recusada.' >&2; exit 1;
}
# Some OpenJarvis installations are packaged as source trees without .git.
# Verify the exact insertion point instead of assuming a working tree exists.
# Do not replace api_routes.py wholesale: preserve every pre-existing route.
python3 - "$ROUTES" <<'PY'
from pathlib import Path
import sys
data = Path(sys.argv[1]).read_bytes()
anchor = b"    app.include_router(speech_router)\n"
if data.count(anchor) != 1:
    raise SystemExit("ABORTADO: marcador de rotas de voz ausente/duplicado; nao alterei arquivos.")
if b"openjarvis.server.weather_routes" in data:
    raise SystemExit("ABORTADO: o endpoint de clima ja esta registrado; verificar antes de atualizar.")
print("Rota de voz localizada uma vez; as demais rotas serao preservadas.")
PY
echo "BLOB_API_ROUTES_ATUAL=$(git hash-object "$ROUTES")"
if [[ -e "$WEATHER" ]]; then
  echo 'weather_routes.py ja existe. Implantacao recusada para evitar sobrescrita.' >&2; exit 1
fi
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE="/home/openjarvis/jarvis-weather-release-$STAMP"
STATIC_NEXT="$DIR/.static-next-weather-$STAMP"
STATIC_OLD="$DIR/.static-before-weather-$STAMP"
ROUTES_OLD="$DIR/.api-routes-before-weather-$STAMP.py"
DEPLOYED=0
rollback() {
  status=$?
  if (( DEPLOYED )); then
    echo '[ROLLBACK] Restaurando backend e PWA antigos.'
    systemctl stop openjarvis-lider || true
    if [[ -f "$ROUTES_OLD" ]]; then cp -a "$ROUTES_OLD" "$ROUTES"; fi
    rm -f "$WEATHER"
    if [[ -d "$ACTIVE" && -d "$STATIC_OLD" ]]; then mv "$ACTIVE" "$DIR/.static-failed-weather-$STAMP"; fi
    if [[ -d "$STATIC_OLD" ]]; then mv "$STATIC_OLD" "$ACTIVE"; fi
    systemctl start openjarvis-lider || true
  fi
  exit "$status"
}
trap rollback ERR INT TERM
echo '===== CHECKOUT ISOLADO ====='
runuser -u openjarvis -- git clone --quiet --depth 1 \
  --branch feat/jarvis-weather-live-forecast \
  https://github.com/Heitorbueno/openjarvis-lider.git "$RELEASE"
ACTUAL="$(runuser -u openjarvis -- git -C "$RELEASE" rev-parse HEAD)"
[[ "$ACTUAL" == "$SHA" ]] || { echo "SHA divergente: $ACTUAL" >&2; exit 1; }
echo "RELEASE_SHA=$ACTUAL"
echo '===== VERIFICACAO DO PYTHON ====='
/opt/openjarvis/.venv/bin/python -m py_compile \
  "$RELEASE/src/openjarvis/server/weather_routes.py" \
  "$RELEASE/src/openjarvis/server/api_routes.py"
echo '===== BUILD DO PWA ====='
runuser -u openjarvis -- env HOME=/home/openjarvis NODE_OPTIONS=--max-old-space-size=2048 \
  bash -c 'set -Eeuo pipefail; cd "$1/frontend"; npm ci --no-audit --no-fund; npm run build' _ "$RELEASE"
BUILT="$RELEASE/src/openjarvis/server/static"
test -s "$BUILT/index.html"
test -s "$BUILT/manifest.webmanifest"
test -s "$BUILT/sw.js"
cp -a "$BUILT" "$STATIC_NEXT"
cp -a "$ROUTES" "$ROUTES_OLD"
DEPLOYED=1
echo '===== IMPLANTACAO COM ROLLBACK ====='
cp "$RELEASE/src/openjarvis/server/weather_routes.py" "$WEATHER"
# Surgical additive registration, preserving original backend modifications.
python3 - "$ROUTES" <<'PY'
from pathlib import Path
from tempfile import NamedTemporaryFile
import os
import sys
p = Path(sys.argv[1])
raw = p.read_bytes()
anchor = b"    app.include_router(speech_router)\n"
addition = (
    b"    # Read-only forecast; authentication is inherited from the /v1 middleware.\n"
    b"    from openjarvis.server.weather_routes import router as weather_router\n"
    b"    app.include_router(weather_router)\n"
)
if raw.count(anchor) != 1 or b"openjarvis.server.weather_routes" in raw:
    raise SystemExit("ABORTADO: nao foi possivel validar uma insercao unica no backend.")
with NamedTemporaryFile(mode="wb", dir=p.parent, prefix=".api_routes-weather-", delete=False) as tmp:
    tmp.write(raw.replace(anchor, anchor + addition, 1))
    temp_path = tmp.name
os.chmod(temp_path, p.stat().st_mode & 0o777)
os.replace(temp_path, p)
print("Backend atualizado com registro aditivo da rota; nenhuma outra rota substituida.")
PY
chown openjarvis:openjarvis "$WEATHER" "$ROUTES"
mv "$ACTIVE" "$STATIC_OLD"
mv "$STATIC_NEXT" "$ACTIVE"
chown -R openjarvis:openjarvis "$ACTIVE"
systemctl restart openjarvis-lider
READY=0
for i in $(seq 1 60); do
  if curl -fsS -m 3 http://127.0.0.1:8000/health >/dev/null 2>&1; then READY=1; break; fi
  sleep 2
done
[[ "$READY" == 1 ]] || { echo 'Falha no healthcheck.' >&2; exit 1; }
test "$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/v1/models)" = 401
test "$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/manifest.webmanifest)" = 200
echo '===== PREVISAO AUTENTICADA (SEM MOSTRAR CHAVE) ====='
/opt/openjarvis/.venv/bin/python - <<'PY'
from pathlib import Path
import json
from urllib.parse import quote
from urllib.request import Request, urlopen
conf = Path('/etc/openjarvis/openjarvis.env')
keys = [line.partition('=')[2].strip() for line in conf.read_text().splitlines()
        if line.startswith('OPENJARVIS_API_KEY=')]
if len(keys) != 1 or not keys[0]:
    raise SystemExit('Credencial API ausente')
url='http://127.0.0.1:8000/v1/weather/tomorrow?city='+quote('Cuiabá')
req=Request(url,headers={'Authorization':'Bearer '+keys[0]})
with urlopen(req,timeout=35) as response:
    forecast=json.load(response)
    assert response.status == 200
    assert forecast['provider'] == 'Open-Meteo'
    assert forecast['date'] and forecast['temperature_max_c'] is not None
    assert forecast['temperature_min_c'] is not None
    print('PASS: forecast', forecast['date'], forecast['location']['name'],
          'max_C', forecast['temperature_max_c'],
          'min_C', forecast['temperature_min_c'])
PY
DEPLOYED=0
trap - ERR INT TERM
echo '===== RELEASE APROVADA ====='
echo "RELEASE_SHA=$ACTUAL"
echo "BACKUP_STATIC=$STATIC_OLD"
echo "BACKUP_API_ROUTES=$ROUTES_OLD"
echo 'health 200, manifest 200, API sem chave 401, previsao autenticada 200.'
