---
description: "测试 replace_in_file 工具在 SEARCH/REPLACE 分隔符与文件内容冲突时的解析器边界行为。"
author: "Dline Team"
version: "2.1"
category: "Testing"
tags: ["testing", "replace-in-file", "delimiter-conflict", "separator", "edge-case", "unicode", "incomplete-block", "overlap"]
globs: ["test-replace/**/*.md"]
---

<task name="replace_in_file 分隔符边界测试">

<task_objective>
按给定条件执行 replace_in_file 操作。**每次执行后必须回显工具返回的原始文本**（即 toolResult 字符串，包含在 `[replace_in_file for '...'] Result:\n...` 中）。记录每次操作的返回文本与预期结果对比，最后按报告格式汇总。
不得根据"测试目的"选择行为——严格按照每个条件中的 diff 块和分隔符要求执行。
</task_objective>

<detailed_sequence_steps>
# replace_in_file 分隔符边界测试 - 详细步骤

## 步骤 1：创建测试文件

在 `test-replace/` 目录下用 write_to_file 强制创建 `test-content.md`，内容如下（注意文件中没有尾随空格）：

```
# Separator Edge Case Test File

This is normal text with some words to replace.

Here is a list of separator-like patterns:

--- SEARCH
---- SEARCH
----- SEARCH
------ SEARCH
------- SEARCH
-------- SEARCH
===
====
=====
======
=======
========
+++ REPLACE
++++ REPLACE
+++++ REPLACE
++++++ REPLACE
+++++++ REPLACE
++++++++ REPLACE

Below is a block with separator-like content:

------- SEARCH
old value
=======
new value
+++++++ REPLACE

Here is another block with mismatched-length markers:

------ SEARCH
old2
====
new2
++++ REPLACE

This line contains an em-dash — and curly quotes "hello world".

Some indented text:
    Indented line one
    Indented line two

Some Unicode specials: café, naïve, résumé, 中文测试.
```

创建后用 read_file 确认文件为 48 行，且无尾随空格。

## 步骤 2：逐项执行 replace_in_file 条件

对 `test-content.md` 依次执行以下 15 个条件。每步完成后用 read_file 确认变更。不得跳过任何条件。如遇错误，记录完整错误信息后继续下一个条件。

每个条件下方列出 **预期结果**，执行后将实际结果与预期对比，在报告中标注 PASS（匹配）或 FAIL（不匹配）。

---

### 条件 1
- 分隔符字符数：7
- 目标行：第 3 行
- 目标行当前内容：`This is normal text with some words to replace.`
- diff 块：
```
------- SEARCH
This is normal text with some words to replace.
=======
This is normal text with some terms to replace.
+++++++ REPLACE
```

**预期结果：** ✅ PASS — 返回 `deleted 1, added 1, saved 49`。第 3 行被替换，文件仍为 48 行。

---

### 条件 2
- 分隔符字符数：8
- 目标行：内容为 `------- SEARCH` 的行（7 个 dash）
- diff 块：
```
-------- SEARCH
------- SEARCH
========
------- SEARCH [COND2]
++++++++ REPLACE
```

**预期结果：** ✅ PASS — 返回 `deleted 1, added 1`。7-dash 行被替换。

---

### 条件 3
- 分隔符字符数：8
- 目标行：内容为 `=======` 的行（7 个等号）
- diff 块：
```
-------- SEARCH
=======
========
======= [COND3]
++++++++ REPLACE
```

**预期结果：** ✅ PASS — 返回 `deleted 1, added 1`。7-equals 行被替换。

---

### 条件 4
- 分隔符字符数：8
- 目标行：内容为 `+++++++ REPLACE` 的行（7 个加号）
- diff 块：
```
-------- SEARCH
+++++++ REPLACE
========
+++++++ REPLACE [COND4]
++++++++ REPLACE
```

**预期结果：** ✅ PASS — 返回 `deleted 1, added 1`。7-plus 行被替换。

---

### 条件 5
- 分隔符字符数：7
- 目标行：第 45-46 行（两行缩进文本）
- diff 块（包含两个 SEARCH/REPLACE 块）：
```
------- SEARCH
    Indented line one
=======
    Indented line one [COND5A]
+++++++ REPLACE
------- SEARCH
    Indented line two
=======
    Indented line two [COND5B]
+++++++ REPLACE
```

**预期结果：** ✅ PASS — 返回 `deleted 2, added 2`。两个块按顺序执行。

---

### 条件 6
- 分隔符字符数：7
- 目标行：内容为 `old value` 的行
- diff 块（REPLACE 为空）：
```
------- SEARCH
old value
=======
+++++++ REPLACE
```

**预期结果：** ✅ PASS — 返回 `deleted 1, added 0, saved 48`。`old value` 被删除，文件减 1 行。

---

### 条件 7
- 分隔符字符数：7
- 目标行：文件中不存在的文本
- diff 块：
```
------- SEARCH
This text definitely does not exist anywhere in the file xyz123
=======
This should never be inserted
+++++++ REPLACE
```

**预期结果：** ❌ FAIL — 返回 `error — SEARCH content (1 lines) was not found in the file.`。文件不变。

---

### 条件 8
- 分隔符字符数：7
- 目标行：含 em-dash（—）和弯引号（" "）的行
- diff 块：
```
------- SEARCH
This line contains an em-dash — and curly quotes "hello world".
=======
This line contains an em-dash — and curly quotes "hello world" [COND8].
+++++++ REPLACE
```

**预期结果：** ✅ PASS — 目标行被替换为带 `[COND8]` 后缀的版本。Unicode 字符（em-dash、弯引号）正确处理。

---

### 条件 9
- 分隔符字符数：8
- 目标行：内容为 `========` 的行（8 个等号，无尾随空格）
- diff 块：
```
-------- SEARCH
========
========
======== [COND9]
++++++++ REPLACE
```

**预期结果：** ❌ FAIL — 返回分块错误消息。SEARCH 内容与分隔符同字符数时被误认为分隔符，产生 `Empty SEARCH block` 错误。后续内容触发 `Unexpected close marker` 错误。文件不变。

---

### 条件 10 — REPLACE 正文含 =======（同 N delimiter 冲突）
- 分隔符字符数：7
- diff 块：
```
------- SEARCH
This is normal text with some terms to replace.
=======
This text contains a fake separator:
=======
inside the replace block
+++++++ REPLACE
```

**预期结果：** ❌ FAIL — 返回分块错误消息含 `Delimiter conflict: REPLACE content contains a line with 7 '=' characters matching the delimiter.`。文件不变。

---

### 条件 11 — REPLACE 正文含 ------- SEARCH（同 N marker 冲突）
- 分隔符字符数：7
- diff 块：
```
------- SEARCH
This is normal text with some terms to replace.
=======
Before fake marker
------- SEARCH
After fake marker
+++++++ REPLACE
```

**预期结果：** ❌ FAIL — 返回分块错误消息含 `Found ------- SEARCH marker inside REPLACE content.`。文件不变。

---

### 条件 12 — 缺少 ======= 分隔符（未闭合块）
- 分隔符字符数：7
- diff 块：
```
------- SEARCH
This is normal text with some terms to replace.
+++++++ REPLACE
```

**预期结果：** ❌ FAIL — 返回 `error — Missing ======= separator in SEARCH/REPLACE block.`。文件不变。

---

### 条件 13 — 缺少 +++++++ REPLACE 结束标记（未闭合块）
- 分隔符字符数：7
- diff 块：
```
------- SEARCH
This is normal text with some terms to replace.
=======
replacement content without closing marker
```

**预期结果：** ❌ FAIL — 返回 `error — REPLACE block was not closed — missing +++++++ REPLACE marker.`。文件不变。

---

### 条件 14 — 分隔符 N 不匹配（SEARCH=8 但分隔符只有 7）
- diff 块：
```
-------- SEARCH
This is normal text with some terms to replace.
=======
mismatched delimiter test
++++++++ REPLACE
```

**预期结果：** ❌ FAIL — 返回 `error — Missing ======= separator in SEARCH/REPLACE block.`。SEARCH marker N=8 但分隔符 N=7 不匹配。文件不变。

---

### 条件 15 — 重叠范围校验
- 分隔符字符数：7
- diff 块（第二块的 SEARCH 落在第一块已匹配的范围内）：
```
------- SEARCH
    Indented line one [COND5A]
    Indented line two [COND5B]
=======
    Overlapping block one
+++++++ REPLACE
------- SEARCH
    Indented line two [COND5B]
=======
    Overlapping block two
+++++++ REPLACE
```

**预期结果：** ❌ FAIL — 返回分块结果：
```
Block #1: success — deleted 2 lines, added 1 lines.
Block #2: error — Block #2 overlaps with block #1.
```
第一块正常执行，第二块因重叠被拒绝。文件仅含第一块修改。

---

## 步骤 3：报告

所有 15 个条件执行完毕后，整理报告写入 `test-replace/test-report.md`，格式如下：

```
## test-replace 分隔符边界测试 — 报告

### 条件 1 — 结果（✅ PASS 匹配预期 / ❌ FAIL 不符预期）

**diff 块：**
[复制实际使用的 diff 块]

**预期结果：** [从 workflow 中复制预期结果]

**实际返回文本（toolResult）：** [完整复制工具返回的原始文本，包括 `[replace_in_file for '...'] Result:\n...` 部分]

**观察：** [文件中实际发生的变化]

**对比：** ✅ 匹配 / ❌ 不符（如不符，说明差异）

### 条件 2 — ...

（依此类推至条件 15）

---

### 汇总

| # | 条件摘要 | 预期 | 实际 | 匹配 |
|---|---------|------|------|------|
| 1 | 7-char 替换普通文本行 | PASS | | |
| 2 | 8-char 替换 7-dash SEARCH 行 | PASS | | |
| 3 | 8-char 替换 7-equals 行 | PASS | | |
| 4 | 8-char 替换 7-plus REPLACE 行 | PASS | | |
| 5 | 7-char 双块替换两行缩进 | PASS | | |
| 6 | 7-char 空 REPLACE 删除行 | PASS | | |
| 7 | 匹配不存在文本 | FAIL: "does not match" | | |
| 8 | 匹配 em-dash 和弯引号行 | PASS | | |
| 9 | 8-char 替换 8-equals 行 | PASS | | |
| 10 | REPLACE 正文含 =======（同 N 冲突） | FAIL: "Delimiter conflict: REPLACE" | | |
| 11 | REPLACE 正文含 ------- SEARCH（同 N 冲突） | FAIL: "Delimiter conflict: REPLACE" | | |
| 12 | 缺少 ======= 分隔符 | FAIL: "missing ======= separator" | | |
| 13 | 缺少 +++++++ REPLACE | FAIL: "missing +++++++ REPLACE marker" | | |
| 14 | SEARCH=8 分隔符=7（N 不匹配） | FAIL: "missing separator" | | |
| 15 | 两个块范围重叠 | FAIL: "block #2 does not match" | | |

---

### 观察总结
列举出每一个工具执行时的结果值与实际观察结果。判断replace是否正常工作和拒绝匹配返回错误。
[基于 15 个条件的执行结果与预期对比，列出关键观察发现。特别标注：哪些条件实际行为与预期不符，以及可能的原因。]
```
</detailed_sequence_steps>

</task>
