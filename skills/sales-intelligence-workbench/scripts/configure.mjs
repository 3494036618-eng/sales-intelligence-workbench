import fs from "node:fs";
import { Writable } from "node:stream";
import readline from "node:readline/promises";
import {
  configurationSummary,
  parseEnvFile,
  paths,
  readConfiguration,
  readOption,
  resolveUserPath,
  writeConfiguration,
} from "./lib.mjs";

class MutedOutput extends Writable {
  constructor(output) {
    super();
    this.output = output;
    this.muted = false;
  }

  _write(chunk, encoding, callback) {
    if (!this.muted) this.output.write(chunk, encoding);
    callback();
  }
}

async function hiddenQuestion(rl, output, label, existingValue = "") {
  process.stdout.write(`${label}${existingValue ? "（留空保留现有值）" : ""}: `);
  output.muted = true;
  const answer = await rl.question("");
  output.muted = false;
  process.stdout.write("\n");
  return answer.trim() || existingValue;
}

async function visibleQuestion(rl, label, existingValue = "") {
  const suffix = existingValue ? ` [${existingValue}]` : "";
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  return answer || existingValue;
}

function validateMode(value) {
  const mode = value || "production";
  if (!["production", "development"].includes(mode)) {
    throw new Error("Skill 只允许配置 production 或 development；录屏 demo 不属于正式安装入口。");
  }
  return mode;
}

const mode = validateMode(readOption("--mode") || "production");
const importPath = readOption("--from-env-file");

if (importPath) {
  const resolved = resolveUserPath(importPath);
  if (!fs.existsSync(resolved)) throw new Error(`配置源文件不存在：${resolved}`);
  const imported = parseEnvFile(resolved);
  writeConfiguration(imported, { mode });
  process.stdout.write(`已从现有环境文件迁移配置，源文件未被修改。\n`);
  process.stdout.write(`私密凭证：${paths.credentialsFile}（0600）\n`);
  process.stdout.write(`运行配置：${paths.runtimeFile}（0600）\n`);
  process.stdout.write(`${JSON.stringify(configurationSummary(), null, 2)}\n`);
  process.exit(0);
}

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  throw new Error("交互配置需要终端，以确保密钥输入不回显；迁移现有配置可使用 --from-env-file。");
}

const existing = readConfiguration();
const output = new MutedOutput(process.stdout);
const rl = readline.createInterface({ input: process.stdin, output, terminal: true });

try {
  process.stdout.write("凭证只写入本机用户配置目录，输入过程不会回显。\n");
  const agentPlanKey = await hiddenQuestion(
    rl,
    output,
    "Agent Plan API Key（模型、DataPro、豆包搜索、OpenViking 和视觉模型共用）",
    existing.AGENT_PLAN_API_KEY
      || existing.MODEL_API_KEY
      || existing.DATAPRO_API_KEY
      || existing.WEB_SEARCH_API_KEY
      || existing.VISION_API_KEY,
  );
  if (!agentPlanKey) throw new Error("Agent Plan API Key 不能为空。");
  const openVikingKey = await hiddenQuestion(rl, output, "OpenViking 专用 API Key（高级覆盖，通常留空）", existing.OPENVIKING_API_KEY);
  const openVikingBaseUrl = await visibleQuestion(rl, "OpenViking Base URL（使用本地 CLI 时可留空）", existing.OPENVIKING_BASE_URL);
  const openVikingCli = await visibleQuestion(rl, "OpenViking CLI 路径（可留空）", existing.OPENVIKING_CLI);
  const openVikingCliConfig = await visibleQuestion(rl, "OpenViking CLI 配置路径（默认 ~/.openviking/ovcli.conf）", existing.OPENVIKING_CLI_CONFIG);
  const openVikingAgentId = await visibleQuestion(rl, "OpenViking Agent ID", existing.OPENVIKING_AGENT_ID || "default");

  const supabaseApiUrl = await visibleQuestion(rl, "Supabase Data API URL", existing.SUPABASE_API_URL);
  const supabaseServiceRole = await hiddenQuestion(rl, output, "Supabase Service Role Key", existing.SUPABASE_SERVICE_ROLE_KEY);
  const appWorkspaceId = await visibleQuestion(
    rl,
    "应用 Workspace UUID（首次配置留空将自动生成）",
    existing.APP_WORKSPACE_ID,
  );
  const cloudWorkspaceId = await visibleQuestion(rl, "火山 Supabase Workspace ID", existing.SUPABASE_WORKSPACE_ID);
  const branchId = await visibleQuestion(rl, "火山 Supabase Branch ID", existing.SUPABASE_BRANCH_ID);
  const volcAccessKey = await hiddenQuestion(rl, output, "火山 Access Key（仅迁移/备份/资源管理需要）", existing.VOLCENGINE_ACCESS_KEY);
  const volcSecretKey = await hiddenQuestion(rl, output, "火山 Secret Key（仅迁移/备份/资源管理需要）", existing.VOLCENGINE_SECRET_KEY);

  const feishuAnswer = await visibleQuestion(
    rl,
    "是否启用飞书 CLI 导入（命令行与前端入口，true/false）",
    existing.FEISHU_CLI_IMPORT_ENABLED || existing.FEISHU_SYNC_ENABLED || "false",
  );
  const liveProbeCompany = await visibleQuestion(
    rl,
    "真实只读诊断使用的企业名称",
    existing.LIVE_PROBE_COMPANY || "北京火山引擎科技有限公司",
  );
  const authRedirectUrl = await visibleQuestion(
    rl,
    "密码重置回跳 URL（需加入 Supabase Auth 允许列表）",
    existing.AUTH_REDIRECT_URL || "http://127.0.0.1:8787/",
  );

  writeConfiguration({
    ...existing,
    AGENT_PLAN_API_KEY: agentPlanKey,
    MODEL_API_KEY: "",
    DATAPRO_API_KEY: "",
    WEB_SEARCH_API_KEY: "",
    OPENVIKING_API_KEY: openVikingKey,
    OPENVIKING_BASE_URL: openVikingBaseUrl,
    OPENVIKING_CLI: openVikingCli,
    OPENVIKING_CLI_CONFIG: openVikingCliConfig,
    OPENVIKING_AGENT_ID: openVikingAgentId,
    SUPABASE_API_URL: supabaseApiUrl,
    SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRole,
    APP_WORKSPACE_ID: appWorkspaceId,
    SUPABASE_WORKSPACE_ID: cloudWorkspaceId,
    SUPABASE_BRANCH_ID: branchId,
    VOLCENGINE_ACCESS_KEY: volcAccessKey,
    VOLCENGINE_SECRET_KEY: volcSecretKey,
    FEISHU_CLI_IMPORT_ENABLED: /^true|1|yes$/i.test(feishuAnswer) ? "true" : "false",
    FEISHU_SYNC_ENABLED: /^true|1|yes$/i.test(feishuAnswer) ? "true" : "false",
    VISION_API_KEY: "",
    LIVE_PROBE_COMPANY: liveProbeCompany,
    AUTH_REDIRECT_URL: authRedirectUrl,
  }, { mode });

  process.stdout.write(`私密凭证已写入 ${paths.credentialsFile}（0600）。\n`);
  process.stdout.write(`运行配置已写入 ${paths.runtimeFile}（0600）。\n`);
  process.stdout.write("下一步运行 doctor.mjs；它只显示配置状态，不显示密钥。\n");
} finally {
  rl.close();
}
