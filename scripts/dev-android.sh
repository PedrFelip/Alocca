#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
usage() {
  cat <<'HELP'
Uso: ./scripts/dev-android.sh [--ip IP_DA_MAQUINA] [--device SERIAL] [--port PORTA] [--usb]

Inicia PostgreSQL, SeaweedFS e API; compila, instala e abre o Android via ADB.
Conecte o celular por USB (depuração USB autorizada) ou previamente via adb connect.
Use --usb para conectar o app pelo ADB sem depender da rede local.
Sem --usb, celular e computador precisam estar na mesma rede. Ctrl+C encerra a API;
os containers e seus dados permanecem disponíveis.
HELP
}
fail() { echo "Erro: $*" >&2; exit 1; }
LAN_IP=${ALOCCA_LAN_IP:-}
SERIAL=${ANDROID_SERIAL:-}
PORT=${ALOCCA_PORT:-3000}
USB=false
while (($#)); do
  case "$1" in
    --ip|--device|--port)
      (($# >= 2)) || fail "Falta valor para $1"
      case "$1" in
        --ip) LAN_IP=$2 ;; --device) SERIAL=$2 ;; --port) PORT=$2 ;;
      esac
      shift 2 ;;
    --usb) USB=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Opção desconhecida: $1" ;;
  esac
done
for tool in adb bun docker python3 curl setsid; do
  command -v "$tool" >/dev/null || fail "Instale $tool antes de continuar."
done
[[ $PORT =~ ^[1-9][0-9]{0,4}$ ]] && ((PORT > 0 && PORT < 65536)) || fail 'Porta inválida.'
((EUID != 0)) || fail 'Execute sem sudo; o script solicita sudo apenas para o Docker quando necessário.'
DOCKER=(docker)
if ! DOCKER_ERROR=$(docker info 2>&1); then
  if [[ $DOCKER_ERROR == *"permission denied"* && $DOCKER_ERROR == *"/var/run/docker.sock"* ]]; then
    command -v sudo >/dev/null || fail 'Sem acesso ao Docker e sudo indisponível.'
    echo 'O Docker exige permissão administrativa. Somente os comandos Docker usarão sudo.'
    DOCKER=(sudo docker)
    "${DOCKER[@]}" info >/dev/null || fail 'Não foi possível acessar o Docker com sudo.'
  else
    printf '%s\n' "$DOCKER_ERROR" >&2
    fail 'Docker indisponível. Confira se o serviço está iniciado.'
  fi
fi
"${DOCKER[@]}" compose version >/dev/null
# Worktrees não herdam local.properties do checkout original.
if [[ ! -f "$ROOT/frontend/local.properties" ]]; then
  SDK_PATH=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
  if [[ -z $SDK_PATH ]]; then
    for candidate in "$HOME/Android/Sdk" "$HOME/Android/sdk" /opt/android-sdk; do
      if [[ -d $candidate/platforms ]]; then
        SDK_PATH=$candidate
        break
      fi
    done
  fi
  [[ -n $SDK_PATH && -d $SDK_PATH/platforms ]] || fail 'Android SDK não encontrado. Defina ANDROID_HOME ou frontend/local.properties com sdk.dir.'
  export ANDROID_HOME="$SDK_PATH"
  echo "Android SDK: $ANDROID_HOME"
fi
mapfile -t DEVICES < <(adb devices | awk 'NR > 1 && $2 == "device" {print $1}')
if [[ -z $SERIAL ]]; then
  ((${#DEVICES[@]} == 1)) || fail 'Conecte e autorize um celular no ADB; se houver vários, use --device SERIAL. Consulte adb devices.'
  SERIAL=${DEVICES[0]}
fi
[[ $(adb -s "$SERIAL" get-state) == device ]] || fail "Dispositivo $SERIAL indisponível."
if [[ -z $LAN_IP ]]; then
  command -v ip >/dev/null || fail 'Informe o IP local com --ip.'
  LAN_IP=$(ip -4 route get 1.1.1.1 | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}')
fi
[[ -n $LAN_IP ]] || fail 'Não foi possível detectar o IP. Use --ip IP_DA_MAQUINA.'
python3 - "$LAN_IP" "$PORT" <<'PY'
import ipaddress, socket, sys
ipaddress.IPv4Address(sys.argv[1])
with socket.socket() as sock:
    sock.bind(('0.0.0.0', int(sys.argv[2])))
PY
API_URL="http://$LAN_IP:$PORT/"
if [[ $USB == true ]]; then
  adb -s "$SERIAL" reverse "tcp:$PORT" "tcp:$PORT"
  API_URL="http://127.0.0.1:$PORT/"
fi
cd "$ROOT"
# Não carrega .env como shell: preserva configurações e gera segredos locais.
python3 - "$ROOT/backend" <<'PY'
from pathlib import Path
import re, secrets, sys
base = Path(sys.argv[1])
path = base / '.env'
content = path.read_text() if path.exists() else (base / '.env.example').read_text()
for key in ('JWT_SECRET', 'ADMIN_PASSWORD'):
    match = re.search(rf'^{key}=(.*)$', content, re.M)
    value = match.group(1).strip().strip('\'"') if match else ''
    if not value or (key == 'ADMIN_PASSWORD' and value == 'AloccaAdmin@2026'):
        generated = secrets.token_hex(32)
        line = f'{key}={generated}'
        content = re.sub(rf'^{key}=.*$', line, content, flags=re.M) if match else content.rstrip() + '\n' + line + '\n'
        print(f'{key} gerado e salvo em backend/.env.')
path.write_text(content)
path.chmod(0o600)
PY
"${DOCKER[@]}" compose up -d --wait db seaweedfs
(cd backend && bun install --frozen-lockfile && bun run migrate)
API_PID=
cleanup() {
  if [[ -n $API_PID ]]; then
    kill -- "-$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
(cd backend && exec setsid env HOST=0.0.0.0 PORT="$PORT" bun run dev) &
API_PID=$!
ready=false
for ((attempt=0; attempt<120; attempt++)); do
  kill -0 "$API_PID" 2>/dev/null || fail 'A API encerrou durante a inicialização.'
  if curl --silent --fail --max-time 2 "http://127.0.0.1:$PORT/health" >/dev/null; then
    ready=true
    break
  fi
  sleep 1
done
[[ $ready == true ]] || fail 'A API não ficou pronta em 120 tentativas.'
echo "API na rede: http://$LAN_IP:$PORT/ (permita TCP $PORT no firewall da rede local)."
echo "URL usada pelo app: $API_URL"
(cd frontend && ./gradlew --console=plain assembleDebug "-PAloccaApiBaseUrl=$API_URL")
adb -s "$SERIAL" install -r "$ROOT/frontend/app/build/outputs/apk/debug/app-debug.apk"
adb -s "$SERIAL" shell am start -n br.com.alocca.plantoes/.MainActivity
echo 'App aberto. Mantenha este terminal ativo; Ctrl+C encerra a API.'
wait "$API_PID"
