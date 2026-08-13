import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const memoryScript = path.join(repositoryRoot, ".agents", "skills", "preserve-task-memory", "scripts", "memory.mjs");
const installerScript = path.join(repositoryRoot, ".agents", "skills", "preserve-task-memory", "scripts", "install-global.mjs");

function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "preserve-task-memory-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [memoryScript, ...args], {
    cwd: options.cwd ?? repositoryRoot,
    encoding: "utf8",
    input: options.input,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function runScript(script, args, options = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd ?? repositoryRoot, encoding: "utf8", input: options.input,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function hook(root, payload) {
  return run(["hook", "--root", root], { input: JSON.stringify(payload) });
}

function statePath(root, session = "test-session") {
  return path.join(root, ".codex", "task-memory", "sessions", session, "state.json");
}

test("hooks auto-initialize, capture bounded evidence, and recover", (t) => {
  const root = temporaryRoot(t);
  const session = "test-session";
  const start = JSON.parse(hook(root, {
    hook_event_name: "SessionStart",
    session_id: session,
    cwd: root,
    source: "startup",
  }));
  assert.match(start.hookSpecificOutput.additionalContext, /automatically initialized/);

  hook(root, {
    hook_event_name: "UserPromptSubmit",
    session_id: session,
    cwd: root,
    prompt: "Add Linux support password=hunter2",
  });
  hook(root, {
    hook_event_name: "PostToolUse",
    session_id: session,
    cwd: root,
    tool_name: "Bash",
    tool_input: { command: "deploy --token ultra-secret", file_path: "src/app.js" },
    tool_response: { exit_code: 0 },
  });
  JSON.parse(hook(root, {
    hook_event_name: "PreCompact",
    session_id: session,
    cwd: root,
    trigger: "auto",
  }));

  const state = JSON.parse(fs.readFileSync(statePath(root), "utf8"));
  const serialized = JSON.stringify(state);
  assert.doesNotMatch(serialized, /hunter2|ultra-secret|deploy --token/);
  assert.match(state.objective, /Add Linux support/);
  assert.deepEqual(state.recent_activity, ["Bash completed (0)"]);
  assert.deepEqual(state.files, ["src/app.js"]);
  assert.equal(state.semantic_checkpoint_needed, true);

  run([
    "checkpoint", "--root", root, "--session-id", session,
    "--decision", "Use Node standard library", "--completed", "Hooks implemented",
    "--evidence", "Tests passed", "--status", "active",
  ]);
  const recovered = JSON.parse(hook(root, {
    hook_event_name: "SessionStart",
    session_id: session,
    cwd: root,
    source: "compact",
  }));
  assert.match(recovered.hookSpecificOutput.additionalContext, /Use Node standard library/);
  assert.match(recovered.hookSpecificOutput.additionalContext, /Semantic checkpoint needed: no/);
});

test("version 1 PowerShell state with BOM migrates without losing semantics", (t) => {
  const root = temporaryRoot(t);
  const directory = path.dirname(statePath(root, "legacy"));
  fs.mkdirSync(directory, { recursive: true });
  const now = new Date().toISOString();
  const legacy = {
    schema_version: 1,
    session_id: "legacy",
    objective: "Legacy task",
    status: "active",
    constraints: ["Keep tests"],
    decisions: ["Existing decision"],
    completed: [],
    next_actions: [],
    blockers: [],
    evidence: [],
    files: [],
    created_at: now,
    updated_at: now,
    checkpoint_count: 2,
  };
  fs.writeFileSync(path.join(directory, "state.json"), `\uFEFF${JSON.stringify(legacy)}`, "utf8");
  run(["checkpoint", "--root", root, "--session-id", "legacy", "--current", "Migrated"]);
  const migrated = JSON.parse(fs.readFileSync(path.join(directory, "state.json"), "utf8"));
  assert.equal(migrated.schema_version, 3);
  assert.deepEqual(migrated.decisions, ["Existing decision"]);
  assert.equal(migrated.checkpoint_count, 3);
});

test("Stop hook writes a bounded final semantic summary", (t) => {
  const root = temporaryRoot(t);
  const session = "stop-session";
  hook(root, { hook_event_name: "SessionStart", session_id: session, cwd: root, source: "startup" });
  const result = JSON.parse(hook(root, {
    hook_event_name: "Stop", session_id: session, turn_id: "turn-1", cwd: root,
    last_assistant_message: "Implemented the change and verified node --test passed.",
  }));
  assert.equal(result.continue, true);
  const state = JSON.parse(fs.readFileSync(statePath(root, session), "utf8"));
  assert.equal(state.schema_version, 3);
  assert.match(state.final_turn_summary, /node --test passed/);
  assert.equal(state.semantic_checkpoint_needed, false);
  assert.equal(state.entries.find((entry) => entry.kind === "summary").source, "stop-hook");
});

test("checkpoint priorities and lifecycle merge keep only the current topic active", (t) => {
  const root = temporaryRoot(t);
  const session = "governance-session";
  run(["init", "--root", root, "--session-id", session, "--objective", "Govern memory"]);
  run(["checkpoint", "--root", root, "--session-id", session, "--decision", "Use local index", "--topic", "storage", "--priority", "high"]);
  run(["checkpoint", "--root", root, "--session-id", session, "--decision", "Use JSONL index", "--topic", "storage", "--merge", "--priority", "critical"]);
  let state = JSON.parse(fs.readFileSync(statePath(root, session), "utf8"));
  assert.equal(state.entries.filter((entry) => entry.kind === "decision" && entry.lifecycle === "active").length, 1);
  assert.equal(state.entries.find((entry) => entry.text === "Use JSONL index").priority, "critical");
  run(["lifecycle", "--root", root, "--session-id", session, "--topic", "storage", "--kind", "decision", "--lifecycle", "stale"]);
  state = JSON.parse(fs.readFileSync(statePath(root, session), "utf8"));
  assert.equal(state.entries.filter((entry) => entry.kind === "decision" && entry.lifecycle === "active").length, 0);
});

test("profile and BM25 search are local and optional", (t) => {
  const root = temporaryRoot(t);
  const session = "search-session";
  run(["init", "--root", root, "--session-id", session, "--objective", "Improve repository memory"]);
  run(["checkpoint", "--root", root, "--session-id", session, "--decision", "Use a deterministic local index", "--topic", "search"]);
  const profile = run(["profile", "--root", root]);
  assert.match(profile, /Lightweight Project Profile/);
  const results = JSON.parse(run(["search", "--root", root, "--query", "deterministic local index", "--mode", "bm25"]));
  assert.equal(results[0].kind, "decision");
  assert.match(results[0].text, /deterministic local index/);
});

test("global runtime resolves the Git root and respects repository opt-out", (t) => {
  const root = temporaryRoot(t);
  const git = spawnSync("git", ["init", "--quiet", root], { encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);
  const nested = path.join(root, "src", "nested");
  fs.mkdirSync(nested, { recursive: true });
  run(["hook"], {
    cwd: nested,
    input: JSON.stringify({ hook_event_name: "SessionStart", session_id: "global-session", cwd: nested, source: "startup" }),
  });
  assert.equal(fs.existsSync(statePath(root, "global-session")), true);

  fs.mkdirSync(path.join(root, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(root, ".codex", "task-memory.json"), '{"enabled":false}\n', "utf8");
  run(["hook"], {
    cwd: nested,
    input: JSON.stringify({ hook_event_name: "SessionStart", session_id: "disabled-session", cwd: nested, source: "startup" }),
  });
  assert.equal(fs.existsSync(statePath(root, "disabled-session")), false);
});

test("global installer is idempotent and preserves unrelated hooks", (t) => {
  const root = temporaryRoot(t);
  const hooksPath = path.join(root, "hooks.json");
  fs.writeFileSync(hooksPath, JSON.stringify({ hooks: {
    Stop: [{ hooks: [{ type: "command", command: "node unrelated.cjs" }] }],
  } }), "utf8");
  runScript(installerScript, ["install", "--codex-home", root]);
  runScript(installerScript, ["install", "--codex-home", root]);
  const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
  assert.equal(hooks.hooks.Stop.filter((group) => group.hooks[0].command.includes("preserve-task-memory")).length, 1);
  assert.equal(hooks.hooks.Stop.some((group) => group.hooks[0].command === "node unrelated.cjs"), true);
  const installedSkill = path.join(root, "skills", "preserve-task-memory");
  assert.equal(fs.existsSync(path.join(installedSkill, "SKILL.md")), true);

  const repository = path.join(root, "repository");
  fs.mkdirSync(repository);
  const git = spawnSync("git", ["init", "--quiet", repository], { encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);
  runScript(path.join(installedSkill, "scripts", "hook-runner.cjs"), [], {
    cwd: repository,
    input: JSON.stringify({ hook_event_name: "SessionStart", session_id: "installed-session", cwd: repository, source: "startup" }),
  });
  assert.equal(fs.existsSync(statePath(repository, "installed-session")), true);
});
