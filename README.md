# 销售智能工作台

销售智能工作台把企业专业数据、公开信息、飞书资料和长期记忆组织成可追溯的企业档案与资料问答。项目包含完整前后端、Supabase 数据层、OpenViking 记忆链路，以及可安装和运维应用的 Codex Skill。

> 当前为 `0.9.0` Beta，仅支持单工作区、单人使用，以及本机或受控内网自托管。已支持 Supabase Auth、工作区数据隔离、安全请求边界、工作区级付费任务保护、持久化异步任务队列和独立 Worker。首版不提供公网生产 SaaS、多人协作或 SLA；不要把 Node.js 服务端口直接暴露到公网。

## 核心能力

- 通过 DataPro 解析真实企业主体并加入目标企业池。
- 仅使用专业数据集和豆包搜索生成带引用的最新档案，避免内部资料混入外部事实报告。
- 使用 Codex CLI 调度飞书 CLI，增量导入云文档、群聊、单聊或消息搜索结果。
- 将飞书资料正文和资料问答会话按 Workspace、企业隔离写入 OpenViking，并在问答前真实检索和恢复。
- 使用 Supabase 保存企业、档案版本、引用、任务、工作区归属、Provider 运行记录，以及资料与会话的同步元数据。
- 后端记录任务状态、失败原因、模型 Token 和 Provider 调用证据，供诊断接口与日志审计；正式业务前端不展示后台配置和运维信息。
- 通过 Supabase Auth 保护业务与付费调用；当前 Beta 供单个用户使用，不提供成员邀请与角色管理。
- 企业搜索、档案、问答、资料导入、OpenViking 同步/提交和资源删除统一经过工作区级并发与每日次数保护。
- 连续可重试的 Provider 故障达到阈值后会临时熔断；冷却结束只放行一次恢复探测，避免持续超时拖垮工作台。
- 档案生成和 OpenViking 批量同步通过 Supabase 持久化队列交给独立 Worker；页面可恢复任务进度。运行中取消采用“请求取消—安全检查点确认”机制，不会在 Provider 调用尚未结束时提前释放付费预约或允许并行重试。
- 档案证据按专业、官方公开、可追溯公开和内部授权资料分级，并校验公开来源时效、关键数字冲突及高风险事实双来源一致性。
- 提供安装、配置、诊断、启停、迁移、备份、恢复、升级和卸载命令。

## 真实性原则

`production` 模式禁止演示数据、固定报告和静态 Provider 兜底。DataPro、联网搜索、OpenViking 或模型失败时，依赖该能力的操作会明确失败，不会生成看似真实的替代结果。关键结论必须关联实际来源；生成“最新档案”至少需要一个可追溯且有 180 天内日期的公开来源。注册资本、营收、净利润、融资、估值及明确司法/处罚事实必须满足双来源规则，关键数字不一致时不能自行选择。来源没有可核验日期时，界面显示“未知”，不会用档案生成时间冒充资料时间。

`demo` 模式只用于隔离录屏，不属于正式 Skill 的配置入口，也不会连接真实 Provider 或正式数据库。

## 架构

```text
浏览器
  -> 同源 Node.js 服务
     -> /api
        -> 销售业务编排
           -> Supabase 持久化任务队列
独立 Worker
  -> 原子领取任务与续租
  -> Agent Plan 模型 / DataPro / 豆包联网搜索
  -> OpenViking 资料与对话记忆 / Supabase Data API

Codex CLI / 前端导入入口
  -> 飞书 CLI
  -> 受控导入任务
     -> OpenViking 保存资料正文
     -> Supabase 保存来源、游标和业务索引
```

Supabase 是结构化业务事实库；OpenViking 是飞书资料正文、资料问答 Session 和长期记忆的唯一内容存储。两者通过稳定的企业、来源、资料和会话 ID 关联，不重复保存正文或问答内容。

## 使用 Skill 从 0 搭建

### 面向最终用户：一句话初始化

公开仓库并创建不可变 release tag 后，维护者生成最终口令：

```bash
npm run skill:command -- \
  --repository https://github.com/<组织>/<仓库> \
  --ref v0.9.0
```

把命令输出的整句话交给用户。用户只需在 Codex 中发送：

> 帮我初始化销售助手：`https://raw.githubusercontent.com/<组织>/<仓库>/v0.9.0/docs/agents/skills/sales-assistant-builder.md`

该 URL 直接返回一份公开 Builder Skill。Codex 会先解释下载与本机写入影响并取得同意，
再从 URL 锁定的 release 取得完整仓库，执行离线校验、安装正式 Skill，并立即衔接下面的
Cookbook 搭建流程。读取 URL 本身不会创建云资源或产生 AFP。公开入口文件见
[销售助手 Builder](docs/agents/skills/sales-assistant-builder.md)。

当前目录还没有公开 Git 远端和 release tag，因此上面的 `<组织>/<仓库>` 不是可发送给
外部用户的真实地址。发布者必须先完成仓库公开、LICENSE 确认和 release 验收，再用生成
脚本得到最终 URL；不得把占位地址写进宣传材料。

### 面向维护者：本地安装

克隆仓库后，在仓库根目录安装 Skill：

```bash
npm run skill:install
```

重新启动 Codex 后直接描述业务目标：

> 按 Cookbook 步骤帮我搭建销售团队工作台。目标是服务新能源汽车企业客户，历史资料来自飞书云文档和会话，部署在本机。

也可以明确输入：

> 请使用 $sales-intelligence-workbench 搭建我的销售团队工作台。

Skill 会先确认销售目标和资料范围，再通过可恢复的安全编排器安装经过测试的完整前后端模板，依次连接 Agent Plan 模型与 Harness、Agent Plan Supabase、OpenViking 和授权资料，最后运行真实企业搜索、档案及资料问答验收。它不会为每位用户临时拼一套静态前端，也不会用演示数据冒充完成；云资源写入、真实调用、登录和业务验收都会停下来取得用户确认。

继续上次搭建或让 Skill 自动推进安全步骤：

```bash
node skills/sales-intelligence-workbench/scripts/onboard.mjs
```

只读查看当前阶段和唯一下一步：

```bash
node skills/sales-intelligence-workbench/scripts/setup.mjs
```

更新已安装 Skill：

```bash
npm run skill:install -- --force
```

完整阶段与验收标准见 [Cookbook 搭建流程](skills/sales-intelligence-workbench/references/cookbook-workflow.md)。下面的手工命令适合排障或不通过 Agent 运行时使用。

## 前置条件

- Node.js 20 或更高版本。
- 可用的 Agent Plan 模型、DataPro 和豆包联网搜索权限。
- 北京地域、已启用 Agent Plan 抵扣的火山引擎 Supabase Workspace。
- OpenViking 服务或本地 CLI。
- 可选：已安装并以用户身份登录的 `lark-cli`。
- 数据库初始化、迁移和备份需要 `byted-supabase-cli` 及相应控制面权限。

密钥只能写入本机私密配置或部署平台 Secret，不要粘贴到 Issue、日志、截图或提交记录。

## 安装

```bash
node skills/sales-intelligence-workbench/scripts/install.mjs
node skills/sales-intelligence-workbench/scripts/configure.mjs
```

已有私密环境文件时可迁移，脚本不会修改或打印源文件：

```bash
node skills/sales-intelligence-workbench/scripts/configure.mjs \
  --from-env-file /absolute/path/to/backend/.env.local \
  --mode production
```

### 初始化 Supabase

先用 Agent Plan 身份登录 Supabase CLI，并把 profile 名写入私密配置的 `SUPABASE_CLI_PROFILE`：

```bash
byted-supabase-cli login --profile agent-plan --region cn-beijing --is-agent-plan
```

需要新建 Workspace 时，先确认持续计费与休眠策略，再由有 `aidap:CreateWorkspace` 权限的账号执行：

```bash
byted-supabase-cli projects create <workspace-name> --profile agent-plan --is-agent-plan
```

先查看计划，不写资源：

```bash
node skills/sales-intelligence-workbench/scripts/setup-supabase.mjs
```

确认目标 Workspace 后执行：

```bash
node skills/sales-intelligence-workbench/scripts/setup-supabase.mjs --apply --yes
```

该命令会先确认目标是 Agent Plan Workspace，再获取 Data API 地址和 Service Role Key、写入本机 `0600` 配置、应用版本化迁移、创建应用 Workspace 记录并回读验证。普通按量 Workspace 会被拒绝；命令不会创建、暂停或删除云 Workspace。

### 诊断与启动

配置检查不调用外部服务：

```bash
node skills/sales-intelligence-workbench/scripts/doctor.mjs
```

在用户知情会产生少量模型、DataPro 和搜索用量后，执行真实只读检查：

```bash
node skills/sales-intelligence-workbench/scripts/doctor.mjs --live
```

单个上游临时故障不会阻止查看已有数据或使用无关能力；依赖故障 Provider 的操作仍会严格失败。启动并查看地址：

```bash
node skills/sales-intelligence-workbench/scripts/start.mjs
node skills/sales-intelligence-workbench/scripts/status.mjs
```

`start.mjs` 会同时启动同源 API 和独立 Worker；`status.mjs` 分别报告两个进程。生产模式缺少队列迁移或 Worker 配置时会失败关闭，不会退回同步假成功。

首次打开页面时，需要在浏览器中创建个人登录账号。完成后，匿名请求无法读取业务数据，付费 Provider 和运维接口仅对该登录账号开放。

密码恢复需要在 Supabase Auth 配置可用邮件服务，并把 `AUTH_REDIRECT_URL` 加入允许的 Redirect URLs。正式公网部署应配置自有 SMTP；重置链接回跳后，浏览器只在内存中使用短期令牌完成密码设置，并立即清除地址栏中的令牌片段。

## 导入飞书资料

项目规定由 Codex CLI 调度飞书 CLI，使用当前用户授权读取，不依赖群机器人：

```bash
node skills/sales-intelligence-workbench/scripts/login.mjs --email <your-email>
```

上述命令会在终端隐藏输入密码，并把用户级短期会话保存为权限 `0600` 的本机文件。随后执行：

```bash
node skills/sales-intelligence-workbench/scripts/import-feishu.mjs \
  --company-id <company-id> \
  --doc "https://example.feishu.cn/wiki/..."
```

会话导入支持 `--p2p-user <联系人姓名>` 或 `--chat-id <oc_会话ID>`；云文档只接受完整链接。启用 `FEISHU_CLI_IMPORT_ENABLED=true` 后，登录用户也可以在“历史资料”模块点击“导入飞书资料”，选择会话或云文档并查看本机任务进度。两种入口调用同一条受控链路：正文只写入 OpenViking，Supabase 只保存来源、内容指纹、增量游标和 OpenViking 引用。详见 [飞书导入说明](skills/sales-intelligence-workbench/references/feishu-import.md)。

## 运维

```bash
node skills/sales-intelligence-workbench/scripts/backup.mjs
node skills/sales-intelligence-workbench/scripts/stop.mjs
node skills/sales-intelligence-workbench/scripts/upgrade.mjs --source /absolute/path/to/new-source
node skills/sales-intelligence-workbench/scripts/uninstall.mjs
```

恢复默认只预检，并要求独立空目标、显式 `--apply` 和确认参数。卸载默认保留私密配置、备份和云端数据。

公网自托管需要 HTTPS 反向代理，并分别托管 API 与 Worker。配置和 systemd/Nginx 示例见 [单工作区自托管部署](docs/deployment/self-hosting.md)。

包含数据库迁移的升级应先在服务仍运行时检查待发布源码，再应用向后兼容迁移，最后短暂停机替换运行时：

```bash
node skills/sales-intelligence-workbench/scripts/migrate.mjs --source /absolute/path/to/new-source
node skills/sales-intelligence-workbench/scripts/migrate.mjs --source /absolute/path/to/new-source --apply
node skills/sales-intelligence-workbench/scripts/smoke-paid-workflow.mjs --source /absolute/path/to/new-source
node skills/sales-intelligence-workbench/scripts/smoke-async-job-queue.mjs --source /absolute/path/to/new-source
node skills/sales-intelligence-workbench/scripts/stop.mjs
node skills/sales-intelligence-workbench/scripts/upgrade.mjs --source /absolute/path/to/new-source
node skills/sales-intelligence-workbench/scripts/start.mjs
```

## 开发与验证

```bash
npm run verify
```

根目录总验收会先检查 Skill 结构和隔离安装生命周期，再执行后端离线发布验收。整个流程依次覆盖前端语法、后端测试、发布密钥、Skill 分发包一致性和隔离安装生命周期，不访问外部 Provider，也不会产生 AFP。需要单独执行时可使用：

```bash
cd backend && npm test
cd backend && npm run release:secrets
node skills/sales-intelligence-workbench/scripts/sync-assets.mjs
node skills/sales-intelligence-workbench/scripts/sync-assets.mjs --check
node skills/sales-intelligence-workbench/scripts/self-test.mjs
```

真实业务链路可先使用 Skill 的 `verify-business-chain.mjs --confirm-live` 验证企业搜索与加入、带引用档案、OpenViking 召回/写入、资料问答、Provider Run 和 Token。该命令会产生 AFP/Token 并保留业务记录；飞书增量导入、重启持久化、版本比较、备份与独立恢复仍需按发布清单补充。任何一步使用固定前端数据都不通过。

## 已知限制

- 当前是单工作区、单人自托管架构；不提供成员邀请与角色管理，也尚未支持企业 SSO、MFA 和多工作区管理。
- 本机默认使用 HTTP；公网部署需自行配置 HTTPS 反向代理，并启用 Secure Cookie。
- 已有 IP/用户级限流、请求体上限、Workspace 付费任务保护、Provider 熔断和独立异步 Worker；生产库必须应用到 `202607230003`。当前仍没有精确 AFP/金额预算。
- 当前持久化异步队列覆盖档案生成和 OpenViking 批量同步；前端飞书导入使用后端进程内受控任务，服务重启后任务进度不会恢复，但已成功写入的 OpenViking 正文和 Supabase 同步元数据不会丢失。首个稳定版还需把导入任务迁入持久化队列，并完成高可用 Worker 和容量压测。
- 飞书读取范围受当前用户权限和飞书 CLI 能力限制，不能绕过平台权限。
- 新建 Supabase Workspace 可能持续计费，因此 Skill 不会未经确认自动创建。
- 上游 Provider 可用性由服务方决定，诊断成功不代表长期 SLA。

## Beta 发布门槛

逐项执行并留存结果：[单工作区自托管 Beta 发布验收清单](docs/release-checklist.md)。

- 发布变化见 [变更记录](CHANGELOG.md)，外部能力与分发边界见 [第三方组件与外部服务说明](THIRD_PARTY_NOTICES.md)。
- 由代码所有方确认开源授权与 [LICENSE](LICENSE)；许可证文件存在不等于已完成公司内部代码产权审批。
- 完成干净外部机器安装和真实浏览器端到端验收。
- 首版只支持单工作区、单人、本机或受控内网自托管；公网生产配置属于后续版本，不作为当前 Beta 的能力承诺。
- 执行密钥、真实客户资料、截图、日志和第三方版权材料清查。

安全问题请参阅 [SECURITY.md](SECURITY.md)，贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。
