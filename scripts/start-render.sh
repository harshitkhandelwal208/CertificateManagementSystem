#!/usr/bin/env bash
set -Eeuo pipefail

VERIFY_PID=""
NODE_PID=""
cleanup() {
  trap - EXIT SIGTERM SIGINT
  for process_id in "$VERIFY_PID" "$NODE_PID"; do
    if [[ -n "$process_id" ]]; then kill "$process_id" 2>/dev/null || true; fi
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 143' SIGTERM
trap 'exit 130' SIGINT

export NODE_ENV=production
export ASPNETCORE_ENVIRONMENT=Production
export DOTNET_ENVIRONMENT=Production
export PORT="${PORT:-3000}"
export DATA_DIR="${DATA_DIR:-/app/data}"
export ENGINE_CWD=/app
export ENGINE_DLL_PATH=/app/engine/CertificateEngine.dll
export VERIFICATION_URL=http://127.0.0.1:5001
export Platform__DataDirectory="$DATA_DIR"
export Verification__DataDirectory="$DATA_DIR"
export Platform__PublicBaseUrl="${Platform__PublicBaseUrl:-${RENDER_EXTERNAL_URL:-}}"
export Signing__Enabled=true
export Signing__PfxPath="$DATA_DIR/ca/signing.pfx"
export Signing__TrustedRootPath="$DATA_DIR/ca/root-ca.pem"
export Verification__TrustedRootPath="$DATA_DIR/ca/root-ca.pem"

# Validate required secrets without printing their values. Signing material is
# restored from Render secrets, never created or baked into the Docker image.
node <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const required = ['DATABASE_URL', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'SESSION_SECRET', 'Platform__InternalApiKey', 'Signing__PfxPassword', 'SIGNING_PFX_BASE64', 'TRUSTED_ROOT_PEM_BASE64', 'Platform__PublicBaseUrl']
for (const key of required) {
  if (!process.env[key]?.trim()) throw new Error(`${key} must be configured in Render`)
}
if (process.env.ADMIN_PASSWORD.length < 12) throw new Error('ADMIN_PASSWORD must contain at least 12 characters')
if (process.env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters')
if (process.env.Platform__InternalApiKey.length < 32) throw new Error('Platform__InternalApiKey must contain at least 32 characters')
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.ADMIN_EMAIL)) throw new Error('ADMIN_EMAIL must be a valid email address')
let database
try { database = new URL(process.env.DATABASE_URL) } catch { throw new Error('DATABASE_URL must be a PostgreSQL URI') }
if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error('DATABASE_URL must be a PostgreSQL URI')
if (database.searchParams.get('sslmode') === 'disable') throw new Error('DATABASE_URL must enable TLS in production')
let publicUrl
try { publicUrl = new URL(process.env.Platform__PublicBaseUrl) } catch { throw new Error('Platform__PublicBaseUrl must be a valid HTTPS URL') }
if (publicUrl.protocol !== 'https:') throw new Error('Platform__PublicBaseUrl must use HTTPS in production')
const directory = path.join(process.env.DATA_DIR, 'ca')
fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
function decode(key, destination) {
  const encoded = process.env[key].replace(/\s/g, '')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) throw new Error(`${key} must contain valid base64`)
  const data = Buffer.from(encoded, 'base64')
  if (data.length === 0) throw new Error(`${key} cannot be empty`)
  fs.writeFileSync(path.join(directory, destination), data, { mode: 0o600 })
  return data
}
decode('SIGNING_PFX_BASE64', 'signing.pfx')
const root = decode('TRUSTED_ROOT_PEM_BASE64', 'root-ca.pem').toString('utf8')
if (!root.includes('-----BEGIN CERTIFICATE-----') || root.includes('PRIVATE KEY')) throw new Error('TRUSTED_ROOT_PEM_BASE64 must contain a public root certificate only')
console.log('Deployment configuration validated.')
NODE

cd /app
dotnet "$ENGINE_DLL_PATH" initialize

cd /app/verification
ASPNETCORE_URLS=http://127.0.0.1:5001 dotnet CertificateVerification.Web.dll &
VERIFY_PID=$!
ready=false
for ((attempt=1; attempt<=60; attempt++)); do
  if ! kill -0 "$VERIFY_PID" 2>/dev/null; then
    echo 'Verification service exited before becoming ready.' >&2
    exit 1
  fi
  if node -e "fetch('http://127.0.0.1:5001/health', { signal: AbortSignal.timeout(2000) }).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo 'Verification service did not become ready.' >&2
  exit 1
fi

cd /app/web
HOSTNAME=0.0.0.0 node server.js &
NODE_PID=$!
echo "Certificate platform listening on port ${PORT}."
# Restart the container when either service exits, including an unexpected clean
# exit, so a healthy gateway cannot mask a dead verification service.
set +e
wait -n "$VERIFY_PID" "$NODE_PID"
service_status=$?
set -e
if [[ "$service_status" -eq 0 ]]; then service_status=1; fi
exit "$service_status"
