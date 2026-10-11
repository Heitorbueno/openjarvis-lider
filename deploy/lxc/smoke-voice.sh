#!/usr/bin/env bash
# Privacy-safe speech diagnosis using the service's actual API credential.
set -Eeuo pipefail
if (( EUID != 0 )); then echo 'Execute como root dentro da LXC Jarvis.' >&2; exit 1; fi
test -s /etc/openjarvis/openjarvis.env
python3 - <<'PY'
from pathlib import Path
import json
from urllib.request import urlopen, Request
from urllib.error import HTTPError, URLError

lines = Path('/etc/openjarvis/openjarvis.env').read_text().splitlines()
keys = [s.split('=', 1)[1].strip() for s in lines if s.startswith('OPENJARVIS_API_KEY=')]
if len(keys) != 1 or not keys[0]:
    raise SystemExit('FALHA: OPENJARVIS_API_KEY ausente/duplicada')
api = 'http://127.0.0.1:8000'
headers = {'Authorization': 'Bearer ' + keys[0]}
for endpoint in ('/v1/speech/health', '/v1/speech/tts/health'):
    print('===== ' + endpoint + ' =====', flush=True)
    req = Request(api + endpoint, headers=headers)
    try:
        with urlopen(req, timeout=120) as response:
            info = json.load(response)
    except Exception as exc:
        raise SystemExit(f'FALHA: {endpoint}: {type(exc).__name__}: {exc}')
    print(json.dumps(info, ensure_ascii=False), flush=True)
    if not info.get('available'):
        raise SystemExit(f'FALHA: motor de voz indisponível em {endpoint}')

print('===== TESTE REAL DE VOZ (WAV) =====', flush=True)
body = json.dumps({'text': 'Olá, sou o Jarvis Líder. Esta é uma resposta falada em português do Brasil.'}).encode()
req = Request(api + '/v1/speech/synthesize', data=body,
              headers={**headers, 'Content-Type': 'application/json'}, method='POST')
try:
    with urlopen(req, timeout=180) as response:
        result = response.read()
        print('HTTP:', response.status, 'conteudo:', response.headers.get('Content-Type'),
              'bytes:', len(result), 'voz:', response.headers.get('X-Voice-Id',''), flush=True)
except Exception as exc:
    raise SystemExit(f'FALHA TTS: {type(exc).__name__}: {exc}')
if len(result) < 200 or result[:4] != b'RIFF' or result[8:12] != b'WAVE':
    raise SystemExit('FALHA: backend nao devolveu WAV valido')
# Deliberately do not write audio content, API key or user recordings to disk.
print('PASS: Whisper/STT detectado; Kokoro/TTS detectado; audio WAV sintetizado.', flush=True)
PY
