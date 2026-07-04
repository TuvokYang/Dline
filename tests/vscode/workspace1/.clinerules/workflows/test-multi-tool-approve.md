---
description: "测试单轮多个工具调用（同类型和不同类型）的连续 approve 流程、中断恢复后已执行工具不重现、以及并行结果批量返回 AI。"
author: "Dline Team"
version: "1.0"
category: "Testing"
tags: ["testing", "approve", "multi-tool", "parallel", "resume", "partial-result"]
globs: ["test-multi-tool/**/*.md", "test-multi-tool/**/*.py"]
---

<task name="单轮多工具连续 Approve 与 Resume 测试">

<task_objective>
验证同一轮 assistant 消息中包含多个工具调用时：
1. **连续 approve**：逐个 approve 同类型工具（spawn_task）和不同类型工具（execute_command + read_file + write_to_file），按钮不灰色、不跳过
2. **中断恢复**：在只完成部分工具时退出任务再 resume，已执行工具不重现，未执行工具正常等待 approve
3. **批量返回**：全部完成后，所有工具结果一次性返回给 AI
</task_objective>

<detailed_sequence_steps>
# 单轮多工具 Approve 测试 - 详细步骤

## 步骤 0：清理测试环境

删除以下文件（如果存在）：
- `test-multi-tool/src/` 目录及其所有内容

用 write_to_file 创建 `test-multi-tool/report.md`，写入：

```
## test-multi-tool 单轮多工具 Approve 测试 — 报告

> 执行时间：(当前时间)

---
```

---

# 测试 1：同类型工具连续 Approve（3 个 spawn_task）

## 步骤 1A：触发 3 个 spawn_task

**目标**：在一轮中让 AI 同时发起 3 个 spawn_task 调用，验证连续 approve 不会出现按钮变灰或跳过的 bug。

**操作**：告知 AI：「请在同一轮中并行发起 3 个 spawn_task：sub-1 执行 `echo "spawn-1"`，sub-2 执行 `echo "spawn-2"`，sub-3 执行 `echo "spawn-3"`。」

**验证点**：
1. UI 中依次出现 3 个 spawn_task 的 approve 请求
2. 逐个点击 Approve，按钮始终可点击（不变灰）
3. 第 3 个 approve 后，3 个子任务全部创建成功

**追加写入 `test-multi-tool/report.md`：**

```
### 测试 1: 同类型工具连续 Approve（3 × spawn_task）

| 步骤 | 预期 | 实际 | 匹配 |
|------|------|------|------|
| 第 1 个 spawn_task Approve 按钮可点击 | ✅ | | |
| 第 2 个 spawn_task Approve 按钮可点击 | ✅ | | |
| 第 3 个 spawn_task Approve 按钮可点击 | ✅ | | |
| 无自动跳过（一次点击只 approve 一个） | ✅ | | |
| 3 个子任务全部创建 | ✅ | | |

---
```

---

# 测试 2：不同类型工具连续 Approve（execute_command + read_file + write_to_file）

## 步骤 2A：触发混合类型工具

**目标**：验证不同类型工具（command、readFile、newFileCreated）的连续 approve。

**操作**：告知 AI：「请在同一轮中执行以下操作：
1. 执行 `echo "multi-tool-test"` 命令
2. 读取 `test-multi-tool/report.md` 文件
3. 创建 `test-multi-tool/result.txt` 写入 `multi-tool-test-complete`」

**验证点**：
1. 依次出现 command approve、readFile approve、newFileCreated approve
2. 按钮不灰色，每种类型正常 approve
3. 全部完成

**追加写入 `test-multi-tool/report.md`：**

```
### 测试 2: 不同类型工具连续 Approve（command + readFile + write）

| 步骤 | 预期 | 实际 | 匹配 |
|------|------|------|------|
| command Approve 可点击 | ✅ | | |
| readFile Approve 可点击 | ✅ | | |
| write Approve 可点击 | ✅ | | |
| echo 命令执行成功 | ✅ | | |
| report.md 读取成功 | ✅ | | |
| result.txt 创建成功且内容正确 | ✅ | | |

---
```

---

# 测试 3：中断恢复 — 已执行工具不重现

## 步骤 3A：触发 3 个 execute_command + 中途退出

**目标**：验证 resume 后，已 approve 并执行完成的工具不会重新出现。
使用 `execute_command`（`requires_approval=true`），因为 write_to_file 在 auto-approve 开启时直接通过。

**操作**：
1. 告知 AI：「请在同一轮中使用 requires_approval=true 执行：
   - `echo "resume-test-A"`
   - `echo "resume-test-B"`
   - `echo "resume-test-C"`」
2. **只 approve 前 2 个**（A 和 B），第 3 个（C）**不 approve**
3. 在 C 的 approve 出现时，**退出当前任务**（关闭 tab 或点击 New Task）

## 步骤 3B：Resume 验证

1. 从 History 中重新进入该任务
2. 验证：
   - A 的 approve **不重现**（已执行）
   - B 的 approve **不重现**（已执行）
   - C 的 approve **出现**（未执行）
   - 对话历史中包含 A 和 B 的执行结果

**追加写入 `test-multi-tool/report.md`：**

```
### 测试 3: 中断恢复 — 已执行工具不重现

| 步骤 | 预期 | 实际 | 匹配 |
|------|------|------|------|
| echo A approve 重现 | ❌ 不重现 | | |
| echo B approve 重现 | ❌ 不重现 | | |
| echo C approve 重现 | ✅ 重现 | | |
| A 结果在上下文可见 | ✅ | | |
| B 结果在上下文可见 | ✅ | | |

---
```

## 步骤 3C：完成剩余工具

1. Approve C
2. 验证 C 执行成功

**追加写入 `test-multi-tool/report.md`：**

```
| C approve 后执行成功 | ✅ | | |

---
```

---

# 最终汇总

追加写入 `test-multi-tool/report.md`：

```
### 汇总表

| # | 测试 | 关键验证点 | 结果 |
|---|------|-----------|------|
| 1 | 同类型连续 Approve | 按钮不变灰、不跳过 | |
| 2 | 不同类型连续 Approve | 混合工具类型正常 approve | |
| 3 | 中断恢复 | 已执行不重现、未执行正常 | |

### 最终结论

1. **连续 approve 按钮可用性**：PASS（全部正常）/ FAIL（存在灰色/跳过）
2. **不同类型工具兼容**：PASS / FAIL
3. **中断恢复正确性**：echo A、B 不重现 → PASS / FAIL
4. **整体评价**：PASS（全部通过）/ FAIL（存在不通过项）
```
</detailed_sequence_steps>

</task>
