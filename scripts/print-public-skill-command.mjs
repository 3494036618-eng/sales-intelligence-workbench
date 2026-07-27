import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return "";
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} 缺少参数值。`);
  return value.trim();
}

function usage() {
  return `
生成销售助手公开初始化口令

用法：
  node scripts/print-public-skill-command.mjs \\
    --repository https://github.com/<owner>/<repo> \\
    --ref v${packageJson.version}

说明：
  - --repository 必须是公开 GitHub 仓库根地址。
  - --ref 必须是已发布的不可变 tag 或 commit；正式发布不要使用 main。
  - 本命令只生成文字，不访问网络、不修改文件。
`.trimStart();
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(usage());
  process.exit(0);
}

const repository = option("--repository");
const ref = option("--ref");
if (!repository || !ref) throw new Error("必须同时提供 --repository 和 --ref。");
if (ref === "main" || ref === "master") {
  throw new Error("正式初始化口令必须固定到 release tag 或 commit，不能使用 main/master。");
}

let url;
try {
  url = new URL(repository);
} catch {
  throw new Error("--repository 不是有效 URL。");
}
if (url.protocol !== "https:" || url.hostname !== "github.com") {
  throw new Error("--repository 必须是 https://github.com/<owner>/<repo>。");
}

const segments = url.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
if (segments.length !== 2) {
  throw new Error("--repository 必须指向 GitHub 仓库根目录，不能包含额外路径。");
}

const [owner, repo] = segments;
const entryUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/docs/agents/skills/sales-assistant-builder.md`;
process.stdout.write(`帮我初始化销售助手：${entryUrl}\n`);

