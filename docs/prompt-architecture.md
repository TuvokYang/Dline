# Prompt Architecture

## Terminology

Prompt content and tool transport are independent dimensions.

| Dimension | Current values | Responsibility |
| --- | --- | --- |
| Prompt profile | `standard`, `lite` | Selects system-prompt content, profile tool set, and profile-aware command content. |
| Tool transport | `native`, `xml` | Selects provider function schemas or XML tool documentation. |
| Runtime gates | browser, MCP, skills, subagents, Focus Chain, Web tools, YOLO, CLI, parallel tools | Enables content and tools from runtime capability and settings state. |
| Provider projection | OpenAI-compatible, Anthropic, Gemini, XML | Converts canonical tool descriptors to the request format. |

Snapshot names encode the first two dimensions separately:

- `standard.native.*`: Standard prompt with provider-native tools.
- `standard.xml.*`: Standard prompt with XML tools.
- `lite.native.*`: Lite prompt with provider-native tools.
- `lite.xml.*`: Lite prompt with XML tools.

Names such as `enableNativeToolCalls`, `nativeTools`, `nativeRequestSpec`, and `transport: "native"` refer only to tool transport. They must not be used as prompt-profile names.

## Current Call Paths

### Main task

```text
Task
  -> resolvePromptProfile
  -> SystemPromptContext
  -> SystemPromptCacheService
  -> getSystemPrompt
  -> SystemPromptGenerator
  -> createSystemPromptConfig
  -> Standard or Lite section assembly
  -> ToolPromptGenerator
  -> provider-native or XML projection
```

`resolvePromptProfile` is the profile policy boundary. An explicit profile wins; the o1 family selects Lite; otherwise context windows below 64K select Lite and larger or missing windows select Standard.

`SystemPromptCacheService` freezes the generated prompt and tool projection in task `context.json`. It rebuilds when the prompt contract, provider, model, profile, native transport state, Focus Chain state, or capability hash changes. New caches persist `standard` or `lite`; the storage read boundary maps the legacy persisted value `native` to `standard` before validation.

### Subagent

```text
SubagentRunner
  -> resolvePromptProfile
  -> SystemPromptContext(isSubagentRun = true)
  -> getSystemPrompt
  -> filter generated native tools by the subagent allowlist
```

Subagents generate a request-specific prompt rather than using the parent task's frozen prompt. They share the same profile and transport architecture, while subagent gates prevent recursive subagent exposure.

### Slash commands

`commands.ts` renders explicit command instructions through `CommandPromptGenerator`. Deep planning selects a Standard or Lite command descriptor from the already resolved profile. Slash commands are injected instructions; they are not function-tool registrations. Tool transport is passed only where command formatting requires it and does not select the prompt profile.

## Ownership Boundaries

- `src/shared/resolve-prompt-profile.ts`: profile selection policy.
- `src/core/prompts/profiles/types.ts`: supported profile identity.
- `src/core/prompts/system-prompt/context.ts`: typed runtime input.
- `src/core/prompts/generators/SystemPromptGenerator.ts`: orchestration only.
- `src/core/prompts/system-prompt/variants/`: section assembly and conditional content.
- `src/core/prompts/i18n/en/variants/`: profile-owned prose assets.
- `src/core/prompts/tools/tool-specs.ts`: canonical tool descriptions and parameters.
- `src/core/prompts/tools/tool-profile.ts`: exact profile tool registration.
- `src/core/prompts/tools/provider-projector.ts`: provider-native schema projection.
- `src/core/prompts/tools/xml-tool-projector.ts`: XML documentation projection.
- `src/core/prompts/commands/`: explicit command prompt generation.
- `src/core/prompts/system-prompt-cache/`: task-level frozen prompt lifecycle.

The current tool catalog uses `STANDARD_TOOL_SPECS` as the canonical descriptor source. Standard registers the full set; Lite registers its smaller ID set from the same descriptors. Runtime requirements then remove unavailable tools or parameters before either projection is generated.

## Architecture Characteristics

1. Profile selection is explicit before entering prompt generation. Prompt assets do not inspect provider or model IDs.
2. Native function calling and XML are projections of the same gated tool descriptors, so schemas and XML documentation do not need separate policy implementations.
3. Runtime capabilities are represented in `SystemPromptContext` and collapsed into an immutable `SystemPromptConfig` before assembly.
4. Prompt prose is stored in registered i18n modules and rendered through declared runtime contracts instead of ad hoc string replacement.
5. Main-task prompts are frozen for request consistency; subagents construct an isolated prompt and tool allowlist.
6. Profile and transport are both represented in the snapshot matrix, which prevents either dimension from silently changing the other.

## Adding Another Prompt Profile

Add a profile only when it represents a coherent prompt contract, not a transport or provider label.

1. Add the stable value to `PromptProfile` and define its selection policy in `resolvePromptProfile`.
2. Add one registered i18n variant module and profile section assembler. Reuse shared sections rather than copying complete prompts.
3. Define the profile tool ID set. Reuse canonical tool specs unless wording or parameters are genuinely profile-specific.
4. Add command variants only for commands whose contract differs by profile.
5. Add the profile to behavior and snapshot matrices for both `native` and `xml` transports.
6. Include the profile or specialization identity in frozen prompt metadata. Bump `SYSTEM_PROMPT_CONTRACT_VERSION` when old frozen output must be rebuilt.
7. Add a storage migration only for persisted identifiers that existed in released task caches.

## Model-Specific Specialization

Model specialization should be an overlay selected at one boundary, not a new provider branch inside prompt text.

Recommended future selection result:

```ts
interface PromptSelection {
	profile: PromptProfile
	specialization?: PromptSpecializationId
}
```

The resolver should apply a documented precedence such as explicit selection, model specialization, then the general profile fallback. A specialization descriptor may override selected section/template IDs or tool fragments, but should inherit the base profile, canonical tool gates, transport projection, and runtime environment contracts.

The specialization ID must participate in cache comparison and snapshot names. Provider adapters should continue to consume generated text and tools without knowing which profile or specialization produced them.

## Constraints For Future Changes

- Do not create profiles named after `native`, `xml`, or a provider.
- Do not duplicate tool admission policy in provider adapters.
- Do not place model-ID checks in prose assets, section assemblers, or tool projectors.
- Do not register slash commands as AI-callable tools.
- Do not change a frozen task prompt during an ordinary request; refresh it through the cache contract.
- Keep Lite exclusions explicit, especially Skills, Focus Chain, and `task_progress`.
