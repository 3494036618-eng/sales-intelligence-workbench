# 安装与首次配置

## 本机要求

- Node.js 20 或更高版本。
- 可访问的 Agent Plan、DataPro、豆包搜索、Agent Plan Supabase 和 OpenViking 资源。
- 需要飞书资料同步时，安装并登录 `lark-cli`。
- 数据库迁移、备份或恢复需要火山 Supabase 控制面凭证及 CLI。

## 私有目录

| 内容 | 默认路径 |
| --- | --- |
| 只读应用运行时 | `~/.local/share/sales-intelligence-workbench/app` |
| 私密配置 | `~/.config/sales-intelligence-workbench` |
| 日志、PID、doctor 证据和备份 | `~/.local/state/sales-intelligence-workbench` |

配置文件和状态目录权限为 `0700`，凭证文件为 `0600`。源码目录、运行目录和配置目录必须分开。

## 首次部署顺序

优先反复运行 `onboard.mjs`。它会根据阶段状态自动完成本地安装、配置引导和启动，并在需要云资源写入、真实调用、登录、资料导入或业务验收时暂停。手工排障时按以下顺序执行：

1. `install.mjs` 安装应用并执行测试。
2. `configure.mjs` 写入真实资源配置。
3. `setup-supabase.mjs` 查看 Supabase 初始化计划。
4. 用户确认目标后运行 `setup-supabase.mjs --apply --yes`，自动获取 Data API 配置、执行迁移、创建应用 Workspace 记录并回读。
5. 配置 Supabase Auth 密码恢复和受保护的本机或内网入口；当前 Beta 是单工作区、单人使用模式。
6. 运行 `doctor.mjs`。
7. 告知用户会产生少量用量后运行 `doctor.mjs --live`。
8. 运行 `start.mjs`，确认 API 与 Worker 均启动，再从 `status.mjs` 获取网址。

## 从现有工程迁移

使用 `configure.mjs --from-env-file <path>` 读取现有 `.env.local`。脚本只复制白名单配置项，并把秘密与普通配置拆分；不会修改或打印源文件。迁移后仍要运行 doctor，不能把“文件里有值”等同于服务可用。

## 数据库首次初始化

Skill 复用应用包中的版本化 `supabase/migrations`。目标必须是北京地域的 Agent Plan Workspace；初始化脚本会只读检查 `is_agent_plan` / `is_agent_plan_instance` 与 Running 状态，普通按量 Workspace 会被拒绝。

先登录一个明确的 Agent Plan CLI profile，并在私密 `runtime.env` 中设置 `SUPABASE_CLI_PROFILE=agent-plan`：

```bash
byted-supabase-cli login --profile agent-plan --region cn-beijing --is-agent-plan
```

`setup-supabase.mjs` 默认只显示计划，只有 `--apply --yes` 才读取端点与 API Key、写本机配置并执行 SQL。指定 profile 后，脚本会忽略旧的静态 AK/SK，防止连到另一个账号。业务运行使用 Supabase Data API；控制面 CLI 仅用于首次初始化、迁移、资源管理、备份和恢复。

脚本不会创建云 Workspace，因为该操作可能持续计费。需要新建时，先由用户确认目标套餐、地域和自动休眠时间，再由有 `aidap:CreateWorkspace` 权限的账号执行 `byted-supabase-cli projects create <name> --profile agent-plan --is-agent-plan`，随后把返回的 Workspace ID 填入 `configure.mjs`。

恢复不得覆盖当前生产分支。先创建独立空工作区或独立空分支，完成预检、校验哈希和行数后再按恢复脚本要求显式确认。
