#!/usr/bin/env bash
# Repair an absent/empty OpenJarvis API key, without ever printing secrets.
# Run as root inside the dedicated OpenJarvis LXC.
set -Eeuo pipefail
if (( EUID != 0 )); then echo 'Execute como root dentro da LXC.' >&2; exit 1; fi
if [[ "$(systemd-detect-virt --container 2>/dev/null || true)" != "lxc" ]]; then
  echo 'Este comando so pode executar dentro da LXC.' >&2; exit 1
fi
umask 077
install -d -m 0700 /etc/openjarvis
python3 - <<'PY'
from pathlib import Path
import os
import secrets
p = Path("/etc/openjarvis/openjarvis.env")
lines = p.read_text().splitlines() if p.exists() else []
matches = [line.partition("=")[2].strip() for line in lines if line.startswith("OPENJARVIS_API_KEY=")]
if len(matches) > 1:
    raise SystemExit("Mais de uma definicao da chave; corrija o arquivo manualmente")
key = matches[0] if matches else ""
if key and (not key.startswith("oj_sk_") or len(key) < 32):
    raise SystemExit("Chave existente nao vazia em formato inesperado. Nao sobrescrevi.")
if not key:
    key = "oj_sk_" + secrets.token_urlsafe(32)
    other = [line for line in lines if not line.startswith("OPENJARVIS_API_KEY=")]
    p.write_text("\n".join(other + ["OPENJARVIS_API_KEY=" + key]) + "\n")
    print("Chave nova gerada localmente, sem exibicao do valor.")
else:
    print("Chave existente preservada, sem exibicao do valor.")
os.chmod(p, 0o600)
print("Chave presente:", bool(key), "tamanho:", len(key))
PY
systemctl restart openjarvis-lider
for i in $(seq 1 60); do
  if curl -fsS -m 3 http://127.0.0.1:8000/health >/dev/null 2>&1; then break; fi
  sleep 2
done
unauth="$(curl -sS -o /dev/null -w '%{http_code}' -m 12 http://127.0.0.1:8000/v1/models)"
if [[ "$unauth" != "401" ]]; then
  echo "ERRO: a API sem chave respondeu $unauth (esperado: 401)." >&2
  exit 1
fi
python3 - <<'PY'
from pathlib import Path
from urllib.request import Request, urlopen
key = next(line.partition("=")[2].strip() for line in Path("/etc/openjarvis/openjarvis.env").read_text().splitlines() if line.startswith("OPENJARVIS_API_KEY="))
req = Request("http://127.0.0.1:8000/v1/models", headers={"Authorization": "Bearer " + key})
with urlopen(req, timeout=15) as resp:
    status = resp.status
print("HTTP com chave:", status)
if status != 200:
    raise SystemExit("Autenticacao com chave falhou")
PY
echo 'PASS: API protegida (401 sem chave / 200 com chave).'
echo 'Para cadastrar no navegador, leia o arquivo SOMENTE no seu terminal, nao compartilhe o valor.'
