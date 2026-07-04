---
description: "测试 Dline LSP 语义工具（find_references / rename / replace_text）的能力对比和边界行为。"
author: "Dline Team"
version: "1.0"
category: "Testing"
tags: ["testing", "lsp", "find-references", "rename", "replace-text", "semantic", "text-level"]
globs: ["test-lsp-tools/**/*.ts"]
---

<task name="LSP 工具对比测试">

<task_objective>
系统化测试 Dline 的三种代码修改工具：find_references（符号引用查找）、rename（语义级重命名）和 replace_text（文本级批量替换）。通过重建 TypeScript 测试工件，对比三种工具在分析级别（语义 vs 文本）、影响范围（符号引用 vs 子串匹配）和 dry_run 模式上的行为差异。
</task_objective>

<detailed_sequence_steps>
# LSP 工具对比测试 - 详细步骤

## 准备工作：重建测试工件

1. 测试文件统一存放在 `workspace1/test-lsp-tools/` 目录下，结构化组织为 utils/services/tests 三个子包。

2. 在执行测试之前，先删除 `test-lsp-tools/` 下所有现有文件，确保每次测试从干净状态开始：
   - `test-lsp-tools/tsconfig.json`
   - `test-lsp-tools/utils/math.ts`
   - `test-lsp-tools/services/app.ts`
   - `test-lsp-tools/tests/math.test.ts`

3. 重建 4 个文件（每个 ≥30 行），建立跨文件符号引用关系：
   - **`test-lsp-tools/tsconfig.json`**：ES2020 + strict，moduleResolution: bundler，include utils/services/tests。
   - **`test-lsp-tools/utils/math.ts`**（约 100 行）：定义 add/subtract/multiply/divide（四则运算）、greet(name)（返回 "Hello, ${formatName(name)}"，空字符串回退 "World"）、formatName（内部 helper）、factorial（递归）、isPrime（素数判断）。全量 JSDoc 注释。
   - **`test-lsp-tools/services/app.ts`**（约 65 行）：从 utils/math 导入多个函数，定义 Calculator 类封装四则运算，定义 run()（调用 greet + Calculator）、getVersion()、getDescription()。
   - **`test-lsp-tools/tests/math.test.ts`**（约 80 行）：导入 utils/math 的所有导出函数，用 describe/it 覆盖 10+ 测试用例：add、subtract、multiply、divide、greet(正常)、greet(空字符串)、factorial(0)、factorial(5)、isPrime(2)、isPrime(4)。每个测试含 expect 断言。

## Workflow 1: find_references — 符号引用查找

1. 读取 `test-lsp-tools/utils/math.ts`，定位 `greet` 函数定义的精确位置（行号 + 列偏移）。

2. 使用 `find_references` 工具查询 `greet` 的所有引用：
   - 期望结果：6 处引用 —— 1 处定义 + 2 处 import（app.ts、math.test.ts）+ 3 处调用（app.ts L47、math.test.ts L54、L58）。
   - 验证返回列表包含所有引用位置和上下文行。

3. 关键观察：`find_references` 仅返回**符号级引用**，不包含 JSDoc 注释中提到 "greet" 的文字，也不包含 `describe("greet")` 字符串字面量。

## Workflow 2: rename — 语义级重命名

1. **dry_run 预览（greet → sayHello）**：
   - 调用 `rename`，设置 `dry_run=true`。
   - 验证预览显示 3 个文件、6 处变更：math.ts（定义）、app.ts（import + 调用）、math.test.ts（import + 2 调用）。
   - 读取所有 3 个文件，**确认文件内容未实际修改**。

2. **真实执行（greet → sayHello）**：
   - 调用 `rename`，设置 `dry_run=false`。
   - 验证输出：3 个文件、6 处变更已应用。
   - 读取所有 3 个文件，确认 `greet` 全部替换为 `sayHello`。
   - **关键验证**：`describe("greet")` 是字符串字面量，语义重命名**正确地跳过了它**，未被修改。

3. 行为总结：rename 是**语义级别**操作，通过 LSP 区分符号引用、注释和字符串，仅重命名代码中的标识符引用。

## Workflow 3: replace_text — 文本级批量替换

1. **dry_run 预览（"Hello" → "Hi"）**：
   - 调用 `replace_text`，参数 `find="Hello"`, `replace="Hi"`, `file_pattern=test-lsp-tools/**/*.ts`, `dry_run=true`, `literal=true`。
   - 验证预览显示 3 个文件、8 处匹配：包括 `sayHello` 中的子串 `Hello`（→ `sayHi`）、模板字面量 `"Hello, ..."`（→ `"Hi, ..."`）、JSDoc 注释中的 `"Hello, Name"`（→ `"Hi, Name"`）。
   - 读取文件，**确认内容未实际修改**。

2. **真实执行（"Hello" → "Hi"）**：
   - 调用 `replace_text`，设置 `dry_run=false`。
   - 验证输出：3 个文件、8 处替换已应用。
   - 读取所有文件确认：`sayHi`、`"Hi, Dline"`、`"Hi, World"`、JSDoc `"Hi, Name"` 全部生效。

3. 行为总结：replace_text 是**文本级别**操作，全局匹配字符串（包括子串），覆盖代码、注释、字符串字面量、JSDoc 等所有文本内容，影响范围 > 语义 rename。

## Workflow 4: 工具行为对比与汇总

整理三种工具的核心差异

</detailed_sequence_steps>

</task>
