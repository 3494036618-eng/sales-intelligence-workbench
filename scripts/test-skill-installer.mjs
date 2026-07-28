import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installer = path.join(root, "scripts", "install-codex-skill.mjs");
const commandPrinter = path.join(root, "scripts", "print-public-skill-command.mjs");
const temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), "sales-workbench-skill-"));
const target = path.join(temporaryHome, "skills", "sales-intelligence-workbench");
const environment = { ...process.env, CODEX_HOME: temporaryHome };
const onboardingEnvironment = {
  ...environment,
  SALES_WORKBENCH_HOME: path.join(temporaryHome, "runtime"),
  SALES_WORKBENCH_CONFIG_HOME: path.join(temporaryHome, "config"),
  SALES_WORKBENCH_STATE_HOME: path.join(temporaryHome, "state"),
};

function run(args, expectedStatus) {
  const result = spawnSync(process.execPath, [installer, ...args], {
    cwd: root,
    env: environment,
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    expectedStatus,
    `安装器退出码异常。\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

try {
  run([], 0);
  const installedSkillPath = path.join(target, "SKILL.md");
  assert.ok(fs.existsSync(installedSkillPath));
  assert.ok(fs.existsSync(path.join(target, "scripts", "onboard.mjs")));
  assert.equal(fs.existsSync(path.join(target, ".DS_Store")), false);
  const installedSkill = fs.readFileSync(installedSkillPath, "utf8");
  assert.match(installedSkill, /## 远程 Skill 入口/);
  assert.match(
    installedSkill,
    /skills\/sales-intelligence-workbench\/SKILL\.md/,
  );
  assert.match(installedSkill, /node scripts\/validate-skill-package\.mjs/);
  assert.match(installedSkill, /node scripts\/test-skill-installer\.mjs/);

  const help = spawnSync(process.execPath, [path.join(target, "scripts", "onboard.mjs"), "--help"], {
    env: environment,
    encoding: "utf8",
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /安全编排/);

  const onboarding = spawnSync(process.execPath, [
    path.join(target, "scripts", "onboard.mjs"),
    "--workspace-name", "隔离验收工作台",
    "--sales-goal", "验证 Skill 部署入口",
    "--target-scope", "测试企业",
    "--sources", "none",
    "--deployment", "local",
  ], {
    env: onboardingEnvironment,
    encoding: "utf8",
  });
  assert.equal(
    onboarding.status,
    0,
    `onboarding 退出码异常。\nstdout:\n${onboarding.stdout}\nstderr:\n${onboarding.stderr}`,
  );
  assert.match(onboarding.stdout, /当前阶段：app/);
  assert.match(onboarding.stdout, /已安全暂停在“agent_plan”阶段/);
  assert.ok(fs.existsSync(path.join(onboardingEnvironment.SALES_WORKBENCH_HOME, "app", "backend", "package.json")));
  assert.ok(fs.existsSync(path.join(onboardingEnvironment.SALES_WORKBENCH_STATE_HOME, "builder-brief.json")));
  assert.equal(fs.existsSync(path.join(onboardingEnvironment.SALES_WORKBENCH_CONFIG_HOME, "credentials.env")), false);
  assert.equal(fs.existsSync(path.join(onboardingEnvironment.SALES_WORKBENCH_STATE_HOME, "doctor-live.json")), false);

  const duplicate = run([], 1);
  assert.match(duplicate.stderr, /Skill 已存在/);
  run(["--force"], 0);

  const publicCommand = spawnSync(process.execPath, [
    commandPrinter,
    "--repository", "https://github.com/example/sales-workbench",
    "--ref", "v0.9.0",
  ], {
    cwd: root,
    env: environment,
    encoding: "utf8",
  });
  assert.equal(publicCommand.status, 0, publicCommand.stderr);
  assert.equal(
    publicCommand.stdout.trim(),
    "帮我初始化销售助手：https://github.com/example/sales-workbench/blob/v0.9.0/skills/sales-intelligence-workbench/SKILL.md",
  );
  assert.doesNotMatch(publicCommand.stdout, /sales-assistant-builder\.md/);

  const mutableCommand = spawnSync(process.execPath, [
    commandPrinter,
    "--repository", "https://github.com/example/sales-workbench",
    "--ref", "main",
  ], {
    cwd: root,
    env: environment,
    encoding: "utf8",
  });
  assert.equal(mutableCommand.status, 1);
  assert.match(mutableCommand.stderr, /不能使用 main\/master/);

  process.stdout.write("Skill 隔离安装、重复安装保护、强制更新和安全 onboarding 推进检查通过。\n");
} finally {
  fs.rmSync(temporaryHome, { recursive: true, force: true });
}
