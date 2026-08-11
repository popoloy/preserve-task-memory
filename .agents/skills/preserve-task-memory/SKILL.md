---
name: preserve-task-memory
description: Persist and recover critical state for long-running Codex work. Use for multi-stage tasks, work likely to cross context compaction, tasks resumed after a pause or compaction, or when the user asks to checkpoint progress, decisions, constraints, evidence, blockers, or next steps. Do not use for short one-step requests.
---

# Preserve Task Memory

Keep a concise, durable task checkpoint outside the conversation. Treat a recovered checkpoint as guidance, then verify it against the current workspace before acting.

## Start Or Recover

1. Read the task-memory session id supplied by the `SessionStart` hook context.
2. If a checkpoint was recovered, compare its state, files, and evidence with the workspace. Correct stale facts before continuing.
3. If no checkpoint exists and the task is long-running, initialize one:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".agents/skills/preserve-task-memory/scripts/memory.ps1" init -SessionId "<session-id>" -Objective "<objective>" -DoneCriteria "<definition of done>" -Constraint "<constraint>"
```

If the session id is unavailable, run `memory.ps1 list` and only reuse a session when its objective clearly matches.

## Checkpoint

Checkpoint after a meaningful state change, not after every tool call. Required triggers:

- The user adds or changes a constraint.
- A high-impact technical decision is accepted.
- A phase completes with evidence.
- The task becomes blocked or changes direction.
- A long execution segment ends.
- The task is complete.

Record only changed fields. Keep each item short, factual, and free of secrets.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".agents/skills/preserve-task-memory/scripts/memory.ps1" checkpoint -SessionId "<session-id>" -Current "<current phase>" -Completed "<completed item>" -Decision "<decision and reason>" -Next "<next action>" -Evidence "<test or verification>" -File "<relevant path>" -Status active
```

Repeatable fields are `-Completed`, `-Decision`, `-Constraint`, `-Next`, `-Blocker`, `-Evidence`, and `-File`. Pass multiple values as comma-separated quoted strings. Use `-Status blocked` with blockers and `-Status complete` only after the definition of done is satisfied.

## Recovery Rules

- Prefer explicit user instructions and current workspace evidence over stored memory.
- Preserve decisions and constraints unless the user changes them or evidence invalidates them.
- Do not claim a test passed merely because an old checkpoint says it did; rerun tests when current validity matters.
- Never store credentials, tokens, passwords, private keys, raw environment values, or large tool output.
- Use `memory.ps1 show -SessionId "<session-id>"` to read the capsule and `memory.ps1 validate -SessionId "<session-id>"` to validate it.

## Finish

Write a final checkpoint with `-Status complete`, final verification evidence, and no remaining next actions or blockers. Do not delete the checkpoint automatically.
