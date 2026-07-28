import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.join(root, "skills", "sales-intelligence-workbench");

function read(relativePath) {
  const filePath = path.join(root, relativePath);
  assert.ok(fs.existsSync(filePath), `缺少文件：${relativePath}`);
  return fs.readFileSync(filePath, "utf8");
}

const requiredSkillFiles = [
  "SKILL.md",
  "agents/openai.yaml",
  "scripts/onboard.mjs",
  "scripts/setup.mjs",
  "scripts/install.mjs",
  "scripts/configure.mjs",
  "scripts/setup-supabase.mjs",
  "scripts/doctor.mjs",
  "scripts/start.mjs",
  "scripts/import-feishu.mjs",
  "scripts/verify-business-chain.mjs",
  "references/cookbook-workflow.md",
  "assets/app/backend/package.json",
  "assets/app/frontend/index.html",
];

for (const relativePath of requiredSkillFiles) {
  assert.ok(fs.existsSync(path.join(skillRoot, relativePath)), `Skill 缺少文件：${relativePath}`);
}

const skill = read("skills/sales-intelligence-workbench/SKILL.md");
const agent = read("skills/sales-intelligence-workbench/agents/openai.yaml");
const workflow = read("skills/sales-intelligence-workbench/references/cookbook-workflow.md");
const publicEntry = read("docs/agents/skills/sales-assistant-builder.md");
const readme = read("README.md");
const packageJson = JSON.parse(read("package.json"));

assert.match(skill, /^---\nname: sales-intelligence-workbench\n/m);
assert.match(agent, /\$sales-intelligence-workbench/);
assert.match(agent, /allow_implicit_invocation:\s*true/);
assert.match(skill, /onboard\.mjs/);
assert.match(skill, /## 远程 Skill 入口/);
assert.match(skill, /帮我初始化销售助手：https:\/\/github\.com\/<owner>\/<repo>\/blob\/<ref>\/skills\/sales-intelligence-workbench\/SKILL\.md/);
assert.match(skill, /node scripts\/validate-skill-package\.mjs/);
assert.match(skill, /node scripts\/test-skill-installer\.mjs/);
assert.doesNotMatch(skill, /页面的“成员”入口/);
assert.match(workflow, /DataPro → 豆包搜索 → 证据整理与模型生成 → Supabase/);
assert.doesNotMatch(workflow, /DataPro → 豆包搜索 → OpenViking → 模型 → Supabase/);
assert.match(publicEntry, /^---\nname: sales-assistant-builder\n/m);
assert.match(publicEntry, /兼容入口/);
assert.match(publicEntry, /sales-intelligence-workbench\/SKILL\.md/);
assert.doesNotMatch(publicEntry, /\/Users\/|file:\/\//);
assert.match(readme, /npm run skill:install/);
assert.match(readme, /npm run skill:command/);
assert.match(readme, /skills\/sales-intelligence-workbench\/SKILL\.md/);
assert.doesNotMatch(readme, /raw\.githubusercontent\.com\/<组织>\/<仓库>\/v0\.9\.0\/docs\/agents\/skills\/sales-assistant-builder\.md/);
assert.equal(packageJson.scripts?.["skill:install"], "node scripts/install-codex-skill.mjs");
assert.equal(packageJson.scripts?.["skill:command"], "node scripts/print-public-skill-command.mjs");
assert.match(packageJson.scripts?.verify || "", /skill:validate/);
assert.match(packageJson.scripts?.verify || "", /skill:test/);
assert.match(packageJson.scripts?.verify || "", /backend run release:verify/);

process.stdout.write("Skill 包结构、触发配置、安装入口和 Cookbook 链路检查通过。\n");
