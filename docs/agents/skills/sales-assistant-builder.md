---
name: sales-assistant-builder
description: 销售智能工作台公开初始化入口。用户说“帮我初始化销售助手”并提供本文件的公开 URL 时，先安全取得并校验完整开源仓库，再安装 sales-intelligence-workbench Skill，按照 Cookbook 收集销售目标、连接 Agent Plan Harness、Agent Plan Supabase、OpenViking 和飞书资料，启动并验收真实数据驱动的销售工作台。
---

# 销售助手 Builder

本文件是销售智能工作台的**公开启动入口**。用户只需在 Codex 中输入：

```text
帮我初始化销售助手：<本文件的公开 HTTPS URL>
```

你的任务不是解释这份文档，也不是临时生成一个演示页面，而是安全取得正式发行包，
转入仓库内完整的 `sales-intelligence-workbench` Skill，并陪用户完成可恢复的搭建流程。

## 完成标准

只有同时满足以下条件，才可以说“销售助手已经可以使用”：

1. 完整开源仓库已从用户给出的可信 URL 对应版本取得。
2. Skill 包和随包应用已通过离线校验。
3. 已确认用户的销售目标、客户范围、资料来源和运行方式。
4. Agent Plan 模型、DataPro、豆包搜索、Agent Plan Supabase 和 OpenViking 均按完整
   Skill 的要求配置并通过对应验收。
5. 需要飞书资料时，已由 Codex CLI 调度已登录的飞书 CLI 完成授权范围内的导入。
6. API 与 Worker 均已启动，真实企业搜索、档案和资料问答链路已经验收。
7. 已向用户说明地址、当前阶段、实际验证结果、费用动作和未完成项。

任一条件未满足，都要准确说明停在哪一步，不得用 Mock、固定报告、静态前端或旧结果
冒充完成。

## 1. 识别可信源码

从用户消息中保留本文件的入口 URL，并据此确定仓库和版本：

- `https://raw.githubusercontent.com/<owner>/<repo>/<ref>/docs/agents/skills/sales-assistant-builder.md`
  对应仓库 `https://github.com/<owner>/<repo>.git` 和版本 `<ref>`。
- `https://github.com/<owner>/<repo>/blob/<ref>/docs/agents/skills/sales-assistant-builder.md`
  对应同一仓库和版本。

正式发布命令应使用不可变的 release tag，不要默认把 `main` 当作稳定发行版。若入口不是
上述 GitHub 形式，且正文没有明确给出可信源码仓库与版本，暂停并请发布方补充；不得猜测
仓库地址，也不得从搜索结果下载同名项目。

## 2. 说明动作并取得同意

先向用户说明下一步只会：

1. 把公开仓库的指定版本下载到临时目录。
2. 运行离线结构、密钥和安装生命周期检查。
3. 检查通过后把 Skill 安装到 Codex 用户目录。

此阶段不创建云资源、不调用模型或 Harness、不产生 AFP。下载外部代码和写入 Codex Skill
目录前必须取得用户同意；用户拒绝时停止。

## 3. 下载并离线校验

取得同意后，在临时目录克隆 URL 对应的仓库和版本。不要复用来源不明的同名本地目录。
进入仓库根目录后先确认这些文件存在：

```text
package.json
scripts/validate-skill-package.mjs
scripts/test-skill-installer.mjs
skills/sales-intelligence-workbench/SKILL.md
skills/sales-intelligence-workbench/scripts/onboard.mjs
skills/sales-intelligence-workbench/assets/app/backend/package.json
skills/sales-intelligence-workbench/assets/app/frontend/index.html
```

然后执行：

```bash
node scripts/validate-skill-package.mjs
node scripts/test-skill-installer.mjs
```

两项检查都通过才可继续。失败时保留原始错误并停止，不使用 `--skip-tests`，也不自行拼装
缺失文件。

## 4. 安装完整 Skill

在仓库根目录运行：

```bash
npm run skill:install
```

已有旧版时先说明将更新本机 Skill，再运行：

```bash
npm run skill:install -- --force
```

安装只复制 Skill、脚本和经过测试的应用包，不会写云资源或调用付费 Provider。当前会话
无需等待重启：立即读取已下载仓库中的
`skills/sales-intelligence-workbench/SKILL.md`，并把它作为后续唯一完整流程。
安装后的 Skill 用于未来会话自动触发。

## 5. 转入完整搭建流程

按完整 Skill 的第 0 阶段开始，先用一到两问一轮的方式确认：

1. 工作台名称和最重要的销售目标。
2. 目标行业、区域或客户范围。
3. 是否导入飞书云文档、会话，或首版暂不导入。
4. 本机或受控内网运行。
5. 是否已购买 Agent Plan。

确认后调用完整 Skill 自带的安全编排器。不要把密钥写在命令或聊天里：

```bash
node skills/sales-intelligence-workbench/scripts/onboard.mjs \
  --workspace-name "<工作台名称>" \
  --sales-goal "<销售目标>" \
  --target-scope "<行业、区域或客户范围>" \
  --sources feishu_docs,feishu_chats \
  --deployment local
```

此后完全遵循本地 `SKILL.md`：遇到 Supabase 写入、真实 Provider 调用、用户登录、飞书
导入和付费业务验收时暂停，说明影响并取得单独确认。不要把“入口文件已读取”或“应用已
复制”说成“工作台已经可用”。

## 安全边界

- 不要求用户在聊天中粘贴 API Key、Token、Cookie、密码或飞书凭据。
- 不未经确认安装外部代码、修改 MCP/CLI 配置、创建持续计费资源或触发真实调用。
- 不修改仓库业务前端来伪造配置成功；后台配置和诊断信息不得暴露到普通业务页面。
- 不把 Agent Plan API Key 与 OpenViking 数据面凭据混用。
- 不绕过飞书用户权限，不导入用户无权处理的资料。
- 每完成一步都说明：做了什么、为什么做、当前阶段、下一步、是否产生外部调用或费用。

