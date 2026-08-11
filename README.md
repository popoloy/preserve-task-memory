# Preserve Task Memory for Codex

A repository-scoped Codex skill and lifecycle hook that preserves critical state for long-running tasks across context compaction.

It stores concise checkpoints outside the conversation, keyed by Codex session id, and restores the latest capsule after startup, resume, or compaction. No external model API or database is required.

## What It Preserves

- Objective and definition of done
- User constraints and technical decisions
- Completed work and verification evidence
- Current state, blockers, and next actions
- Relevant file paths

Runtime state is stored under `.codex/task-memory/` and excluded from Git.

## Repository Layout

```text
.agents/skills/preserve-task-memory/
  SKILL.md
  agents/openai.yaml
  scripts/memory.ps1
.codex/hooks.json
```

## Use

1. Clone the repository and start Codex from its root directory.
2. Open `/hooks` and review and trust the project hooks.
3. Invoke `$preserve-task-memory` explicitly, or let Codex select it for a long-running task.

The hook supplies the current session id. Initialize a checkpoint with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".agents/skills/preserve-task-memory/scripts/memory.ps1" init `
  -SessionId "<session-id>" `
  -Objective "<objective>" `
  -DoneCriteria "<definition of done>"
```

Record a meaningful milestone with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".agents/skills/preserve-task-memory/scripts/memory.ps1" checkpoint `
  -SessionId "<session-id>" `
  -Current "<current phase>" `
  -Completed "<completed item>" `
  -Next "<next action>" `
  -Evidence "<verification>" `
  -Status active
```

Other actions are `show`, `list`, and `validate`. Run the script without an action for command help.

## Behavior

- `SessionStart` injects the latest compact capsule on startup, resume, and post-compaction continuation.
- `PreCompact` records the compaction event and warns when the checkpoint is stale.
- Capsules are capped at 6,000 characters to limit context use.
- Common credential patterns are redacted before storage.
- Stored memory is recovery guidance and should be checked against the current workspace.

The current implementation targets Windows PowerShell for hook execution. The hook configuration also includes a `pwsh` command for compatible environments.
