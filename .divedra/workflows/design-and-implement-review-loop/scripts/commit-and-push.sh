#!/usr/bin/env sh

set -eu

mailbox_dir="${DIVEDRA_MAILBOX_DIR:?DIVEDRA_MAILBOX_DIR is required}"
commit_message="${COMMIT_MESSAGE:?COMMIT_MESSAGE is required}"
workflow_mode="${WORKFLOW_MODE:-unknown}"
output_path="${mailbox_dir}/outbox/output.json"

mkdir -p "$(dirname "$output_path")"

git add -A

if git diff --cached --quiet; then
  printf '%s\n' '{"workflowMode":"'"$workflow_mode"'","commitMessage":"'"$(printf '%s' "$commit_message" | sed 's/"/\\"/g')"'","pushStatus":"no-changes","residualRisks":["No staged changes were available for commit."]}' > "$output_path"
  exit 1
fi

git commit -m "$commit_message"

current_branch="$(git rev-parse --abbrev-ref HEAD)"
upstream_ref="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"

if [ -n "$upstream_ref" ]; then
  pushed_remote="${upstream_ref%%/*}"
  pushed_branch="${upstream_ref#*/}"
  git push "$pushed_remote" "HEAD:$pushed_branch"
else
  pushed_remote="${GIT_PUSH_REMOTE:-origin}"
  pushed_branch="$current_branch"
  git push -u "$pushed_remote" "HEAD:$pushed_branch"
fi

commit_hash="$(git rev-parse HEAD)"
escaped_commit_message="$(printf '%s' "$commit_message" | sed 's/"/\\"/g')"

printf '%s\n' '{"workflowMode":"'"$workflow_mode"'","commitMessage":"'"$escaped_commit_message"'","commitHash":"'"$commit_hash"'","pushedRemote":"'"$pushed_remote"'","pushedBranch":"'"$pushed_branch"'","pushStatus":"pushed","residualRisks":[]}' > "$output_path"
