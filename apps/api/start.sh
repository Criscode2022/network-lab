#!/bin/sh
# Long-running Nest API plus the eve Nitro server (same container, same public host).
set -e
export NETBENCH_API_URL="${NETBENCH_API_URL:-https://api-production-caeb.up.railway.app}"
export EVE_ORIGIN="${EVE_ORIGIN:-http://127.0.0.1:4010}"
cd /app/apps/eve-agent
npx eve start --host 127.0.0.1 --port 4010 &
cd /app
exec npm run start -w @netbench/api
