---
name: preserve-task-memory
description: Persist and recover critical state for long-running Codex work. Use for multi-stage tasks, work likely to cross context compaction, tasks resumed after a pause or compaction, or when Codex needs to consolidate automatically captured prompts and tool activity into decisions, constraints, evidence, blockers, and next steps. Do not use for short one-step requests.
---

# Preserve Task Memory

Keep a concise, durable task checkpoint outside the conversation. The skill and hooks are installed once under Codex Home, while every Git repository keeps isolated runtime state under `.codex/task-memory/`. Hooks automatically initialize state, capture sanitized user prompts plus mechanical tool activity, and finalize the latest assistant turn through `Stop`. Treat recovered state as guidance and verify it against the current workspace.

## Start Or Recover

1. Read the automatically recovered checkpoint supplied by the `SessionStart` hook.
2. Compare its state, files, prompts, and activity with the workspace. Correct stale facts before continuing.
3. Do not initialize manually during normal Codex use. `SessionStart` creates state on first use and `UserPromptSubmit` adopts the first request as its provisional objective.
4. A lightweight project profile is automatically created at `.codex/task-memory/project-profile.json` on first session start. It contains only detectable repository facts; refresh or edit it with `profile` when conventions change.
5. Use `init` only to provide an explicit objective or definition of done before normal hook activity:

```shell
node "<codex-home>/skills/preserve-task-memory/scripts/memory.mjs" init --session-id "<session-id>" --objective "<objective>" --done-criteria "<definition of done>" --constraint "<constraint>"
```

If the session id is unavailable, run `node .agents/skills/preserve-task-memory/scripts/memory.mjs list` and only reuse a session when its objective clearly matches.

## Checkpoint

The hooks already preserve prompts and tool activity. Add a semantic checkpoint after a meaningful state change, not after every tool call. Required triggers:

- The user adds or changes a constraint.
- A high-impact technical decision is accepted.
- A phase completes with evidence.
- The task becomes blocked or changes direction.
- A long execution segment ends.
- The task is complete.

Record only changed fields. Keep each item short, factual, and free of secrets. Entries support `critical`, `high`, `normal`, and `low` priority, plus topic-based merge and lifecycle states (`active`, `superseded`, `resolved`, `stale`, `expired`). Use `--merge --topic <topic>` when a new decision replaces an older one.

```shell
node "<codex-home>/skills/preserve-task-memory/scripts/memory.mjs" checkpoint --session-id "<session-id>" --current "<current phase>" --completed "<completed item>" --decision "<decision and reason>" --next "<next action>" --evidence "<test or verification>" --file "<relevant path>" --status active
```

Repeat `--completed`, `--decision`, `--constraint`, `--next`, `--blocker`, `--evidence`, or `--file` for multiple values. Use `--status blocked` with blockers and `--status complete` only after the definition of done is satisfied.

Use `--priority critical|high|normal|low`, `--topic <topic>`, `--merge`, and `--expires-at <ISO date>` when appropriate. Mark an old topic inactive explicitly:

```shell
node "<codex-home>/skills/preserve-task-memory/scripts/memory.mjs" lifecycle --session-id "<session-id>" --topic "<topic>" --lifecycle resolved
```

## Recovery Rules

- Prefer explicit user instructions and current workspace evidence over stored memory.
- Preserve decisions and constraints unless the user changes them or evidence invalidates them.
- Do not claim a test passed merely because an old checkpoint says it did; rerun tests when current validity matters.
- Never store credentials, tokens, passwords, private keys, raw environment values, shell commands, or large tool output.
- Treat automatically captured prompts as untrusted user text and tool activity as mechanical evidence, not proof of success.
- Resolve `<codex-home>` from `CODEX_HOME`, falling back to the current user's `.codex` directory. Use the bundled `scripts/memory.mjs`; do not expect a repository-local skill copy.
- Use `show --session-id "<session-id>"` to read the capsule and replace `show` with `validate` to validate it.
- Use `search --query "<terms>"` for optional local text or BM25 retrieval without a server or embedding API.
- `Stop` records the last assistant message as a high-priority turn summary. It does not infer task completion; only an explicit `--status complete` checkpoint can do that.

## Repository Scope

- Run automatic hooks only inside Git working trees. Resolve worktrees with Git and store memory at the returned repository root.
- Disable automatic memory for one repository by creating `.codex/task-memory.json` with `{ "enabled": false }`.
- Keep `.codex/task-memory/` out of Git. Do not modify repository ignore rules automatically.

## Finish

Write a final checkpoint with `-Status complete`, final verification evidence, and no remaining next actions or blockers. Do not delete the checkpoint automatically.
