---
name: sales-intelligence-workbench
description: 从 0 到 1 搭建、配置、验收和维护真实数据驱动的销售团队工作台，覆盖需求澄清、Agent Plan 模型与 Harness、Supabase 业务数据库、OpenViking 长期记忆、Codex CLI 调度飞书 CLI 导入资料，以及企业搜索、档案和资料问答闭环。用户要求搭建销售工作台、部署或继续开发该项目、导入销售资料、排查 Provider、迁移数据库、备份恢复或验收真实业务链路时使用。
---

# 销售团队工作台 Builder

这是一个 Builder Skill：先理解用户的销售目标，再安装经过测试的完整前后端模板，连接用户自己的 Agent Plan、Supabase、OpenViking 和资料来源，最后用真实业务闭环验收。不得用演示企业、固定报告、Mock Provider 或静态来源冒充真实链路。

## 远程 Skill 入口

用户可能直接通过公开的主 Skill URL 触发本流程，而不是预先克隆仓库、安装 Skill 或准备
本机配置。正式口令采用以下形式，并固定到不可变的 release tag 或 commit：

```text
帮我初始化销售助手：https://github.com/<owner>/<repo>/blob/<ref>/skills/sales-intelligence-workbench/SKILL.md
```

如果当前环境中不存在 `{baseDir}/scripts/status.mjs`，说明本 Skill 是从远程 URL 打开的。
此时 Agent 必须：

1. 从用户提供的 Skill URL 解析同一个 GitHub 仓库和 `<ref>`，取得该版本的完整仓库，不能
   只下载 `SKILL.md`，也不能通过搜索结果猜测同名仓库。
2. 将 `{baseDir}` 设为仓库中的 `skills/sales-intelligence-workbench`，确认
   `{baseDir}/scripts/`、`{baseDir}/references/`、`{baseDir}/assets/app/` 及仓库根目录
   `package.json` 均存在。
3. 在仓库根目录执行 `node scripts/validate-skill-package.mjs` 和
   `node scripts/test-skill-installer.mjs`。两项都通过后执行 `npm run skill:install`；
   已安装旧版时先说明影响，再使用 `npm run skill:install -- --force`。
4. 立即使用刚取得仓库中的本文件继续阶段 0，不要求用户重启 Codex，也不让用户重复提供
   源码目录。
5. 已有同名目录时先核对 Git remote、版本和工作区状态；不覆盖用户改动，不创建第二套
   运行时。下载、校验和安装阶段不创建云资源、不调用模型或 Harness、不产生 AFP。

“什么也没配置”表示用户不需要预先准备本地项目、依赖或配置文件，不代表可以绕过云服务
账号、Agent Plan 套餐、Supabase/OpenViking 权限、飞书登录或真实调用费用。Agent 必须在
对应阶段解释并引导完成这些必要授权。

## 执行原则

- 每完成一步，说明刚做了什么、为什么做、当前阶段、下一步和是否产生外部调用或费用。
- 密钥只通过隐藏终端输入、现有私密环境文件或部署平台 Secret 配置；不要要求用户把密钥发到聊天。
- 先做配置检查，再经用户知情执行 `--live`；真实 doctor 会产生少量模型、DataPro 和联网搜索用量。
- production 必须 fail closed。配置缺失时不启动；单个上游临时故障时允许工作台启动，但依赖该 Provider 的业务操作必须失败并报告原因，不生成假结果。
- 数据库迁移、恢复、删除和真实业务写入前明确影响；恢复只对独立目标执行。
- 读取 `references/evidence-policy.md` 后再修改事实、引用、档案或问答链路。

## 0. 先确认用户要搭建什么

先询问并复述以下信息，不要求用户先懂技术配置：

1. 工作台名称和最重要的销售目标。
2. 目标行业、区域或客户范围。
3. 历史资料来源：飞书云文档、飞书群聊/单聊，或首版暂不导入。
4. 运行方式：本机或受控内网。
5. 是否已经购买并配置 Agent Plan。

确认方案后记录不含密钥的业务范围：

```bash
node {baseDir}/scripts/setup.mjs --init \
  --workspace-name "<工作台名称>" \
  --sales-goal "<销售目标>" \
  --target-scope "<行业、区域或客户范围>" \
  --sources feishu_docs,feishu_chats \
  --deployment local
```

该命令不访问外部服务、不创建云资源、不产生 AFP。完整步骤和验收标准见 `references/cookbook-workflow.md`。

## 1. 判断当前阶段

确认业务范围后，优先运行安全编排器：

```bash
node {baseDir}/scripts/onboard.mjs
```

它会读取 `setup.mjs` 的阶段状态，自动执行本地安装、交互配置和启动等可恢复步骤；遇到 Supabase 写入、真实 Provider 调用、用户登录、飞书导入或付费业务验收时必须暂停并说明影响。只有用户明确确认后，才能分别追加 `--apply-supabase --yes` 或 `--confirm-live`。不得替用户自动创建、暂停或删除云 Workspace。

需要只读查看阶段和唯一下一步时运行：

```bash
node {baseDir}/scripts/setup.mjs
```

Builder 按“业务范围 → 应用 → Agent Plan/Harness → Supabase → OpenViking → 飞书资料 → 真实诊断 → API/Worker → 首批导入 → 业务验收”推进。所有阶段通过前，不要宣称工作台已经可直接使用。

需要查看进程、地址和 Provider 配置细节时再运行：

```bash
node {baseDir}/scripts/status.mjs
```

## 2. 安装应用

默认安装 Skill 自带的真实应用包：

```bash
node {baseDir}/scripts/install.mjs
```

继续开发当前仓库时，从用户确认的源码目录安装：

```bash
node {baseDir}/scripts/install.mjs --source /绝对路径/销售智能工作台开源版
```

安装先检查前端语法并执行后端全套测试，再原子替换运行时。路径和安装边界见 `references/setup.md`。

## 3. 配置真实资源

在交互式终端隐藏输入：

```bash
node {baseDir}/scripts/configure.mjs
```

已有私密 `.env.local` 时可迁移，不修改源文件，也不显示值：

```bash
node {baseDir}/scripts/configure.mjs --from-env-file /绝对路径/.env.local --mode production
```

首次联调可用 `--mode development`；对外运行使用 `production`。不得通过该 Skill 配置 `demo`。Provider 与 Key 的对应关系见 `references/provider-configuration.md`。

## 4. 初始化数据库

目标必须是北京地域的 Agent Plan Supabase Workspace，不能把普通按量 Workspace 当作 Harness。优先使用显式 profile：

```bash
byted-supabase-cli login --profile agent-plan --region cn-beijing --is-agent-plan
```

把 `SUPABASE_CLI_PROFILE=agent-plan` 写入私密运行配置。需要新建时，先确认费用与休眠策略，再由具备 `aidap:CreateWorkspace` 权限的账号执行 `projects create --profile agent-plan --is-agent-plan`。

已有火山 Supabase Workspace 时，先查看不会写入的初始化计划：

```bash
node {baseDir}/scripts/setup-supabase.mjs
```

确认目标后执行：

```bash
node {baseDir}/scripts/setup-supabase.mjs --apply --yes
```

该命令先只读核验 Workspace 的 Agent Plan 属性与 Running 状态，再读取 Data API 地址和 Service Role Key、保存到本机私密配置、应用迁移、创建应用 Workspace 记录并回读验证；不会创建、暂停或删除云 Workspace。

已有完整 Data API 配置、只需检查迁移时运行：

```bash
node {baseDir}/scripts/migrate.mjs
```

用户确认将修改目标 Supabase 后再应用：

```bash
node {baseDir}/scripts/migrate.mjs --apply
```

不要对来源不明的现有生产库直接迁移。

## 5. 诊断并启动

配置检查不访问外部服务：

```bash
node {baseDir}/scripts/doctor.mjs
```

向用户说明会产生少量调用后，执行真实只读诊断：

```bash
node {baseDir}/scripts/doctor.mjs --live
```

排障时可用 `--only-provider model|datapro|web_search|openviking|supabase` 单独复测；单项结果不能生成 production 启动凭证。

首次正式使用前建议完成全量真实诊断；诊断失败会保留 Provider 级故障证据，但不会阻止其他独立能力启动。随后启动：

```bash
node {baseDir}/scripts/start.mjs
node {baseDir}/scripts/status.mjs
```

首次打开页面时创建本工作区的首位管理员。之后所有业务页面和写操作都要求登录；管理员状态与业务页面分离。

当前 Beta 是单工作区、单人使用，以及本机或受控内网自托管模式，不提供成员邀请、角色管理、公网生产 SaaS 或 SLA。密码恢复依赖 Supabase Auth 邮件服务；如未来开放公网，必须配置 `AUTH_REDIRECT_URL`、Auth Redirect URLs 允许列表和自有 SMTP，具体要求见 `references/provider-configuration.md`。

后端和前端由同一进程、同一地址提供；不要另开静态 Demo。停止不会删除配置和数据：

```bash
node {baseDir}/scripts/stop.mjs
```

`start.mjs` 同时管理同源 API 和独立任务 Worker；`status.mjs` 中 `running` 与 `worker_running` 都应为 `true`。档案和 OpenViking 批量同步由 Worker 执行，不能只启动 API。运行中取消只登记请求，Worker 到达安全检查点后才释放付费预约并允许重试。

## 6. 导入飞书资料

本项目规定使用 **Codex CLI 调度飞书 CLI**，不以 Feishu MCP 或群机器人替代用户态读取。先阅读 `references/feishu-import.md`。

先为导入命令建立工作台用户会话（密码隐藏输入，令牌仅保存到本机 `0600` 状态文件）：

```bash
node {baseDir}/scripts/login.mjs
```

```bash
node {baseDir}/scripts/import-feishu.mjs \
  --company-id <企业ID> \
  --doc "https://example.feishu.cn/wiki/..."
```

会话导入可使用 `--p2p-user <联系人姓名>` 或 `--chat-id <oc_会话ID>`；云文档只接受完整链接。启用 `FEISHU_CLI_IMPORT_ENABLED=true` 后，登录用户也可在“历史资料”模块使用“导入飞书资料”。两种入口都会先由 `lark-cli` 读取：正文只写入当前企业的 OpenViking 目录，Supabase 只保存来源、游标、内容指纹和 OpenViking 引用。
成功导入后，Builder 仅保存时间、企业 ID 和来源类型的脱敏回执，不复制飞书正文或凭证。

使用结束后可删除本机 CLI 会话：

```bash
node {baseDir}/scripts/logout.mjs
```

## 7. 验收真实链路

`verify-real-chain.mjs` 只做模型、DataPro、豆包搜索、OpenViking 和 Supabase 的最小只读诊断，不写业务数据，不能替代产品验收：

```bash
node {baseDir}/scripts/verify-real-chain.mjs
```

完整业务链路使用已授权测试企业，真实执行企业搜索、入池、异步档案和资料问答，并校验逐段引用、Provider Run 与 Token：

```bash
node {baseDir}/scripts/login.mjs
node {baseDir}/scripts/verify-business-chain.mjs \
  --goal-id <销售目标ID> \
  --company-query <完整企业名称> \
  --question "根据当前档案，下一步应优先确认什么？" \
  --confirm-live
```

该命令会产生 AFP/Token，并保留 Supabase 中的企业/档案/任务记录及 OpenViking 中的问答 Session，不会自动删除。完整产品验收还必须补充：飞书增量导入、从 OpenViking 重启恢复正文与问答、再次生成后的版本比较、备份恢复和浏览器端操作。任一步使用固定前端数据都不通过。
验收通过后，Builder 保存不含档案正文、问题答案和密钥的脱敏回执，供 `setup.mjs` 判断搭建是否完成。

应用队列迁移后，在不调用模型或 Harness 的情况下验证数据库原子语义：

```bash
node {baseDir}/scripts/smoke-paid-workflow.mjs
node {baseDir}/scripts/smoke-async-job-queue.mjs
```

两项检查都必须显示 `transaction: rolled_back` 和 `provider_calls: 0`。

## 8. 备份、恢复与升级

```bash
node {baseDir}/scripts/backup.mjs
node {baseDir}/scripts/export-workspace.mjs
node {baseDir}/scripts/restore.mjs --backup-dir /绝对路径/备份目录
node {baseDir}/scripts/upgrade.mjs --source /绝对路径/新源码
```

`backup.mjs` 是运维级完整备份；`export-workspace.mjs` 仅允许 `owner` 使用，输出可迁移的
销售业务数据并排除密钥、Provider 原文和 OpenViking 内部 URI。两类文件都包含私密业务
数据，默认以 `0600` 保存，禁止提交到仓库。

关键业务写操作、Provider 探测和工作区导出会写入脱敏审计事件；`admin` 和 `owner`
可通过 `/api/admin/audit-events` 查询，普通成员不能读取。

恢复默认只预检；执行写入还需原恢复脚本要求的 `--apply`、独立目标和确认参数。升级前先停止服务并建议备份。

## 9. 卸载

保留配置、日志、备份和云端数据：

```bash
node {baseDir}/scripts/uninstall.mjs
```

只有用户明确要求清除本机私有配置和备份时才执行：

```bash
node {baseDir}/scripts/uninstall.mjs --purge --yes
```

两种方式都不删除 Supabase 或 OpenViking 云端数据。

## 维护 Skill 应用包

仓库源码通过测试后，由维护者同步到 Skill：

```bash
node {baseDir}/scripts/sync-assets.mjs
node {baseDir}/scripts/self-test.mjs
```

同步脚本排除密钥、依赖、日志、备份和临时文件；自测使用隔离目录和假凭证，不访问外部服务。

## 参考资料

- `references/cookbook-workflow.md`：从需求澄清到真实业务验收的 Cookbook 映射。
- `references/setup.md`：安装、目录、数据库初始化和首次启动。
- `references/architecture.md`：前后端、Provider、Supabase 和 OpenViking 边界。
- `references/provider-configuration.md`：配置项、凭证和生产门槛。
- `references/feishu-import.md`：Codex CLI + 飞书 CLI 导入链路。
- `references/evidence-policy.md`：事实、来源、档案和问答规则。
- `references/security.md`：密钥、权限、备份和开源边界。
- `references/troubleshooting.md`：常见故障和恢复步骤。
