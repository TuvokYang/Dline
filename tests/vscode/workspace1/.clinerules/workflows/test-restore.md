---
description: "测试四种 checkpoint restore 类型在 ignore 目录与非 ignore 目录下的行为一致性。验证增量 git add -f 是否将 exclude 文件纳入 checkpoint。"
author: "Dline Team"
version: "3.0"
category: "Testing"
tags: ["testing", "checkpoint", "restore", "exclude", "task", "workspace", "taskAndWorkspace"]
globs: ["test-restore/**/*.md", "test-work1/**/*.md"]
---

<task name="Checkpoint Restore 功能测试">

<task_objective>
四个 restore 类型各自测试，**每个测试独立执行**，确保每次都有可用的 checkpoint 和 restore 按钮。
每完成一个 restore 验证，立即将结果追加写入 `test-restore/report.md`，防止上下文因下次 restore 丢失。

**Restore 操作方法**：点击 checkpoint 消息旁的 restore 按钮：
- **Restore Chat Only** → `task` restore
- **Restore Files Only** → `workspace` restore（在 More options 中）
- **Restore Chat & Files** → `taskAndWorkspace` restore
- **Restore Chat & Files** + 编辑输入文本 → `taskAndWorkspace+edited` restore

**判断 restore 是否生效**：
1. 对话中有 `[TASK RESUMPTION]` 系统提示
2. 对话中有 `Task messages have been restored` / `Workspace files have been restored` / `Task and workspace have been restored`
3. `read_file` 检查文件版本号
</task_objective>

<detailed_sequence_steps>
# Checkpoint Restore 测试 - 详细步骤

## 步骤 0：清理测试环境

用 delete_files 或直接覆盖写入删除以下文件（如果存在）：
- `test-restore/ignore-file.md`
- `test-work1/normal-file.md`
- `test-restore/report.md`

用 write_to_file 创建 `test-restore/report.md`，写入报告标题：

```
## test-restore Checkpoint Restore 测试 — 报告

> 执行时间：(当前时间)

---
```

---

# 测试 1：Restore Chat Only（task）

## 步骤 1A：创建文件 V1 + 触发 checkpoint

用 write_to_file 创建 `test-restore/ignore-file.md`：
```
# Test Restore — Ignored File
Version: V1
```

再用 write_to_file 创建 `test-work1/normal-file.md`：
```
# Test Restore — Normal File
Version: V1
```

> 此时步骤 1A 完成后会自动生成一个 checkpoint 消息。

用 read_file 确认两个文件均存在且含 `Version: V1`。

完成后告知用户：
**「请点击步骤 1A 完成后的 **checkpoint 消息** 旁的 restore 按钮，选择 **Restore Chat Only**。完成后回复我。」**

---

## 步骤 1B：验证 Restore Chat Only

用户执行 restore 后，对话中会出现 `[TASK RESUMPTION]` 和 `Task messages have been restored to the checkpoint`。

执行以下验证：
1. 检查对话中是否有 `[TASK RESUMPTION]` 系统提示
2. 用 read_file 读取 `test-restore/ignore-file.md`，记录版本号
3. 用 read_file 读取 `test-work1/normal-file.md`，记录版本号

**立即追加写入 `test-restore/report.md`：**

```
### 测试 1: Restore Chat Only (task)

**系统提示出现：** (是/否 — 填入实际)
**预期：** 对话回滚，文件保留（文件系统不受 chat restore 影响）

| 文件 | 预期 | 实际 | 匹配 |
|---|---|---|---|
| ignore-file.md (exclude) | 文件存在 | (存在/不存在) | ✅/❌ |
| ignore-file.md 版本 | V1（文件系统不变） | (V1/V2/不存在) | ✅/❌ |
| normal-file.md | 文件存在 | (存在/不存在) | ✅/❌ |

**结论：** chat restore 是否只影响对话不影响文件系统：✅/❌

---
```

---

## 步骤 1C：清理

删除 `test-restore/ignore-file.md` 和 `test-work1/normal-file.md`，准备下一个测试。

---

# 测试 2：Restore Files Only（workspace）— 关键验证 exclude 文件

## 步骤 2A：创建 V1 → checkpoint + 修改 V2

用 write_to_file 创建 `test-restore/ignore-file.md`（V1）：
```
# Test Restore — Ignored File
Version: V1
```

用 write_to_file 创建 `test-work1/normal-file.md`（V1）：
```
# Test Restore — Normal File
Version: V1
```

> 此时生成 checkpoint（V1 版本）。

**现在修改两个文件为 V2**（用 replace_in_file，SEARCH: `Version: V1` → REPLACE: `Version: V2`）。

> 此时生成第二个 checkpoint（V2 版本）。

用 read_file 确认两个文件均为 `Version: V2`。

完成后告知用户：
**「请点击 **第一个 checkpoint 消息**（对应 V1 版本，即步骤 2A 创建文件后的那一条）旁的 restore 按钮，打开 More options，选择 **Restore Files Only**。完成后回复我。」**

---

## 步骤 2B：验证 Restore Files Only

用户执行 restore 后，对话中会出现 `Workspace files have been restored to the checkpoint`。

执行以下验证：
1. 用 read_file 读取 `test-restore/ignore-file.md`，记录版本号 — **这是关键验证**
2. 用 read_file 读取 `test-work1/normal-file.md`，记录版本号

**立即追加写入 `test-restore/report.md`：**

```
### 测试 2: Restore Files Only (workspace)

**系统提示出现：** (是/否)
**预期：** 仅文件恢复为 V1，对话不变

| 文件 | 预期 | 实际 | 匹配 |
|---|---|---|---|
| ignore-file.md (exclude) | ⚠️ V1 — 验证增量 -f | (V1/V2) | ✅/❌ |
| normal-file.md | V1 | (V1/V2) | ✅/❌ |

**关键结论：** 增量 git add -f 是否将 exclude 文件纳入 checkpoint → (基于 ignore-file.md 结果判断)

---
```

---

## 步骤 2C：清理

删除两个测试文件，准备下一个测试。

---

# 测试 3：Restore Chat & Files（taskAndWorkspace）

## 步骤 3A：创建 V1 → checkpoint + 修改 V2

用 write_to_file 创建 `test-restore/ignore-file.md`（V1）和 `test-work1/normal-file.md`（V1）。
> checkpoint：V1。

然后用 replace_in_file 将两个文件改为 V2。
> checkpoint：V2。

用 read_file 确认两个文件均为 `Version: V2`。

完成后告知用户：
**「请点击 **第一个 checkpoint 消息**（V1 版本）旁的 restore 按钮，选择 **Restore Chat & Files**。完成后回复我。」**

---

## 步骤 3B：验证 Restore Chat & Files

用 read_file 读取两个文件，记录版本号。

**立即追加写入 `test-restore/report.md`：**

```
### 测试 3: Restore Chat & Files (taskAndWorkspace)

**系统提示出现：** (是/否)
**预期：** 对话回滚 + 文件恢复为 V1

| 文件 | 预期 | 实际 | 匹配 |
|---|---|---|---|
| ignore-file.md (exclude) | V1 | (V1/V2) | ✅/❌ |
| normal-file.md | V1 | (V1/V2) | ✅/❌ |

---
```

---

## 步骤 3C：清理

删除两个测试文件。

---

# 测试 4：Restore Chat & Files + 编辑文本（taskAndWorkspace+edited）

## 步骤 4A：创建 V1 → checkpoint + 修改 V2

同上：创建两个文件 V1 → 修改为 V2 → 确认 V2。

完成后告知用户：
**「请点击 **第一个 checkpoint 消息**（V1 版本）旁的 restore 按钮，选择 **Restore Chat & Files**。**在弹出的编辑框中，在原有文本末尾追加 `[EDITED] Checkpoint restore test — verify edited input.`**，确认。完成后回复我。」**

---

## 步骤 4B：验证 Restore Chat & Files + 编辑文本

1. 检查对话中是否有编辑后的输入文本（含 `[EDITED]`）
2. 检查 AI 是否基于编辑文本生成了新响应
3. 用 read_file 读取两个文件，记录版本号

**立即追加写入 `test-restore/report.md`：**

```
### 测试 4: Restore Chat & Files + 编辑文本

**系统提示出现：** (是/否)
**预期：** 对话含编辑输入 + AI 基于编辑响应 + 文件恢复为 V1

| 维度 | 预期 | 实际 | 匹配 |
|---|---|---|---|
| 编辑输入可见 | 含 [EDITED] | (是/否) | ✅/❌ |
| AI 基于编辑响应 | 是 | (是/否) | ✅/❌ |
| ignore-file.md (exclude) | V1 | (V1/V2) | ✅/❌ |
| normal-file.md | V1 | (V1/V2) | ✅/❌ |

---
```

---

# 最终汇总

追加写入 `test-restore/report.md`：

```
### 汇总表

| # | Restore 类型 | ignore-file.md (exclude) | normal-file.md | 符合预期 |
|---|-------------|--------------------------|----------------|----------|
| 1 | Chat Only | (复制) | (复制) | ✅/❌ |
| 2 | Files Only | (复制) | (复制) | ✅/❌ |
| 3 | Chat & Files | (复制) | (复制) | ✅/❌ |
| 4 | Chat & Files + Edit | (复制) | (复制) | ✅/❌ |

### 最终结论

1. **增量 git add -f 对 exclude 文件的影响**：
   - Files Only 和 Chat & Files 中 ignore-file.md 恢复为 V1 → ✅ -f 生效，exclude 文件被正确 checkpoint
   - 如果 ignore-file.md 仍为 V2 → ❌ 需要排查

2. **Chat Only restore**：验证 restore 只影响对话，不影响文件系统

3. **Chat & Files + Edit**：验证编辑文本功能正常

4. **整体评价**：PASS（全部通过）/ FAIL（存在不通过项）
```
</detailed_sequence_steps>

</task>
