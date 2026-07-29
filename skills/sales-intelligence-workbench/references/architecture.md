# 运行架构

```text
浏览器
  -> 同源 Node HTTP 服务
     -> frontend 静态文件
     -> /api 路由
        -> SalesService
           -> AI Native 应用开发底座（Supabase）持久化任务队列
独立 Worker
  -> 原子领取 / 租约 / 心跳
  -> 专业数据集（DataPro）/ 豆包搜索（联网搜索）/ Agent Plan 模型
  -> AI Native 应用开发底座（Supabase）Data API Repository

Codex CLI / 前端导入入口
  -> 飞书 CLI
  -> Agent 记忆（OpenViking）资料正文
  -> AI Native 应用开发底座（Supabase）同步元数据

资料问答
  -> AI Native 应用开发底座（Supabase）当前档案
  -> Agent 记忆（OpenViking）资料召回 / Session / 长期记忆
```

## 核心边界

- AI Native 应用开发底座（Supabase）是业务事实库：企业、目标、档案版本、公开引用、同步源、资料/会话索引、Job、Provider Run、权限和审计持久化在这里。
- Agent 记忆（OpenViking）是飞书资料正文、资料问答 Session 和长期记忆的唯一内容存储；它不代替 Supabase 的关系型业务状态。
- 专业数据集（DataPro）提供企业主体和专业数据候选；豆包搜索（联网搜索）提供公开来源候选。
- 最新档案只允许模型使用 DataPro 与豆包搜索的已校验证据；问答只允许使用当前档案和 OpenViking 召回的企业内部资料。
- 飞书 CLI 使用当前用户授权读取云文档和消息；后端负责幂等导入、增量游标、企业归属和 OpenViking 写入。
- 前端只显示后端状态，不保存最终业务事实，也不持有任何 Provider 密钥。

## 运行边界

项目只有一种运行方式：真实 Provider 和 Supabase 必须完整，缺少配置或依赖失败时关闭对应业务操作。自动化测试可以显式注入测试数据和替身 Provider，但这些能力不进入应用配置、用户界面或发行资产。

## API 与 Worker

Skill 启动两个 Node 进程：API 进程同时提供前端和同源 `/api`，Worker 进程执行已持久化的长任务。页面不需要第二个前端服务或跨域配置。Worker 不直接对外监听端口，进度和结果只通过 Supabase 任务记录与 API 返回。

页面取消运行任务时，API 只写入取消请求；Worker 在当前 Provider 调用返回后的检查点确认取消。确认前租约和付费预约保持有效，任务不可重试，避免同一业务操作并行调用两次上游能力。
