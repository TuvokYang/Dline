---
description: "测试新增工具 status_update 和 generate_report 的功能与渲染"
author: "Dline Team"
version: "1.0"
category: "Testing"
tags: ["testing", "status_update", "generate_report", "ui-rendering", "turn-end"]
globs: ["test-new-tools/**/*.md"]
---

<task name="新增工具功能与渲染测试">

<task_objective>
按给定条件调用 status_update（含 requires_acknowledgment）和 generate_report 工具。
每次调用后回显工具返回的原始文本，观察 UI 渲染情况。记录实际行为与预期对比，按报告格式汇总。
</task_objective>

<detailed_sequence_steps>
# 新增工具功能测试 - 详细步骤

## 步骤 1：status_update — 默认路径（say，不阻断）

在 ACT 模式下，调用 status_update，不传 requires_acknowledgment：
```
<status_update>
<response>正在检查项目结构，准备开始实现功能。</response>
</status_update>
```

**预期结果：** ✅ 工具返回 ack，AI 不被打断继续执行。UI 显示声明框（StatusUpdateRow），标题 "Status Update"。

## 步骤 2：status_update — 带 requires_acknowledgment（ask，阻断）

在 ACT 模式下，调用 status_update，传 requires_acknowledgment=true：
```
<status_update>
<response>此操作将修改核心配置文件，请确认后继续。</response>
<requires_acknowledgment>true</requires_acknowledgment>
</status_update>
```

**预期结果：** ✅ 工具进入 ask 流程，显示声明框 + "知晓/停止"按钮。点击"知晓"后 AI 继续。点击"停止"后 AI 收到停止信号。

## 步骤 3：status_update — 连续调用被阻止

连续两次调用 status_update：
```
<status_update>
<response>第一阶段完成。</response>
</status_update>
```
紧接着：
```
<status_update>
<response>开始第二阶段。</response>
</status_update>
```

**预期结果：** ✅ 第一次调用正常返回。第二次调用返回 `[BLOCKED] You cannot call status_update consecutively.` 错误。

## 步骤 4：generate_report — TURN-END 阻断

在 ACT 模式下，调用 generate_report：
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

**预期结果：** ✅ 工具进入 ask 流程（TURN-END），显示报告渲染框（GenerateReportRow），标题 "项目架构分析报告"。无 approve 按钮。用户可以输入文字回复后 AI 继续。

## 步骤 5：generate_report — 无 title

调用 generate_report 不传 title：
```
<generate_report>
<content>这是一个快速审查报告，无标题。</content>
</generate_report>
```

**预期结果：** ✅ 报告框显示标题 "Report"（默认值）。

## 步骤 6：TURN-END 验证 — generate_report 不与其他工具并行

在包含多个工具调用的消息中（如并行调用启用时），确认 generate_report 被排到最后执行（因为它是 TURN-END 工具）。

**预期结果：** ✅ generate_report 在并行调用中排到最后，不会与其他工具同时执行。

## 步骤 7：报告

整理报告写入 `test-new-tools/test-report.md`，格式如下：

```
## 新增工具功能测试 — 报告

### 步骤 1 — status_update 默认路径
**预期：** say 不阻断，显示 StatusUpdateRow
**实际返回文本：** [工具返回的原始文本]
**UI 观察：** [渲染框是否出现，标题是否正确]
**结果：** ✅ PASS / ❌ FAIL

### 步骤 2 — status_update requires_acknowledgment
**预期：** ask 阻断，显示 "知晓/停止" 按钮
**实际返回文本：** [工具返回的原始文本]
**UI 观察：** [按钮是否显示，点击行为是否正确]
**结果：** ✅ PASS / ❌ FAIL

### 步骤 3 — status_update 连续调用阻止
**预期：** 第二次返回 BLOCKED
**实际返回文本：** [工具返回的原始文本]
**结果：** ✅ PASS / ❌ FAIL

### 步骤 4 — generate_report TURN-END
**预期：** ask 阻断，显示 GenerateReportRow，无 approve 按钮
**实际返回文本：** [工具返回的原始文本]
**UI 观察：** [报告框渲染，按钮是否存在]
**结果：** ✅ PASS / ❌ FAIL

### 步骤 5 — generate_report 无 title
**预期：** 显示默认标题 "Report"
**UI 观察：** [标题文本]
**结果：** ✅ PASS / ❌ FAIL

### 步骤 6 — TURN-END 并行顺序
**预期：** generate_report 排最后
**UI 观察：** [工具执行顺序]
**结果：** ✅ PASS / ❌ FAIL

---

### 汇总

| # | 测试项 | 预期 | 实际 | 结果 |
|---|-------|------|------|------|
| 1 | status_update say 不阻断 | 返回 ack，UI 显示 StatusUpdateRow | | |
| 2 | status_update ask 阻断 | 显示 "知晓/停止" 按钮 | | |
| 3 | status_update 连续阻止 | 第二次 BLOCKED | | |
| 4 | generate_report TURN-END | 显示 GenerateReportRow，无 approve | | |
| 5 | generate_report 无 title | 默认 "Report" | | |
| 6 | TURN-END 并行顺序 | generate_report 排最后 | | |

### 观察总结
[基于 6 个步骤的执行结果与预期对比，列出关键观察发现]
```
</detailed_sequence_steps>

</task>
