#!/usr/bin/env bash
set -euo pipefail

mapfile -t tests < <(find src -name "*.test.ts" -type f | sort)

if [ "${#tests[@]}" -eq 0 ]; then
  echo "error: no source test files were found under src/" >&2
  exit 1
fi

exec bun test "$@" "${tests[@]}"
