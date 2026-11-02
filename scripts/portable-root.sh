#!/bin/bash
set -euo pipefail
cd -P -- "$(dirname "$0")"
root="$PWD"
export STUDIO_MANAGED_RESTART=1

# Renames stay between fixed siblings of this resolved portable root.
checked() {
  if [ -L "$root/$1" ]; then
    echo "Linked update path is not allowed: $1" >&2
    return 1
  fi
}

swap() {
  checked app && checked app.previous && checked app.next || return 1
  if [ ! -e "$root/app" ] && [ -d "$root/app.previous" ]; then
    mv -- "$root/app.previous" "$root/app" || return 1
  fi
  checked app.next/portable.json || return 1
  [ -f "$root/app.next/portable.json" ] || return 0
  [ ! -e "$root/app.previous" ] || return 1
  checked app/.env.local && checked app.next/.env.local && checked app.next/.update-pending || return 1
  if [ -f "$root/app/.env.local" ]; then
    cp -- "$root/app/.env.local" "$root/app.next/.env.local" || return 1
  fi
  # Mark before activation so an interrupted swap cannot leave an unmarked new app.
  printf '' > "$root/app.next/.update-pending" || return 1
  mv -- "$root/app" "$root/app.previous" || return 1
  if ! mv -- "$root/app.next" "$root/app"; then
    mv -- "$root/app.previous" "$root/app" || return 1
    return 1
  fi
}

rollback() {
  checked app && checked app.previous && checked app.failed || return 1
  [ ! -e "$root/app.failed" ] || return 1
  mv -- "$root/app" "$root/app.failed" || return 1
  if ! mv -- "$root/app.previous" "$root/app"; then
    mv -- "$root/app.failed" "$root/app" || return 1
    return 1
  fi
}

while true; do
  if ! swap; then
    echo 'Close windows or terminals using the app folder; the update will retry next launch. Existing recovery folders are preserved.'
  fi
  status=0
  /bin/bash "$root/app/scripts/portable-launch.sh" || status=$?
  if [ "$status" -eq 75 ]; then
    export STUDIO_PORTABLE_RESTART=1
    continue
  fi
  if [ "$status" -ne 0 ] && [ -f "$root/app/.update-pending" ] && [ -d "$root/app.previous" ]; then
    if ! rollback; then
      echo 'Could not restore the previous app. Recovery folders and user data were kept.'
      break
    fi
    echo 'The update failed to start. Restored the previous app.'
    continue
  fi
  break
done
if [ "$status" -ne 0 ] && [ -z "${STUDIO_PORTABLE_NONINTERACTIVE:-}" ]; then
  read -r -p 'Press Enter to close.' || true
fi
exit "$status"
