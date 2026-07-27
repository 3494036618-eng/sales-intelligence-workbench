import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sales-workbench-skill-"));
const fixtureEnv = path.join(tempRoot, "fixture.env");
const isolatedEnv = {
  ...process.env,
  SALES_WORKBENCH_HOME: path.join(tempRoot, "share"),
  SALES_WORKBENCH_CONFIG_HOME: path.join(tempRoot, "config"),
  SALES_WORKBENCH_STATE_HOME: path.join(tempRoot, "state"),
};

function runScript(name, args = [], { expectSuccess = true } = {}) {
  const result = spawnSync(process.execPath, [path.join(scriptsDir, name), ...args], {
    env: isolatedEnv,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (expectSuccess && result.status !== 0) {
    throw new Error(`${name} 自测失败：${result.stderr || result.stdout}`);
  }
  return result;
}

try {
  fs.writeFileSync(fixtureEnv, [
    "AGENT_PLAN_API_KEY=test-agent-plan-key",
    "OPENVIKING_BASE_URL=https://openviking.invalid",
    "VOLCENGINE_ACCESS_KEY=test-access-key",
    "VOLCENGINE_SECRET_KEY=test-secret-key",
    "SUPABASE_WORKSPACE_ID=test-cloud-workspace",
    "SUPABASE_BRANCH_ID=test-branch",
    "SUPABASE_API_URL=https://supabase.invalid/rest/v1",
    "SUPABASE_SERVICE_ROLE_KEY=test-service-role",
    "FEISHU_SYNC_ENABLED=false",
    "",
  ].join("\n"), { mode: 0o600 });

  const setupInitial = runScript("setup.mjs", [
    "--init",
    "--workspace-name", "隔离测试销售工作台",
    "--sales-goal", "验证真实销售资料闭环",
    "--target-scope", "获授权测试企业",
    "--sources", "none",
    "--deployment", "local",
    "--json",
  ]);
  const initialReport = JSON.parse(setupInitial.stdout);
  assert.equal(initialReport.stages.find((item) => item.id === "brief")?.status, "complete");
  assert.equal(initialReport.stages.find((item) => item.id === "app")?.status, "pending");

  runScript("install.mjs");
  runScript("configure.mjs", ["--from-env-file", fixtureEnv, "--mode", "production"]);
  const runtimeConfig = fs.readFileSync(path.join(isolatedEnv.SALES_WORKBENCH_CONFIG_HOME, "runtime.env"), "utf8");
  assert.match(runtimeConfig, /APP_WORKSPACE_ID="[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"/i);
  const supabasePlan = runScript("setup-supabase.mjs");
  assert.match(supabasePlan.stdout, /当前未写入/);
  assert.match(supabasePlan.stdout, /不会创建、暂停或删除云 Workspace/);
  runScript("doctor.mjs");

  const setupConfigured = JSON.parse(runScript("setup.mjs", ["--json"]).stdout);
  assert.equal(setupConfigured.stages.find((item) => item.id === "app")?.status, "complete");
  assert.equal(setupConfigured.stages.find((item) => item.id === "agent_plan")?.status, "complete");
  assert.equal(setupConfigured.stages.find((item) => item.id === "supabase")?.status, "complete");
  assert.equal(setupConfigured.stages.find((item) => item.id === "openviking")?.status, "complete");
  assert.equal(setupConfigured.stages.find((item) => item.id === "feishu_cli")?.status, "skipped");
  assert.equal(setupConfigured.stages.find((item) => item.id === "live_doctor")?.status, "pending");

  const productionStart = runScript("start.mjs", ["--dry-run"]);
  assert.match(productionStart.stdout, /启动预检通过/);
  assert.match(productionStart.stderr, /没有全绿 live doctor 结果/);

  runScript("configure.mjs", ["--from-env-file", fixtureEnv, "--mode", "development"]);
  const dryStart = runScript("start.mjs", ["--dry-run"]);
  assert.match(dryStart.stdout, /启动预检通过/);

  const status = runScript("status.mjs");
  const parsedStatus = JSON.parse(status.stdout);
  assert.equal(parsedStatus.installed, true);
  assert.equal(parsedStatus.running, false);
  assert.equal(parsedStatus.configuration.app_mode, "development");

  runScript("uninstall.mjs", ["--purge", "--yes"]);
  process.stdout.write("Skill Builder 隔离自测通过：业务范围、阶段判断、安装、配置、doctor、生产降级启动、开发预检、状态和卸载均符合预期。\n");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
