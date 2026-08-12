const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let root = process.cwd();
let script;
while (true) {
  const candidate = path.join(
    root,
    ".agents",
    "skills",
    "preserve-task-memory",
    "scripts",
    "memory.mjs",
  );
  if (fs.existsSync(candidate)) {
    script = candidate;
    break;
  }
  const parent = path.dirname(root);
  if (parent === root) {
    process.stderr.write("Could not locate preserve-task-memory from the session working directory.\n");
    process.exit(1);
  }
  root = parent;
}

process.argv = [process.execPath, script, "hook", "--root", root];
import(pathToFileURL(script).href).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
