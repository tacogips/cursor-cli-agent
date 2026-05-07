#!/usr/bin/env sh

set -eu

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
handoff_script="$script_dir/../../parity-backlog-design-implement-loop/scripts/build-step3-handoff.sh"

if [ ! -f "$handoff_script" ]; then
  handoff_script=".divedra/workflows/parity-backlog-design-implement-loop/scripts/build-step3-handoff.sh"
fi

exec sh "$handoff_script"
