# Preserve Task Memory for Codex

A repository-scoped Codex skill and lifecycle hook that preserves critical state for long-running tasks across context compaction.

It automatically initializes concise checkpoints outside the conversation, keyed by Codex session id, and restores the latest capsule after startup, resume, or compaction. No external model API or database is required.

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
  scripts/memory.mjs
  scripts/hook-runner.cjs
.codex/hooks.json
```

## Use

1. Clone the repository and start Codex from its root directory.
2. Open `/hooks` and review and trust the project hooks.
3. Continue working normally. Hooks initialize state, save sanitized user prompts, and record mechanical tool activity automatically.
4. Invoke `$preserve-task-memory` explicitly, or let Codex select it, when semantic decisions and milestones need consolidation.

Manual initialization is optional. Use it to set an explicit objective or definition of done:

```shell
node ".agents/skills/preserve-task-memory/scripts/memory.mjs" init \
  --session-id "<session-id>" \
  --objective "<objective>" \
  --done-criteria "<definition of done>"
```

Record a meaningful milestone with:

```shell
node ".agents/skills/preserve-task-memory/scripts/memory.mjs" checkpoint \
  --session-id "<session-id>" \
  --current "<current phase>" \
  --completed "<completed item>" \
  --next "<next action>" \
  --evidence "<verification>" \
  --status active
```

Other actions are `show`, `list`, and `validate`. Run the script without an action for command help.

## Behavior

- `SessionStart` creates missing state and injects the latest capsule on startup, resume, and post-compaction continuation.
- `UserPromptSubmit` saves a sanitized, bounded copy of each user request and adopts the first request as the provisional objective.
- `PostToolUse` records bounded mechanical activity and explicit file fields without storing shell commands or full tool output.
- `PreCompact` writes a deterministic recovery checkpoint before compaction.
- Capsules are capped at 6,000 characters to limit context use.
- Common credential patterns are redacted before storage.
- State writes are atomic and guarded by a per-session lock.
- Stored memory is recovery guidance and should be checked against the current workspace.

Automatic capture deliberately does not infer decision rationale, completion, or test success from tool output. Codex still writes semantic checkpoints for those facts, but forgetting one no longer leaves the session without its recent requests and mechanical activity.

The core is a dependency-free Node.js ES module and uses only cross-platform standard-library APIs. The same hook configuration runs on Windows, Linux, and macOS when `node` is available on `PATH`.
