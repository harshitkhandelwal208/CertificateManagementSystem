#!/usr/bin/env bash
set -e

PORT="${PORT:-3000}"
echo "=========================================================="
echo " Starting Credentia Certificate Platform (Render Hosting)"
echo " Public Port: ${PORT}"
echo " Internal Verification Port: 5001"
echo " Node Version: $(node -v)"
echo " .NET Version: $(dotnet --version)"
echo " Working Directory: $(pwd)"
echo "=========================================================="

# Graceful process cleanup handler
cleanup() {
  echo "Received termination signal. Shutting down background services..."
  if [ -n "$VERIFY_PID" ]; then
    kill "$VERIFY_PID" 2>/dev/null || true
  fi
  if [ -n "$NODE_PID" ]; then
    kill "$NODE_PID" 2>/dev/null || true
  fi
  exit 0
}
trap cleanup SIGTERM SIGINT

# 1. Start internal cryptographic verification service on 127.0.0.1:5001
echo "Starting internal cryptographic verification service on 127.0.0.1:5001..."
cd /app/verification
ASPNETCORE_URLS="http://127.0.0.1:5001" \
Verification__DataDirectory="/app/data" \
Verification__TrustedRootPath="/app/data/ca/root-ca.pem" \
dotnet CertificateVerification.Web.dll &
VERIFY_PID=$!

# Wait for internal verification service to come up
echo "Waiting for verification service readiness..."
for i in {1..20}; do
  if node -e "fetch('http://127.0.0.1:5001/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" 2>/dev/null; then
    echo "✓ Internal verification service is online on 127.0.0.1:5001."
    break
  fi
  sleep 0.5
done

# 2. Launch Next.js standalone web gateway on 0.0.0.0:$PORT
echo "Starting Next.js unified gateway on 0.0.0.0:${PORT}..."
cd /app/web
PORT="${PORT}" \
HOSTNAME="0.0.0.0" \
DATA_DIR="/app/data" \
ENGINE_DLL_PATH="/app/engine/CertificateEngine.dll" \
ENGINE_CWD="/app" \
VERIFICATION_URL="http://127.0.0.1:5001" \
node server.js &
NODE_PID=$!

echo "Credentia Platform is live and listening on port ${PORT}."
wait $NODE_PID
