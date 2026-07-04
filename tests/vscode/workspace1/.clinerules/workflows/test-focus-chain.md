---
description: "测试 Dline focus chain 的任务顺序校验、精确匹配机制、两级顺序警告及 focus_chain_change 工具行为。"
author: "Dline Team"
version: "2.0"
category: "Testing"
tags: ["testing", "focus-chain", "validation", "skip-order", "item-text-mismatch", "focus-chain-change"]
globs: ["test-tools/**/*.ts"]
---

<task name="Focus Chain 行为测试">

<task_objective>
执行以下六个测试场景，每个场景结束后记录 task_progress 或 focus_chain_change 操作的系统响应。完成后生成测试报告。

**重要：task_progress 新规则**
- 首次创建清单时：传完整清单（含 # Title、## Section、- [ ] 项）
- 之后每次更新：
  - **进行中**：传当前步骤的 `- [ ]` 项（精确原文），系统显示 `<- CURRENT`
  - **已完成**：传 `- [x]` 项（精确原文），不传完整清单
- 完整清单由系统在 environment_details 中自动展示
- **严禁修改计划内容**。如需变更，使用 focus_chain_change 获取用户授权
- **虚假 `- [x]` 提交将阻断下一轮工具调用**

**重要：检查系统提醒文本和 Webview 错误消息**
- 每次操作后，检查系统是否返回了 focus chain 相关的提醒/警告/拒绝文本（给 AI 的 prompt 注入）
- **同时检查 webview 中是否出现了红色的 "Focus Chain" 错误/警告消息（给用户的 ErrorRow 渲染）**
- 检查提示词和错误消息内容是否合理、无乱码、无语义错误
- 在测试报告中将系统提醒文本和 webview 错误消息原文分别记录下来
- 如果消息有异常，在备注中标注
- **当 focus chain 错误连续发生 3 次时，预期会看到 "⚠️ Focus Chain: AI has failed to update the task plan" 的严重提醒**
</task_objective>

<detailed_sequence_steps>
# Focus Chain 行为测试 - 详细步骤

## 测试 1：正常按序执行

**初始 task_progress（首次创建，传完整清单）**：
\`\`\`
# 创建 TypeScript 工具函数
## 数学运算
- [ ] 编写 add 函数
- [ ] 编写 subtract 函数
- [ ] 编写 multiply 函数
\`\`\`

**操作流程**：
1. 在 `test-tools/utils/` 下创建或追加数学运算函数。
2. **第一步**：完成 `add` 函数后，task_progress **只传完成项**（不传完整清单）：
   \`\`\`
   - [x] 编写 add 函数
   \`\`\`
3. **第二步**：完成 `subtract` 函数后，继续只传完成项：
   \`\`\`
   - [x] 编写 subtract 函数
   \`\`\`
4. **第三步**：完成 `multiply` 函数后：
   \`\`\`
   - [x] 编写 multiply 函数
   \`\`\`

---

## 测试 2：同一 section 内跳过前面的 item（第一次跳跃 — 警告）

**初始 task_progress（首次创建，传完整清单）**：
\`\`\`
# 验证参数
## 边界检查
- [ ] 检查输入是否为 null
- [ ] 处理空字符串边界情况
- [ ] 验证输出格式
\`\`\`

**操作流程**：
1. 跳过第一项，直接标记第二项为完成：
   \`\`\`
   - [x] 处理空字符串边界情况
   \`\`\`
2. 发送此 task_progress 给系统。**预期**：系统接受更新但发出严厉警告，提示必须按顺序执行，下次跳跃将拒绝。
3. **再次跳项**（测试第二次跳跃）：
   \`\`\`
   - [x] 验证输出格式
   \`\`\`
4. 发送此 task_progress。**预期**：系统拒绝更新，提示这是第二次跳跃违规，要求按顺序先完成前面的未完成项。

---

## 测试 3：跨 section 跳过前面的 item（第一次跳跃 — 警告）

**初始 task_progress（首次创建，传完整清单）**：
\`\`\`
# 数据处理流水线
## Section A：读取与解析
- [ ] 读取配置文件
- [ ] 解析 JSON
## Section B：验证与输出
- [ ] 验证数据模型
- [ ] 返回结果
\`\`\`

**操作流程**：
1. 跳过 Section A 中所有未完成项，直接标记 Section B 第一项为完成：
   \`\`\`
   - [x] 验证数据模型
   \`\`\`
2. 发送此 task_progress 给系统。**预期**：系统接受更新但发出严厉警告，提示必须按顺序执行。

---

## 测试 4：修改 item 文本（精确匹配失败）

**初始 task_progress（首次创建，传完整清单）**：
\`\`\`
- [ ] 检查输入参数
\`\`\`

**操作流程**：
1. 报告完成项时使用了与清单中**不同的文本**（简化了描述）：
   \`\`\`
   - [x] 检查输入参数是否有效
   \`\`\`
2. 发送此 task_progress 给系统。**预期**：系统拒绝更新，提示报告的完成项文本与清单中原文字不匹配，要求使用精确原文。

---

## 测试 5：焦点链变更（普通模式，无 auto-approve 勾选）

**前置条件**：确保 focus chain auto-approve 设置未勾选。

**初始 task_progress（首次创建，传完整清单）**：
\`\`\`
# 编写工具函数
## 开发
- [ ] 实现 add 函数
- [ ] 实现 subtract 函数
\`\`\`

**操作流程**：
1. 调用 `focus_chain_change` 工具，传入新的 plan：
   - new_plan：包含两个新 section 和 item
   - reason："将任务拆分为更细粒度的步骤"

2. 在 webview 中观察 focus_chain_change 的渲染形式——是否存在可交互的 checkbox 和 Approve/Deny 按钮。

3. 手工勾选部分 item（不全选），点击 Approve。

4. 记录系统响应及 focus chain 文件的最终内容。

---

## 测试 6：焦点链变更（auto-approve 勾选）

**前置条件**：在设置中勾选 focus chain 的 auto-approve。

**初始 task_progress（首次创建，传完整清单）**：
\`\`\`
# 编写工具函数
## 开发
- [ ] 实现 multiply 函数
- [ ] 实现 divide 函数
\`\`\`

**操作流程**：
1. 调用 `focus_chain_change` 工具，传入新的 plan：
   - new_plan：包含新的 section 和 item
   - reason：""（空字符串）

2. 在 webview 中观察 focus_chain_change 的渲染形式。

3. 记录：
   - webview 中是否渲染了 plan 内容
   - checkbox 是否可交互
   - 右上角是否显示了标签（标签文本是什么）
   - 是否需要用户手动点击 Approve

4. 记录 focus chain 文件的最终内容。

---

## 测试报告

完成以上 6 个测试后，输出测试报告：

### 测试结果表格

| 测试 | 场景 | 操作 | 系统响应 | 系统提醒文本（原文） | Webview 错误消息（原文） | 备注 |
|------|------|------|----------|---------------------|------------------------|------|
| 1 | 正常按序标记 | 依次传三个完成项 | | | （无错误） | 检查 environment_details，全部完成后是否有 completed 提示 |
| 2 | 同 section 内跳项 | 第1次→警告；第2次→拒绝 | | | 第1次："Focus Chain Warning: AI skipped..."<br>第2次："Focus Chain: AI skipped items again..." | 验证两级警告，记录 webview 显示的消息 |
| 3 | 跨 section 跳项 | 跳 Section A 标记 Section B | | | "Focus Chain: AI skipped items again..." 或 "Focus Chain: AI attempted to..." | 前一section未完成→直接拒绝，记录 webview 消息 |
| 4 | 修改 item 文本 | 使用与清单不同文本报告完成 | | | "Focus Chain: AI reported completed items that don't match..." | 记录 webview 拒绝消息，检查 unmatched 项列表 |
| 5 | focus_chain_change 普通模式 | 无 auto-approve 时调用 focus_chain_change | | | （无错误） | 记录 focus_chain_change 提示 |
| 6 | focus_chain_change auto-approve | auto-approve 勾选时调用 focus_chain_change | | | （无错误） | 记录 auto-approve 提示 |
| 7 | - [ ] 进行中标记 | 正常传当前步骤 + 跳过标记下一项 | | | 当前步骤显示 `<- CURRENT`；跳过触发警告 | 验证 environment_details 中 CURRENT 标记 |
| 8 | - [x] mismatch 工具阻断 | 报告不存在的 - [x] 项 | | | "Focus Chain: AI reported fabricated progress. Next tool calls BLOCKED." | 验证下一轮工具调用被拒绝 |

注意， 测试报告写在测试目录的 report.md，同时调用attempt_completed工具显示简要的测试结果。
</detailed_sequence_steps>

</task>
