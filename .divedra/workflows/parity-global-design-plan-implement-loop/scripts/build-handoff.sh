#!/usr/bin/env sh

set -eu

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec sh "$script_dir/../../parity-backlog-design-implement-loop/scripts/build-step3-handoff.sh"
