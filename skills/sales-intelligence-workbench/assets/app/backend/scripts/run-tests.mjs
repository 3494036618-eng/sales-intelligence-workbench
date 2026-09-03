import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(scriptDir, "..");
const testsDir = path.join(backendDir, "tests");
const testFiles = fs.readdirSync(testsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
  .map((entry) => path.join("tests", entry.name))
  .sort((left, right) => left.localeCompare(right, "en"));

if (!testFiles.length) throw new Error("未找到后端测试文件。");

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  cwd: backendDir,
  env: process.env,
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status || 1;
