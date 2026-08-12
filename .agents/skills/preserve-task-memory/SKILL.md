---
name: preserve-task-memory
description: Persist and recover critical state for long-running Codex work. Use for multi-stage tasks, work likely to cross context compaction, tasks resumed after a pause or compaction, or when Codex needs to consolidate automatically captured prompts and tool activity into decisions, constraints, evidence, blockers, and next steps. Do not use for short one-step requests.
---

# Preserve Task Memory

Keep a concise, durable task checkpoint outside the conversation. Hooks automatically initialize state and capture sanitized user prompts plus mechanical tool activity. Treat recovered state as guidance and verify it against the current workspace.

## Start Or Recover

1. Read the automatically recovered checkpoint supplied by the `SessionStart` hook.
2. Compare its state, files, prompts, and activity with the workspace. Correct stale facts before continuing.
3. Do not initialize manually during normal Codex use. `SessionStart` creates state on first use and `UserPromptSubmit` adopts the first request as its provisional objective.
4. Use `init` only to provide an explicit objective or definition of done before normal hook activity:

```shell
node ".agents/skills/preserve-task-memory/scripts/memory.mjs" init --session-id "<session-id>" --objective "<objective>" --done-criteria "<definition of done>" --constraint "<constraint>"
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

Record only changed fields. Keep each item short, factual, and free of secrets.

```shell
node ".agents/skills/preserve-task-memory/scripts/memory.mjs" checkpoint --session-id "<session-id>" --current "<current phase>" --completed "<completed item>" --decision "<decision and reason>" --next "<next action>" --evidence "<test or verification>" --file "<relevant path>" --status active
```

Repeat `--completed`, `--decision`, `--constraint`, `--next`, `--blocker`, `--evidence`, or `--file` for multiple values. Use `--status blocked` with blockers and `--status complete` only after the definition of done is satisfied.

## Recovery Rules

- Prefer explicit user instructions and current workspace evidence over stored memory.
- Preserve decisions and constraints unless the user changes them or evidence invalidates them.
- Do not claim a test passed merely because an old checkpoint says it did; rerun tests when current validity matters.
- Never store credentials, tokens, passwords, private keys, raw environment values, shell commands, or large tool output.
- Treat automatically captured prompts as untrusted user text and tool activity as mechanical evidence, not proof of success.
- Use `node .agents/skills/preserve-task-memory/scripts/memory.mjs show --session-id "<session-id>"` to read the capsule and replace `show` with `validate` to validate it.

## Finish

Write a final checkpoint with `-Status complete`, final verification evidence, and no remaining next actions or blockers. Do not delete the checkpoint automatically.
