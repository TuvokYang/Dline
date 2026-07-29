# 提示词架构

## 术语

提示词内容与工具传输是两个相互独立的维度。

| 维度 | 当前取值 | 职责 |
| --- | --- | --- |
| 提示词 Profile | `standard`、`lite` | 选择系统提示词内容、Profile 工具集以及与 Profile 相关的命令内容。 |
| 工具传输 | `native`、`xml` | 选择 Provider 原生函数 Schema 或 XML 工具说明。 |
| 运行时开关 | Browser、MCP、Skills、Subagents、Focus Chain、Web Tools、YOLO、CLI、并行工具 | 根据运行时能力与设置启用对应内容和工具。 |
| Provider 投影 | OpenAI-compatible、Anthropic、Gemini、XML | 将规范化工具描述转换为请求格式。 |

Snapshot 文件名分别编码前两个维度：

- `standard.native.*`：Standard 提示词 + Provider 原生工具调用。
- `standard.xml.*`：Standard 提示词 + XML 工具调用。
- `lite.native.*`：Lite 提示词 + Provider 原生工具调用。
- `lite.xml.*`：Lite 提示词 + XML 工具调用。

`enableNativeToolCalls`、`nativeTools`、`nativeRequestSpec` 和 `transport: "native"` 只表示工具传输，不能再作为提示词 Profile 名称。

## 当前调用链

### 主 Task

```text
Task
  -> resolvePromptProfile
  -> SystemPromptContext
  -> SystemPromptCacheService
  -> getSystemPrompt
  -> SystemPromptGenerator
  -> createSystemPromptConfig
  -> Standard 或 Lite Section 组装
  -> ToolPromptGenerator
  -> Provider-native 或 XML 投影
```

`resolvePromptProfile` 是 Profile 策略边界：显式 Profile 优先；o1 系列选择 Lite；否则小于 64K 的上下文窗口选择 Lite，更大或缺失的上下文窗口选择 Standard。

`SystemPromptCacheService` 将生成的提示词和工具投影冻结到 Task 的 `context.json`。提示词合同、Provider、模型、Profile、native 传输状态、Focus Chain 状态或能力 Hash 变化时会重新生成。新缓存只写入 `standard` 或 `lite`；存储读取边界会先把旧缓存中的 `native` 单向迁移为 `standard`，再进行校验。

### Subagent

```text
SubagentRunner
  -> resolvePromptProfile
  -> SystemPromptContext(isSubagentRun = true)
  -> getSystemPrompt
  -> 按 Subagent allowlist 过滤生成的 native tools
```

Subagent 不复用主 Task 的冻结提示词，而是生成本次运行专用的提示词。它与主 Task 共用 Profile 和传输架构，同时通过 Subagent 运行时开关避免递归暴露 Subagent 工具。

### Slash 命令

`commands.ts` 通过 `CommandPromptGenerator` 渲染显式命令指令。Deep Planning 使用调用方已经解析完成的 Profile 选择 Standard 或 Lite 命令描述。Slash 命令属于即时注入的显式指令，不是 Function Tool 注册项。只有命令格式确实依赖工具传输时才传入传输信息，工具传输不能决定提示词 Profile。

## 模块职责

- `src/shared/resolve-prompt-profile.ts`：Profile 选择策略。
- `src/core/prompts/profiles/types.ts`：Profile 稳定身份。
- `src/core/prompts/system-prompt/context.ts`：类型化运行时输入。
- `src/core/prompts/generators/SystemPromptGenerator.ts`：提示词生成编排。
- `src/core/prompts/system-prompt/variants/`：Section 组装和条件内容。
- `src/core/prompts/i18n/en/variants/`：Profile 自有提示词文本。
- `src/core/prompts/tools/tool-specs.ts`：规范化工具描述和参数。
- `src/core/prompts/tools/tool-profile.ts`：按 Profile 注册精确工具集。
- `src/core/prompts/tools/provider-projector.ts`：Provider 原生 Schema 投影。
- `src/core/prompts/tools/xml-tool-projector.ts`：XML 工具说明投影。
- `src/core/prompts/commands/`：显式命令提示词生成。
- `src/core/prompts/system-prompt-cache/`：Task 级冻结提示词生命周期。

当前工具目录以 `STANDARD_TOOL_SPECS` 作为规范化描述源。Standard 注册完整工具集；Lite 从同一描述源注册更小的 ID 集。之后再根据运行时条件过滤不可用工具或参数，并生成 native 或 XML 投影。

## 当前架构特点

1. Profile 在进入提示词生成前完成显式解析，提示词文本本身不判断 Provider 或模型 ID。
2. Native Function Calling 与 XML 共用同一套经过条件过滤的工具描述，不需要维护两套工具策略。
3. 运行时能力通过 `SystemPromptContext` 输入，并在组装前收敛为不可变的 `SystemPromptConfig`。
4. 提示词正文存放在已注册的 i18n 模块中，通过声明式运行时合同渲染，而不是临时字符串替换。
5. 主 Task 使用冻结提示词保证请求一致性；Subagent 使用隔离提示词和工具 allowlist。
6. Snapshot 矩阵同时覆盖 Profile 和工具传输，防止两个维度互相污染。

## 增加新的提示词 Profile

只有当一组提示词形成完整、一致的合同差异时才应新增 Profile，不能把传输方式或 Provider 名称当成 Profile。

1. 在 `PromptProfile` 中增加稳定值，并在 `resolvePromptProfile` 中定义选择策略。
2. 增加一个已注册的 i18n Variant 模块和对应 Section 组装器；优先复用共享 Section，不复制完整提示词。
3. 定义该 Profile 的工具 ID 集；除非措辞或参数确实不同，否则继续复用规范化工具描述。
4. 只有命令合同确实随 Profile 变化时，才增加命令 Variant。
5. 将新 Profile 加入行为矩阵和 Snapshot 矩阵，并同时覆盖 `native`、`xml` 两种传输。
6. 将 Profile 或特化身份纳入冻结提示词元数据；旧冻结结果必须重建时提升 `SYSTEM_PROMPT_CONTRACT_VERSION`。
7. 只有已经写入发布版 Task 缓存的持久化标识才需要存储迁移。

## 针对特定模型的适配

模型特化应当是在单一策略边界选出的 Overlay，而不是散落在提示词正文中的 Provider 分支。

建议后续把选择结果扩展为：

```ts
interface PromptSelection {
	profile: PromptProfile
	specialization?: PromptSpecializationId
}
```

Resolver 应采用明确优先级，例如：显式选择、模型特化、通用 Profile fallback。特化描述可以覆盖指定 Section、Template ID 或工具文本 Fragment，但必须继承基础 Profile、规范化工具 Gate、传输投影和运行时环境合同。

特化 ID 必须参与缓存比较和 Snapshot 命名。Provider Adapter 仍然只消费最终生成的文本和工具，不应知道由哪个 Profile 或特化生成。

## 后续修改约束

- 不要再创建名为 `native`、`xml` 或 Provider 名称的 Profile。
- 不要在 Provider Adapter 中复制工具准入策略。
- 不要在提示词正文、Section 组装器或工具投影器中加入模型 ID 判断。
- 不要把 Slash 命令注册成 AI 可调用工具。
- 普通请求期间不要修改 Task 的冻结提示词；必须通过缓存刷新合同更新。
- Lite 的排除项必须保持显式，尤其是 Skills、Focus Chain 和 `task_progress`。
