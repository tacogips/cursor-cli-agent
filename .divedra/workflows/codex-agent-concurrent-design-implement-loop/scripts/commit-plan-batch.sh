#!/usr/bin/env sh

set -eu

mailbox_dir="${DIVEDRA_MAILBOX_DIR:?DIVEDRA_MAILBOX_DIR is required}"
output_path="${mailbox_dir}/outbox/output.json"

mkdir -p "$(dirname "$output_path")"

stage_if_exists() {
  for path in "$@"; do
    if [ -e "$path" ]; then
      git add "$path"
    fi
  done
}

stage_if_exists \
  README.md \
  Taskfile.yml \
  .divedra/README.md \
  .divedra/workflows/codex-agent-concurrent-design-implement-loop \
  .divedra/workflows/codex-agent-feature-design-plan-loop \
  .divedra/workflows/design-and-implement-review-loop \
  design-docs/specs \
  impl-plans/active

if git diff --cached --quiet; then
  printf '%s\n' '{"workflowMode":"codex-agent-concurrent-design-implement","commitStatus":"no-changes","commitHash":null,"commitMessage":null,"stagedScopes":["README.md","Taskfile.yml",".divedra","design-docs/specs","impl-plans/active"],"residualRisks":["No planning or workflow changes were staged."]}' > "$output_path"
  exit 0
fi

commit_message="chore: commit codex-agent design and implementation plans"
git commit -m "$commit_message"
commit_hash="$(git rev-parse HEAD)"

printf '%s\n' '{"workflowMode":"codex-agent-concurrent-design-implement","commitStatus":"committed","commitHash":"'"$commit_hash"'","commitMessage":"'"$commit_message"'","stagedScopes":["README.md","Taskfile.yml",".divedra","design-docs/specs","impl-plans/active"],"residualRisks":[]}' > "$output_path"
