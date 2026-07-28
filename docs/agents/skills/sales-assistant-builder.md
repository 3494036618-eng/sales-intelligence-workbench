---
name: sales-assistant-builder
description: 销售智能工作台旧版公开初始化兼容入口。新用户应直接使用同一仓库、同一版本下的 skills/sales-intelligence-workbench/SKILL.md。
---

# 销售助手 Builder 兼容入口

本文件仅为已经发出的旧链接保留兼容性，不再维护第二套初始化流程。新的唯一公开入口是
同一仓库、同一版本下的：

```text
skills/sales-intelligence-workbench/SKILL.md
```

如果 Agent 读取到本文件，应从当前 URL 解析 GitHub 仓库和 `<ref>`，然后读取同版本的主
`SKILL.md`，完全按其中“远程 Skill 入口”继续。不得继续执行本文件中的旧流程，也不得把
本文件作为宣传材料中的初始化地址。
