---
description: "测试 generate_report 工具的 TURN-END 阻断与 UI 渲染"
author: "Dline Team"
version: "1.0"
category: "Testing"
tags: ["testing", "generate_report", "turn-end", "ui-rendering"]
globs: ["test-generate-report/**/*.md"]
---

<task name="generate_report 工具功能与渲染测试">

<task_objective>
按给定条件调用 generate_report 工具。每次调用后回显工具返回文本，观察 UI 渲染情况和 TURN-END 行为。
</task_objective>

<detailed_sequence_steps>
# generate_report 测试 - 详细步骤

## 步骤 1：TURN-END 阻断 + UI 渲染

调用 generate_report 带标题和内容：
```
<generate_report>
<title>项目架构分析报告</title>
<content>## 背景
当前项目采用模块化设计，包含以下关键模块：
- 核心引擎
- Webview UI
- Proto 通信层

## 建议
建议优先优化 Proto 序列化性能。</content>
</generate_report>
```

**预期：** ✅ TURN-END ask 流程。UI 显示 GenerateReportRow，标题 "项目架构分析报告"。**无 approve 按钮**。用户文字回复后 AI 继续。

## 步骤 2：无 title

不传 title：
```
<generate_report>
<content>这是一个快速审查报告，无标题。</content>
</generate_report>
```

**预期：** ✅ 报告框显示默认标题 "Report"。

## 步骤 3：TURN-END 并行顺序

在并行调用启用时，确认 generate_report 排最后执行。

**预期：** ✅ generate_report 在并行调用中排最后，不与其他工具同时执行。

## 步骤 4：报告

写入 `test-generate-report/test-report.md`：

```
## generate_report 测试 — 报告

### 步骤 1 — TURN-END 阻断 + 渲染
**预期：** ask 阻断，显示 GenerateReportRow，无 approve 按钮
**实际返回文本：** [工具返回文本]
**UI 观察：** [报告框渲染，按钮检查]
**结果：** ✅ PASS / ❌ FAIL

### 步骤 2 — 无 title
**预期：** 默认 "Report"
**UI 观察：** [标题文本]
**结果：** ✅ PASS / ❌ FAIL

### 步骤 3 — TURN-END 并行顺序
**预期：** generate_report 排最后
**UI 观察：** [工具执行顺序]
**结果：** ✅ PASS / ❌ FAIL

### 汇总
| # | 测试项 | 预期 | 结果 |
|---|-------|------|------|
| 1 | TURN-END + 渲染 | GenerateReportRow，无 approve | |
| 2 | 无 title | 默认 "Report" | |
| 3 | 并行顺序 | 排最后 | |
```
</detailed_sequence_steps>

</task>
