import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fatalHandler = Symbol.for("sales-intelligence-workbench.skill-installer-error-handler");
if (!globalThis[fatalHandler]) {
  globalThis[fatalHandler] = true;
  const reportFatal = (error) => {
    process.stderr.write(`错误：${error instanceof Error ? error.message : String(error)}\n`);
    if (process.env.DEBUG && error?.stack) process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  };
  process.on("uncaughtException", reportFatal);
  process.on("unhandledRejection", reportFatal);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "skills", "sales-intelligence-workbench");
const codexHome = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
const skillsRoot = path.join(codexHome, "skills");
const target = path.join(skillsRoot, "sales-intelligence-workbench");
const force = process.argv.includes("--force");

if (!fs.existsSync(path.join(source, "SKILL.md"))) {
  throw new Error(`Skill 源目录无效：${source}`);
}
if (fs.existsSync(target) && !force) {
  throw new Error(`Skill 已存在：${target}。如需更新，请运行 npm run skill:install -- --force。`);
}

fs.mkdirSync(skillsRoot, { recursive: true, mode: 0o700 });
const staging = path.join(skillsRoot, `.sales-intelligence-workbench-${randomUUID()}.install`);
const backup = path.join(skillsRoot, ".sales-intelligence-workbench.previous");

try {
  fs.cpSync(source, staging, {
    recursive: true,
    force: true,
    filter: (entry) => {
      const relative = path.relative(source, entry);
      const segments = relative.split(path.sep);
      const name = path.basename(entry);
      return !segments.some((segment) => ["node_modules", "dist", ".git", ".temp", "coverage"].includes(segment))
        && name !== ".DS_Store"
        && !/\.(?:log|pid)$/i.test(name);
    },
  });
  fs.rmSync(backup, { recursive: true, force: true });
  if (fs.existsSync(target)) fs.renameSync(target, backup);
  fs.renameSync(staging, target);
  fs.rmSync(backup, { recursive: true, force: true });
} catch (error) {
  fs.rmSync(staging, { recursive: true, force: true });
  if (!fs.existsSync(target) && fs.existsSync(backup)) fs.renameSync(backup, target);
  throw error;
}

process.stdout.write(`Codex Skill 已安装：${target}\n`);
process.stdout.write("重新启动 Codex 后，输入“请使用 $sales-intelligence-workbench 搭建我的销售团队工作台”。\n");
