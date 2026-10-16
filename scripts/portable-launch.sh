#!/bin/bash
set -euo pipefail
cd -- "$(dirname "$0")/.."

echo "Cozy Studio portable launcher"
echo "This launcher does not bundle ChatGPT login."

if [ -f "$PWD/runtime/bun" ]; then
  STUDIO_BUN="$PWD/runtime/bun"
  if [ ! -x "$STUDIO_BUN" ]; then
    echo "The bundled runtime is not executable. Run: chmod +x runtime/bun"
    exit 1
  fi
  export PATH="$PWD/runtime:$PATH"
elif command -v bun >/dev/null 2>&1; then
  STUDIO_BUN="$(command -v bun)"
else
  echo "Cozy Studio needs Bun. Install it from https://bun.sh/docs/installation then run this launcher again."
  if [ -z "${STUDIO_PORTABLE_NONINTERACTIVE:-}" ]; then
    read -r -p "Press Enter to close."
  fi
  exit 1
fi

export STUDIO_PORTABLE=1

if ! "$STUDIO_BUN" run scripts/portable-start.ts; then
  echo "Cozy Studio failed to start."
  if [ -z "${STUDIO_PORTABLE_NONINTERACTIVE:-}" ]; then
    read -r -p "Press Enter to close."
  fi
  exit 1
fi
