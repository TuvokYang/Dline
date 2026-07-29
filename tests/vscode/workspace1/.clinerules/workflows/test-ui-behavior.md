---
description: "测试 Dline UI 行为：命令执行状态、取消、output 显示、Plan↔Act 切换、approval 反馈一致性。"
author: "Dline Team"
version: "1.1"
category: "Testing"
tags: ["testing", "ui", "command-execution", "running-cancel", "output-display", "plan-act-switch", "approval-feedback"]
globs: []
---

<task name="UI 功能行为测试">

<task_objective>
系统化测试 Dline 的 5 个核心 UI 交互行为：

1. **Running 状态 & Cancel 按钮** —— 长时间命令显示运行态、取消按钮出现并能成功取消。
2. **Command output 不替换 command row** —— output 独立展示在 command 下方, 不覆盖 command 行。
3. **attempt_completion 命令 output 可见** —— attempt_completion 的 command/output 正确渲染, 无文本丢失。
4. **Plan→Act 切换输入框清除** —— 输入框在模式切换时清除并将内容作为 user_feedback 发送。
5. **Approval 反馈一致性** —— focus_chain_change Reject 时反馈文字和图片正确传递, focus chain 被拒绝。

> ⚠️ **关键执行顺序**：测试 3 (attempt_completion) 会结束当前任务，**必须最后执行**。
> 推荐顺序：1 → 2 → 4 → 5 → 3。
</task_objective>

<detailed_sequence_steps>
# UI 功能行为测试 - 详细步骤

## 测试 1：Running 状态 & Cancel 按钮

**目的**：验证长时间命令显示 "Running" 状态、Cancel 按钮出现并可取消。

**操作流程**：
1. AI 执行命令 `ping -n 10 127.0.0.1`（Windows，约 10 秒运行时间）。
2. 在命令执行期间观察 UI：
   - 验证点 1：状态是否显示 "Running"（而非 "Completed"）。
   - 验证点 2：Cancel 按钮是否出现。
3. **在命令完成前**点击 Cancel 按钮。
   - 验证点 3：命令是否被取消，是否出现 resume 提示。

**期望结果**：
- ✅ 命令执行中显示 "Running" 状态。
- ✅ Cancel 按钮可见且可点击。
- ✅ 点击 Cancel 后命令终止，出现 resume。

**⚠️ 已知陷阱**：
- 如果 ping 全部执行完毕才点 Cancel，则 Cancel 无效（命令已完成）。
- **必须在 ping 仍未完成时点击 Cancel**（建议在第 2-3 个 reply 后点击）。
- 如果第一次未成功取消，需重试（AI 应重新执行命令）。

**预期系统消息**：
- 用户点击 Cancel 后，终端输出显示部分 ping 结果，系统报告：
  > `Command was cancelled by the user.`
- 取消后应出现 `resume` 提示。

---

## 测试 2：Command output 不替换 command row

**目的**：验证 `echo "hello world"` 这类快速命令的 command 消息行被保留，output 出现在下方。

**操作流程**：
1. AI 执行 `echo "hello world"`。
2. 等待命令完成。
3. 观察 UI 中的消息展示：
   - 验证点 1：command 消息行是否保留（未被 output 替换或覆盖）。
   - 验证点 2：output 是否正确显示在 command 下方。

**期望结果**：
- ✅ Command 行保留，如 `echo "hello world"` 可见。
- ✅ Output 文本 `hello world` 显示在 command 下方，无渲染异常。

**预期系统消息**：
- `Command executed successfully (exit code 0).` + output 内容。

---

## 测试 4：Plan→Act 切换输入框清除

**目的**：验证 Plan→Act 模式切换时输入框内容被清除，且清除的内容作为 user_feedback 发送给 AI。

**操作流程**：
1. 用户切换到 Plan 模式。
2. AI 检测到 Plan 模式后调用 `make_plan` 响应。
3. 用户在输入框中输入任意文本（如「测试切换」）。
4. 用户按快捷键切换 Plan→Act。
5. 观察：
   - 验证点 1：输入框内容在切换时是否被清除（切换后输入框为空）。
   - 验证点 2：输入的内容是否作为 user_feedback 发送给 AI（AI 收到该文本作为上下文）。

**期望结果**：
- ✅ 切换后输入框为空。
- ✅ AI 收到的 user_feedback 与输入文本一致。

**⚠️ 已知陷阱**：
- Plan→Act 切换后，系统环境检测可能有短暂延迟（仍显示 ACT MODE，但 `make_plan` 仍可正常工作）。
- 可追加多次测试以验证一致性。

**预期系统消息**（切换后）：
```
[The user has switched to ACT MODE, so you may now proceed with the task.]
The user also provided the following message when switching to ACT MODE:
<user_message>用户输入的文字</user_message>
```

---

## 测试 5：Approval 反馈一致性

**目的**：验证 `focus_chain_change` 工具触发 approval 流程时，用户输入反馈文字 + 上传图片后点 Reject，反馈内容和 focus chain 状态正确。

**操作流程**：
1. AI 调用 `focus_chain_change` 工具（触发用户审批），reason 应包含暗示请用户拒绝（如「测试用，请拒绝」）。
2. 在 approval 对话框中，用户输入反馈文字（如「不同意此计划」），并上传一张图片。
3. 用户点击 **Reject**（⚠️ 务必点 Reject，非 Approve）。
4. 观察：
   - 验证点 1：反馈文字和图片是否作为 user_feedback 发送给 AI。
   - 验证点 2：focus chain 是否未被修改（原计划被拒绝）。

**期望结果**：
- ✅ AI 收到反馈文字和图片。
- ✅ focus chain 保持拒绝前的状态，未应用 `focus_chain_change` 的变更。

**⚠️ 已知陷阱**：
- 容易误点 Approve 导致测试失败。若 Approve 了，需再次触发后点 Reject。
- 图片上传功能需确认已支持。

**预期系统消息**：
- 若点击 **Approve**：
  > `Focus chain plan has been updated with the approved items.`
- 若点击 **Reject**：
  > `Focus chain override was denied by user. Continue with the current plan. Ask the user for next steps if needed.`

---

## 测试 3：attempt_completion 命令 output 可见

> ⚠️ **此测试会结束当前任务，必须最后执行！**（推荐顺序 1→2→4→5→3）

**目的**：验证 `attempt_completion` 工具附带的 command 参数和其 output 均正确显示，无文本丢失。

**操作流程**：
1. AI 在所有其他测试完成后，调用 `attempt_completion` 工具，附带 `command` 参数（如 `echo "done"`）。
2. 执行完成后观察 UI：
   - 验证点 1：command 是否显示（如 `echo "done"`）。
   - 验证点 2：output 文本是否完整显示，无截断或丢失。
   - 验证点 3：测试报告表格是否在 output 中保留。

**期望结果**：
- ✅ Command 和 output 均正确展示。
- ✅ Output 文本无丢失、无截断。

**⚠️ 已知陷阱**：
- 此测试必须在所有其他测试完成后执行。
- attempt_completion 之后任务结束，用户若仍需继续则需通过 feedback 机制。

**预期系统消息**：
- 命令执行成功：
  > `Command executed successfully (exit code 0). Output: "done"`

---

## 测试报告

测试完成后，汇总以下格式的表格：

| 测试 | 场景 | 关键验证点 | 结果 |
|------|------|-----------|------|
| 1 | Running 状态 & Cancel 按钮 | Running 标识 / Cancel 按钮 / 取消后 resume | PASS/FAIL |
| 2 | Command output 不替换 command row | command 行保留 / output 独立显示 | PASS/FAIL |
| 3 | attempt_completion 命令 output 可见 | command + output 完整展示 | PASS/FAIL |
| 4 | Plan→Act 切换输入框清除 | 输入框清除 / user_feedback 发送 | PASS/FAIL |
| 5 | Approval 反馈一致性 | 反馈内容传递 / focus chain 拒绝 | PASS/FAIL |

---

## 本次测试中观察到的系统消息汇总

以下是 2026-06-16 实际测试过程中系统返回的关键消息：

### ✅ 正常消息

| 消息 | 来源 | 触发条件 |
|------|------|----------|
| `Command executed successfully (exit code 0).` | execute_command | ping / echo 正常完成 |
| `"hello world"` | echo output | `echo "hello world"` |
| `"done"` | attempt_completion output | `attempt_completion` 附带 `command="echo \"done\""` |
| `Focus chain plan has been updated with the approved items.` | focus_chain_change（Approve） | 测试 5 第一次误点 Approve |
| `[The user has switched to ACT MODE]...<user_message>...</user_message>` | 模式切换 | Plan→Act 切换时 |

### ❌ Reject / Deny / Cancel

| 消息 | 来源 | 触发条件 |
|------|------|----------|
| `Command was cancelled by the user.` | execute_command（Cancel） | 用户点击 Cancel 中断 ping |
| `Focus chain override was denied by user. Continue with the current plan.` | focus_chain_change（Reject） | 用户输入反馈文字+图片后点击 Reject |

### ⚠️ 系统约束 / 警告

| 消息 | 来源 | 触发条件 |
|------|------|----------|
| `Focus chain update rejected. The task_progress checklist...` | task_progress 校验 | AI 修改了 plan 结构（非仅 toggle checkbox）—— tamperingRejected |
| `[ERROR] You did not use a tool in your previous response! Please retry with a tool use.` | 系统自动 | ACT MODE 下 AI 仅发送文本未调用工具 |

### 📋 模式切换观察

- Plan 模式下 `make_plan` 可正常调用，环境检测有 1-2 秒延迟。
- Plan→Act 切换后，输入框文本自动转为 `<user_message>` 发送给 AI。
</detailed_sequence_steps>

</task>
