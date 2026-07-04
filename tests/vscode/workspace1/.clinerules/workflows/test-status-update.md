---
description: "测试 status_update 工具的 say/ask 双路径与连续调用阻止"
author: "Dline Team"
version: "1.0"
category: "Testing"
tags: ["testing", "status_update", "ui-rendering", "acknowledgment"]
globs: ["test-status-update/**/*.md"]
---

<task name="status_update 工具功能与渲染测试">

<task_objective>
按给定条件调用 status_update（含 requires_acknowledgment）。每次调用后回显工具返回文本，观察 UI 渲染情况。
</task_objective>

<detailed_sequence_steps>
# status_update 测试 - 详细步骤

## 步骤 1：默认路径（say，不阻断）

调用 status_update，不传 requires_acknowledgment：
```
<status_update>
<response>正在检查项目结构，准备开始实现功能。</response>
</status_update>
```

**预期：** ✅ 返回 ack，AI 继续。UI 显示声明框（StatusUpdateRow），标题 "Status Update"。

## 步骤 2：requires_acknowledgment（ask，阻断）

传 requires_acknowledgment=true：
```
<status_update>
<response>此操作将修改核心配置文件，请确认后继续。</response>
<requires_acknowledgment>true</requires_acknowledgment>
</status_update>
```

**预期：** ✅ ask 流程，显示声明框 + "知晓/停止"按钮。点击"知晓"→AI 继续；点击"停止"→AI 收到停止信号。

## 步骤 3：连续调用阻止

连续两次调用：
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

**预期：** ✅ 第一次正常返回。第二次返回 `[BLOCKED] You cannot call status_update consecutively.`

## 步骤 4：报告

写入 `test-status-update/test-report.md`：

```
## status_update 测试 — 报告

### 步骤 1 — 默认路径
**预期：** say 不阻断，显示 StatusUpdateRow
**实际返回文本：** [工具返回文本]
**UI 观察：** [渲染框是否出现，标题]
**结果：** ✅ PASS / ❌ FAIL

### 步骤 2 — requires_acknowledgment
**预期：** ask 阻断 + "知晓/停止"按钮
**实际返回文本：** [工具返回文本]
**UI 观察：** [按钮是否显示，点击行为]
**结果：** ✅ PASS / ❌ FAIL

### 步骤 3 — 连续调用阻止
**预期：** 第二次 BLOCKED
**实际返回文本：** [工具返回文本]
**结果：** ✅ PASS / ❌ FAIL

### 汇总
| # | 测试项 | 预期 | 结果 |
|---|-------|------|------|
| 1 | say 不阻断 | ack + StatusUpdateRow | |
| 2 | ask 阻断 | "知晓/停止"按钮 | |
| 3 | 连续阻止 | 第二次 BLOCKED | |
```
</detailed_sequence_steps>

</task>
