const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const script = path.join(__dirname, "memory.mjs");
if (!fs.existsSync(script)) throw new Error(`Missing preserve-task-memory runtime: ${script}`);

process.argv = [process.execPath, script, "hook"];
import(pathToFileURL(script).href).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
