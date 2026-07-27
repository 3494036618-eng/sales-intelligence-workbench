# 文档目录

这里仅保留可随开源包公开的技术文档，不包含内部调研、客户资料、录屏或历史验收证据。

- [Beta 发布与生产演进路线图](production-readiness-roadmap.md)：当前完成度、Beta 边界和后续生产阶段。
- [单工作区自托管 Beta 发布验收清单](release-checklist.md)：公开 Beta 前必须逐项确认的工程、安全和法律门槛。
- [API 合约](api/api-contract.md)：公开接口、认证授权、任务状态和响应边界。
- [Supabase 数据库说明](database/supabase-schema.md)：表、RLS、迁移、事务 RPC 和 smoke 检查。
- [单工作区自托管部署](deployment/self-hosting.md)：HTTPS 反向代理、双进程托管、健康检查与回滚边界。
- [变更记录](../CHANGELOG.md)：发布版本的新增能力、安全变化和已知限制。
- [第三方组件与外部服务说明](../THIRD_PARTY_NOTICES.md)：分发依赖、外部服务及许可边界。

首次了解项目请从根目录 [README](../README.md) 开始。部署或升级前同时阅读路线图与发布验收清单。
