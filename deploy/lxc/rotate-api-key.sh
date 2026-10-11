#!/usr/bin/env bash
# Rotate a credential that appeared in console logs/chat. Never print the secret.
set -Eeuo pipefail
(( EUID == 0 )) || { echo 'Execute como root dentro da LXC.' >&2; exit 1; }
[[ "$(systemd-detect-virt --container 2>/dev/null || true)" == 'lxc' ]] || exit 1
umask 077
python3 - <<'PY'
from pathlib import Path
import secrets, os
p=Path('/etc/openjarvis/openjarvis.env')
assert p.is_file(), 'Arquivo de configuracao nao encontrado'
content=p.read_text().splitlines()
assert sum(v.startswith('OPENJARVIS_API_KEY=') for v in content)==1, 'Chave ausente ou duplicada'
backup=p.with_suffix('.env.before-rotation')
if backup.exists():
    raise SystemExit('Backup de rotacao anterior presente; operacao interrompida para nao sobrescrever')
backup.write_text('\n'.join(content)+'\n')
os.chmod(backup, 0o600)
new='oj_sk_'+secrets.token_urlsafe(32)
p.write_text('\n'.join([('OPENJARVIS_API_KEY='+new) if v.startswith('OPENJARVIS_API_KEY=') else v for v in content])+'\n')
os.chmod(p,0o600)
print('Chave substituida. O novo valor nao foi exibido.')
PY
systemctl restart openjarvis-lider
for i in $(seq 1 55); do
  if curl -fsS -m 2 http://127.0.0.1:8000/health >/dev/null 2>&1; then break; fi
  sleep 2
done
[[ "$(curl -sS -m 4 -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/v1/models)" == '401' ]] || {
  echo 'ERRO: sem chave deve responder 401' >&2; exit 1;
}
python3 - <<'PY'
from pathlib import Path
from urllib.request import Request,urlopen
v=[x.partition('=')[2] for x in Path('/etc/openjarvis/openjarvis.env').read_text().splitlines() if x.startswith('OPENJARVIS_API_KEY=')]
assert len(v)==1 and v[0].startswith('oj_sk_')
req=Request('http://127.0.0.1:8000/v1/models',headers={'Authorization':'Bearer '+v[0]})
with urlopen(req,timeout=10) as x:
    assert x.status==200
print('PASS: 401 sem chave e 200 com a chave rotacionada.')
PY
echo 'IMPORTANT: atualize em Configuracoes > Conexao > Chave da API de cada PWA.'
echo 'Para copiar o novo valor, use seu terminal privado; nao envie para o chat.'
