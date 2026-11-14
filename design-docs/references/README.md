# References

This repository's initial design was derived from local artifacts inspected on 2026-03-23.

## Primary Reference Repositories

- `/g/gits/tacogips/codex-agent`
- `/g/gits/tacogips/codex-agent/design-docs/specs/design-codex-session-management.md`
- `/g/gits/tacogips/codex-agent/design-docs/specs/design-claude-parity-gap.md`
- `/g/gits/tacogips/codex-agent/README.md`

## Local Cursor CLI Evidence

Confirmed locally from the installed CLI:

- `cursor-agent --help`
- `cursor-agent --version`
- `cursor-agent about`
- `cursor-agent create-chat`
- `cursor-agent ls`
- `cursor-agent --print --trust --output-format json ...`
- `cursor-agent --print --trust --output-format stream-json --stream-partial-output ...`
- `cursor-agent --print --trust --output-format json --resume <id> ...`

## Local Cursor Data Layout Evidence

Confirmed locally from:

- `~/.cursor/projects/*/agent-transcripts/*.jsonl`
- `~/.cursor/projects/*/worker.log`
- `~/.cursor/projects/*/repo.json`
- `~/.cursor/agent-cli-state.json`
- `~/.cursor/ai-tracking/ai-code-tracking.db`
- `~/.cursor/skills-cursor/*/SKILL.md`

## Local Skill Catalog Evidence

Confirmed locally:

- `~/.cursor/skills-cursor/create-rule/SKILL.md`
- `~/.cursor/skills-cursor/create-skill/SKILL.md`
- `~/.cursor/skills-cursor/create-subagent/SKILL.md`
- `~/.cursor/skills-cursor/migrate-to-skills/SKILL.md`
- `~/.cursor/skills-cursor/update-cursor-settings/SKILL.md`

Important observed note from the built-in `create-skill` skill:

- `~/.cursor/skills-cursor/` is reserved for Cursor internal built-in skills
- user-authored skills should instead live in `~/.cursor/skills/` or project `.cursor/skills/`

## Notes

- No external web sources were required for this first design pass.
- The design intentionally distinguishes between confirmed observations and implementation inferences.
