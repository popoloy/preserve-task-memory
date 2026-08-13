#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_NAME = "preserve-task-memory";
const EVENTS = ["SessionStart", "UserPromptSubmit", "PostToolUse", "PreCompact", "Stop"];
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourceSkill = path.dirname(scriptDirectory);

function parseArgs(argv) {
  const values = { action: "install" };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) { values.action = token; continue; }
    const key = token.slice(2).replaceAll("-", "_");
    values[key] = argv[index + 1]?.startsWith("--") || argv[index + 1] === undefined ? true : argv[++index];
  }
  return values;
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, filePath);
}

function hookCommand() {
  return "node -e \"const p=require('node:path'),o=require('node:os');require(p.join(process.env.CODEX_HOME||p.join(o.homedir(),'.codex'),'skills','preserve-task-memory','scripts','hook-runner.cjs'))\"";
}

function hookGroups() {
  const command = hookCommand();
  return {
    SessionStart: [{
      matcher: "^(startup|resume|compact)$",
      hooks: [{ type: "command", command, statusMessage: "Recovering durable task memory", additionalContextLimit: 1800, timeout: 10 }],
    }],
    UserPromptSubmit: [{
      hooks: [{ type: "command", command, statusMessage: "Saving the latest task request", additionalContextLimit: 250, timeout: 10 }],
    }],
    PostToolUse: [{
      matcher: ".*",
      hooks: [{ type: "command", command, statusMessage: "Recording task activity", timeout: 10 }],
    }],
    PreCompact: [{
      matcher: "^(manual|auto)$",
      hooks: [{ type: "command", command, statusMessage: "Saving durable task memory", timeout: 10 }],
    }],
    Stop: [{
      hooks: [{ type: "command", command, statusMessage: "Finalizing durable task memory", timeout: 10 }],
    }],
  };
}

function isManagedGroup(group) {
  return (group?.hooks ?? []).some((hook) => typeof hook.command === "string" && hook.command.includes("preserve-task-memory"));
}

function mergeHooks(config) {
  const generated = hookGroups();
  config.hooks ??= {};
  for (const event of EVENTS) {
    const existing = Array.isArray(config.hooks[event]) ? config.hooks[event] : [];
    config.hooks[event] = [...existing.filter((group) => !isManagedGroup(group)), ...generated[event]];
  }
  return config;
}

function removeHooks(config) {
  if (!config.hooks) return config;
  for (const event of EVENTS) {
    if (!Array.isArray(config.hooks[event])) continue;
    config.hooks[event] = config.hooks[event].filter((group) => !isManagedGroup(group));
    if (!config.hooks[event].length) delete config.hooks[event];
  }
  return config;
}

function main() {
  const values = parseArgs(process.argv.slice(2));
  const codexHome = path.resolve(values.codex_home ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"));
  const destination = path.join(codexHome, "skills", SKILL_NAME);
  const hooksPath = path.join(codexHome, "hooks.json");
  const hooks = readJson(hooksPath, { description: "Global Codex lifecycle hooks.", hooks: {} });

  if (values.action === "uninstall") {
    writeJson(hooksPath, removeHooks(hooks));
    if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
    process.stdout.write(`Removed global ${SKILL_NAME} from ${codexHome}\n`);
    return;
  }
  if (values.action !== "install") throw new Error("Action must be install or uninstall.");

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (path.resolve(sourceSkill) !== path.resolve(destination)) {
    fs.cpSync(sourceSkill, destination, { recursive: true, force: true });
  }
  writeJson(hooksPath, mergeHooks(hooks));
  process.stdout.write(`Installed ${SKILL_NAME} to ${destination}\nMerged lifecycle hooks into ${hooksPath}\n`);
}

try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
