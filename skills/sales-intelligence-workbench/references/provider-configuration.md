# Provider 配置

## 凭证对应关系

| 能力 | 私密配置 | 说明 |
| --- | --- | --- |
| 模型、DataPro、豆包搜索、OpenViking、视觉模型 | `AGENT_PLAN_API_KEY` | 同一枚 Agent Plan 专属 API Key；对应能力仍需在套餐和 Harness 配置中开通 |
| 能力专用覆盖（可选） | `MODEL_API_KEY`、`DATAPRO_API_KEY`、`WEB_SEARCH_API_KEY`、`OPENVIKING_API_KEY`、`VISION_API_KEY` | 仅用于独立轮换或排障；未设置时统一回退到 `AGENT_PLAN_API_KEY` |
| OpenViking 连接信息 | `OPENVIKING_BASE_URL` | 也可复用 `~/.openviking/ovcli.conf`；`OPENVIKING_AGENT_ID` 默认 `default` |
| Supabase Data API | `SUPABASE_SERVICE_ROLE_KEY` | 只在后端进程使用 |
| Supabase 控制面 | `SUPABASE_CLI_PROFILE`（推荐）或同账号 AK/SK | 初始化、迁移、备份和真实控制面探针 |

不要把这些值放入前端、README、日志、截图、Provider Run 或 Git。

模型、DataPro、豆包搜索、OpenViking 和视觉模型默认使用同一枚 `AGENT_PLAN_API_KEY`。豆包搜索、专业数据集和 OpenViking 仍必须先在 Agent Plan 控制台的“使用配置 → 配置 Harness”中开启对应能力。Supabase 使用独立的 Data API/Service Role 和控制面凭证，不能被 Agent Plan Key 替代。

## production 必需配置

- `APP_MODE=production`
- `REPOSITORY_MODE=supabase`
- `SUPABASE_READ_ONLY=false`
- `SUPABASE_API_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`APP_WORKSPACE_ID`
- `HTTP_AUTH_ENABLED=true`；本地回环 HTTP 使用 `AUTH_COOKIE_SECURE=false`，非回环生产部署必须使用 HTTPS 并设为 `true`
- `AUTH_REDIRECT_URL` 指向用户实际打开工作台的 HTTPS 根地址，并在 Supabase Auth 的 Redirect URLs 中加入完全一致的地址；本地默认值是 `http://127.0.0.1:8787/`
- Supabase Auth 必须配置可用的邮件发送服务。正式公网部署使用自有 SMTP，并完成发件域名、邀请邮件和密码恢复邮件验证
- `ALLOWED_ORIGINS` 只列出实际部署来源，不使用 `*`
- `PAID_WORKFLOW_MAX_CONCURRENCY` 和 `PAID_WORKFLOW_DAILY_LIMIT` 必须为正整数；默认分别为 `2` 和 `100`
- `PAID_WORKFLOW_BUDGET_TIMEZONE` 默认 `Asia/Shanghai`；`PAID_WORKFLOW_STALE_AFTER_SECONDS` 默认 `1800`
- `ASYNC_JOBS_ENABLED=true`；`JOB_WORKER_LEASE_SECONDS` 不低于 `60`，默认 `600`
- `SUPABASE_CLI_PROFILE` 指向已用 `--is-agent-plan` 登录的 profile，目标 Workspace 具备 Agent Plan 属性
- 模型、DataPro、联网搜索和 OpenViking 已配置且各自 `*_RUN_ENABLED=true`
- 所有 `SALES_*` 演示开关为 `false`

视觉模型是可选项。飞书 CLI 导入由 `FEISHU_CLI_IMPORT_ENABLED` 控制；旧配置
`FEISHU_SYNC_ENABLED` 仍兼容。启用时 doctor 必须检测到 `lark-cli`。任务数量上限可用
`FEISHU_CLI_IMPORT_TASK_LIMIT` 调整；该任务状态当前只在 API 进程内保存。

OpenViking 保存飞书正文，并按官方“确认或创建会话 → 逐条添加消息 → 提交会话”流程保存资料问答记忆。提交频率和保留的近期消息数可分别用 `OPENVIKING_QA_AUTO_COMMIT_EVERY`、`OPENVIKING_QA_KEEP_RECENT_MESSAGES` 调整。使用本地 CLI 配置时，应用只在后端读取其中的 URL 和 API Key，不会复制到前端或日志。

密码恢复由后端调用 Supabase Auth 接口发信。浏览器收到回跳链接后会立即清除地址栏中的令牌片段，并只在当前页面内存中使用该短期令牌设置密码。`SUPABASE_SERVICE_ROLE_KEY` 始终留在后端；任何恢复令牌或用户密码都不得写入日志、截图或前端持久化存储。

## doctor 语义

- 默认 doctor：检查本机目录、权限、配置结构和 production 门槛，不调用外部服务。
- `--live`：发起最小只读模型、DataPro、联网搜索、OpenViking 和 Supabase 检查，可能产生少量 AFP/Token。
- production 启动要求配置 doctor 通过。live doctor 结果会按 `LIVE_DOCTOR_TTL_MS`（默认 15 分钟）标记新鲜度并展示在运维状态中，但上游临时故障不会阻止其他独立能力启动。

`--live` 默认以 `北京火山引擎科技有限公司` 做只读 DataPro/Web Search 探针；如组织策略要求使用其他公开主体，可设置 `LIVE_PROBE_COMPANY`。该值只用于诊断，不会写入目标企业池。

配置存在不代表权限、余额、网络和上游服务正常；只有 live doctor 能证明当时的可达性。
业务操作仍按 Provider 严格失败：例如联网搜索故障时不能生成声称包含最新公开动态的档案，也不会退回演示来源。

## 付费工作流保护

企业搜索、档案生成、资料问答、资料导入、OpenViking 批量同步、问答记忆提交和同步源删除在调用对应 Provider 前，先在 Supabase 中原子预约名额。任务成功或失败会释放并发名额；等待任务可立即取消，运行任务则在 Worker 到达安全检查点后确认取消并释放，避免尚未结束的 Provider 调用与重试并行。超过时限的遗留预约会自动标记过期，暂停/恢复等纯数据库状态修改不占用付费名额。

`PAID_WORKFLOW_DAILY_LIMIT` 统计的是付费工作流尝试次数。一次档案生成可能包含 DataPro、豆包搜索和模型多个步骤；一次资料问答还会包含 OpenViking 召回与 Session 写入。因此该值用于防止失控调用，不能作为 AFP 或金额报表。精确用量应结合 Provider Run 的 Token/调用记录与官方账单。

生产数据库必须依次应用到 `202607230003_safe_job_cancellation.sql`。迁移缺失时应用会返回 `503`，不会退化为单进程内存队列或请求内假成功。档案和 OpenViking 批量同步先持久化入队，Worker 原子领取后才建立付费预约；预约后的异常不会自动重复调用 Provider。
