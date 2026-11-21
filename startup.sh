#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$ROOT_DIR"
if [[ "${APP_RUNTIME:-production}" == "preview" ]]; then
  exec npm run dev
fi
export PORT="${PORT:-3000}"
exec npm run start
