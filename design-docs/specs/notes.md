# Design Notes

This document contains research findings, investigations, and miscellaneous design notes.

## Overview

Notable items that do not fit into architecture or client categories.

---

## Sections

## 2026-04-09 Design Review

Compared the current `cursor-cli-agent` design set against `/g/gits/tacogips/codex-agent`.

Main finding:

- the existing docs were sufficient for the phase-1 foundation, but they under-specified the later parity path

Missing areas identified and now added to the design set:

- session and transcript search
- bookmark lifecycle and constraints
- activity derivation
- file-intelligence design based on `ai-tracking`
- advanced group and queue lifecycle controls
- server/auth/daemon/public SDK phases

Design intent after this review:

- keep phase 1 local-first and ingestion-heavy
- make phase 2 and phase 3 local capabilities explicit before building the server
- treat Cursor-specific approximations as first-class design constraints, not implementation accidents

---

## 2026-05-04 Parity Backlog Automation

Added `design-docs/specs/design-parity-backlog-workflow.md` to define a
repository-local orchestrator workflow that owns the remaining phase-2 through
phase-5 parity backlog and delegates one ready slice at a time into
`design-and-implement-review-loop`.

Why this exists:

- the parity roadmap already existed
- the repository already had a single-slice implementation workflow
- the missing piece was a workflow-owned backlog queue that can keep selecting
  the next ready capability without relying on ad hoc operator prompts

---
