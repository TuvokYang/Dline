---
name: add-new-tool
description: Add a new AI-callable tool to the Cline extension. Covers proto/host bridge, tool enum, i18n prompts, tool spec, handler, webview rendering, say vs ask, ToolGroupRenderer, and variant configuration.
---

# Add New Tool

Complete guide for adding a new tool to Cline. Follow ALL steps in order.

---

## Step 0: Determine Tool Category

Tools fall into two categories with different rendering paths.

### Read Tools (low-stakes)
Tools that only READ data without modifying files. Examples: `readFile`, `searchFiles`, `listFiles`, `findReferences`.

**Rendering**: ToolGroupRenderer groups read tools into a single collapsible row:
```
Dline read 1 file, performed 2 searches:
[icon] "greet" in test-tools/ (*.ts)
[icon] test-tools/utils/math.ts · lines 1-3
```
Each item shows icon + formatted text, expandable to show content.

**Registration**:
- Add to `LOW_STAKES_TOOLS` Set in `messageUtils.ts`
- Add to `getToolDisplayInfo()` in `ToolGroupRenderer.tsx`
- Add to `EXPANDABLE_TOOLS` if content is expandable
- Add to `getToolGroupSummaryFromParsedTools()` for summary count
- Add to `getActivityText()` for "in progress" state
- Add to `getIconByToolName()` for icon mapping

### Edit Tools (high-stakes)
Tools that MODIFY files. Examples: `editedExistingFile`, `rename`, `replaceText`.

**Rendering**: Standalone component in ChatRow. For edit results, use `EditResultRow` (collapsible with red/green line diffs).

### Ask Tools (interactive)
Tools that ASK the user a question. Examples: `ask_followup_question`, `plan_mode_respond`, `qna_respond`.

**Rendering**: `message.ask` triggers question UI with option buttons. The handler returns a `ToolResponse` string that the ToolExecutor pushes as a tool_result.

**Key difference**: `say("tool", ...)` creates a tool execution notification in chat. `ask("followup", ...)` shows an interactive question with buttons. Read/edit tools use `say`, Q&A tools use `ask`.

### Decision Tree
```
Will the tool MODIFY files?
├── YES → Edit Tool → ClineSayTool + standalone ChatRow component
└── NO  → Read Tool → LOW_STAKES_TOOLS + ToolGroupRenderer
                └── Will the tool ASK a question?
                    ├── YES → ClineAsk + ask() callback
                    └── NO  → ClineSay tool message
```

---

## Step 1: Proto & Host Bridge (only for LSP/IDE-native tools)

**Skip this step if the tool is pure Node.js (no IDE API calls needed).**

For tools that call VSCode APIs (LSP, diagnostics, etc.), define a gRPC service:

### 1a. Create proto file
```
proto/host/{service}.proto
```

```proto
syntax = "proto3";
package host;
option go_package = "github.com/cline/grpc-go/host";

service XxxService {
  rpc methodName(XxxRequest) returns (XxxResponse);
}

message XxxRequest { ... }
message XxxResponse { ... }
```

### 1b. Run proto generation
```bash
npm run protos
```
Auto-generates: types (`src/shared/proto/host/`), client interfaces (`host-bridge-client-types.ts`), standalone clients, VSCode service config.

### 1c. Create VSCode handler
```
src/hosts/vscode/hostbridge/{service}/methodName.ts
```
```typescript
import * as vscode from "vscode"
import { XxxRequest, XxxResponse } from "@/shared/proto/host/{service}"

export async function methodName(request: XxxRequest): Promise<XxxResponse> {
    // Call vscode.commands.executeCommand(...) or vscode.languages.*
}
```

### 1d. Register in HostProvider
- `src/hosts/host-provider-types.ts`: Add `XxxServiceClientInterface` import and `xxxClient` field to `HostBridgeClientProvider`
- `src/hosts/host-provider.ts`: Add `static get xxx()` accessor
- `src/hosts/vscode/hostbridge/client/host-grpc-client.ts`: Add `xxxClient: createGrpcClient(host.XxxServiceDefinition)`
- `src/hosts/external/host-bridge-client-manager.ts`: Add import + property + initialization for `XxxServiceClientImpl`

### Important: Save after applyEdit
For VSCode handlers that use `vscode.workspace.applyEdit()`, the edit only changes the text buffer — NOT the disk. Always save modified documents:
```typescript
const applied = await vscode.workspace.applyEdit(edit)
if (applied) {
    for (const [uri] of edit.entries()) {
        const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString())
        if (doc) await doc.save()
    }
}
```

---

## Step 2: Tool ID Registration

### 2a. Add enum value
File: `src/shared/tools.ts`
```typescript
export enum ClineDefaultTool {
    // ... existing
    MY_NEW_TOOL = "my_new_tool",
}
```

### 2b. Add to READ_ONLY_TOOLS (if read-only)
```typescript
export const READ_ONLY_TOOLS = [
    ClineDefaultTool.MY_NEW_TOOL,  // only if tool does NOT modify files
] as const
```

---

## Step 3: I18n Prompt File (MANDATORY)

**ALL English text visible to the AI MUST be in i18n files.** No hardcoded strings in tool specs or handlers. This includes: tool descriptions, parameter instructions, AND handler result/error messages returned to the AI via `toolError()` or similar. Use `getPrompt("toolName", "key")` in handlers just like in specs.

### 3a. Create i18n file
```
src/core/prompts/i18n/en/{toolNameCamelCase}.ts
```

```typescript
const prompts: Record<string, string> = {
    description: "What the tool does and when to use it. Rendered as XML text in system prompt (GENERIC variant).",
    nativeDescription: "Shorter variant for native function calling (NATIVE_NEXT_GEN variant). MUST be complete -- the AI reads this as the tool's function description.",
    paramNameInstruction: "Clear instruction on what this parameter expects.",
    paramNameUsage: "Example value (just the example, not instruction text).",
}
export default prompts
```

File name must be camelCase (e.g., `findReferences.ts` for `find_references` tool).

### 3b. `description` vs `nativeDescription`

| | `description` | `nativeDescription` |
|---|---|---|
| **Used by** | GENERIC variant (XML tool calling) | NATIVE_NEXT_GEN / NATIVE_GPT_5 variants (native function calling) |
| **Rendered as** | Text in system prompt | API function definition `description` field |
| **Token source** | System prompt tokens | Tools array tokens |
| **Style** | Can be longer, may include usage tips | Concise but complete -- must cover ALL constraints |

**Rule**: Write `nativeDescription` first (it is the primary one for modern models), then derive `description` from it. Both must cover the same constraints: what the tool does, what it does NOT do, sub-behavior warnings, and fallback guidance.

---

## Step 4: Tool Spec Definition

File: `src/core/prompts/system-prompt/tools/{tool_name}.ts`

**MUST define TWO variants**: GENERIC (XML text) and NATIVE_NEXT_GEN (native function calling).

```typescript
import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getPrompt } from "../../i18n"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ClineDefaultTool.MY_NEW_TOOL

const generic: ClineToolSpec = {
    variant: ModelFamily.GENERIC,
    id,
    name: "my_new_tool",
    description: getPrompt("myNewTool", "description"),     // ← XML text
    parameters: [
        { name: "required_param", required: true, instruction: getPrompt(...), usage: getPrompt(...) },
        { name: "optional_param", required: false, type: "boolean", instruction: getPrompt(...) },
        TASK_PROGRESS_PARAMETER,  // always include
    ],
}

const nativeNextGen: ClineToolSpec = {
    ...generic,                                             // reuse parameters
    variant: ModelFamily.NATIVE_NEXT_GEN,
    description: getPrompt("myNewTool", "nativeDescription"), // ← native function desc
}

export const my_new_tool_variants = [generic, nativeNextGen]
```

If the tool also supports NATIVE_GPT_5 or GEMINI_3 variants, add them the same way (spread from nativeNextGen, override variant and description).

---

## Step 5: Tool Spec Registration

### 5a. Export from index
File: `src/core/prompts/system-prompt/tools/index.ts`
```typescript
export * from "./my_new_tool"
```

### 5b. Register in init
File: `src/core/prompts/system-prompt/tools/init.ts`
```typescript
import { my_new_tool_variants } from "./my_new_tool"
// In registerClineToolSets():
const allToolVariants = [ ...my_new_tool_variants, ...]
```

---

## Step 6: Handler Implementation

File: `src/core/task/tools/handlers/{ToolName}Handler.ts`

**Always implement `IFullyManagedTool`.**

### Two-phase rendering pattern:
```typescript
export class MyNewToolHandler implements IFullyManagedTool {
    readonly name = ClineDefaultTool.MY_NEW_TOOL

    async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
        // Phase 1: Create tool message for UI while streaming
        const config = uiHelpers.getConfig()
        if (config.isSubagentExecution) return
        const msg = JSON.stringify({
            tool: "myNewTool",           // ← must match ClineSayTool type
            path: getReadablePath(config.cwd, rawPath),
            operationIsLocatedInWorkspace: true,
        })
        await uiHelpers.say("tool", msg, undefined, undefined, true, block.ts)
    }

    async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
        // Phase 2: Run the tool, then update the message with results
        const result = await doWork(...)
        const content = formatResult(result)
        // Update the tool message with content (partial: false = complete)
        await config.callbacks.say("tool", JSON.stringify({
            tool: "myNewTool",
            path: relPath,
            content,                     // ← content shown in expanded view
            operationIsLocatedInWorkspace: true,
        }), undefined, undefined, false, block.ts)
        return content
    }
}
```

### Path rules:
- **Always use workspace-relative paths** via `getReadablePath(config.cwd, absPath)`
- For display, set `operationIsLocatedInWorkspace: true`
- Paths outside the workspace use absolute paths

### Content format for EditResultRow (edit tools):
```
Rename: oldName -> newName (3 files, 5 changes) (preview)

test-tools/utils/math.ts L3:17
  old line content
  new line content
```
- Line 1: `Prefix: old -> new (stats) (preview)?` — parsed by EditResultRow for header
- Path lines: `relative/path L:col` — clickable to jump to file:line
- Old/new lines: indented, formatted by EditResultRow with red/green backgrounds

---

## Step 7: Handler Registration

File: `src/core/task/tools/ToolExecutorCoordinator.ts`

### 7a. Import
```typescript
import { MyNewToolHandler } from "./handlers/MyNewToolHandler"
```

### 7b. Add to toolHandlersMap
```typescript
[ClineDefaultTool.MY_NEW_TOOL]: (_v: ToolValidator) => new MyNewToolHandler(),
```

---

## Step 8: Webview Rendering (CRITICAL)

---

### 8A. Read Tools — ToolGroupRenderer Path

#### 8A-1. Add to LOW_STAKES_TOOLS
File: `webview-ui/src/components/chat/chat-view/utils/messageUtils.ts`
```typescript
const LOW_STAKES_TOOLS = new Set([
    "readFile", "searchFiles", // ... existing
    "myNewTool",               // ← ADD
])
```

#### 8A-2. Add icon
File: `webview-ui/src/components/chat/chat-view/utils/messageUtils.ts`
```typescript
export function getIconByToolName(toolName: string) {
    switch (toolName) {
        case "myNewTool": return SearchIcon  // ← ADD
    }
}
```

#### 8A-3. Add display info
File: `webview-ui/src/components/chat/chat-view/components/messages/ToolGroupRenderer.tsx`

**getToolDisplayInfo** — controls the collapsed tool group line:
```typescript
case "myNewTool":
    return { icon, path: filePath, label: "my action" }
    // Optional: displayText overrides the path display
```

**EXPANDABLE_TOOLS** — if content should show on click:
```typescript
const EXPANDABLE_TOOLS = new Set(["searchFiles", "myNewTool", ...])
```

**getToolGroupSummaryFromParsedTools** — for summary header "Dline read N files":
```typescript
case "myNewTool": counts.myTool++; break
// Then: parts.push(`${counts.myTool} items`)
```

**getActivityText** — "in progress" text while streaming:
```typescript
case "myNewTool": return `Doing something in ${cleanedPath}...`
```

**formatSearchDisplay** — used for search-like tools to show `"pattern" in path/`:
```typescript
return `${termDisplay} in ${cleanPathPrefix(path)}/`
```

---

### 8B. Edit Tools — Standalone Component Path

#### 8B-1. Add ClineSayTool type
File: `src/shared/ExtensionMessage.ts`
```typescript
export interface ClineSayTool {
    tool: "editedExistingFile" | ... | "myNewTool"  // ← ADD
    path?: string
    content?: string  // used by EditResultRow
}
```

#### 8B-2. Add ChatRow case
File: `webview-ui/src/components/chat/ChatRow.tsx`
```typescript
case "myNewTool":
    return <EditResultRow content={tool.content!} isExpanded={isExpanded} onToggleExpand={handleToggle} />
```

Use `EditResultRow` for tools that show old→new transformations. For simpler display, use `CodeAccordian`.

#### 8B-3. EditResultRow component
EditResultRow expects content in this format:
```
Prefix: old -> new (N files, N changes) (preview)

rel/path.ts L:col
  old line content
  new line content
```

**Color constants** (matching DiffEditRow):
```typescript
const OLD_BG = "bg-red-500/20"   // 20% red on VSCode bg-code
const NEW_BG = "bg-green-500/20"  // 20% green on VSCode bg-code
```

**Styles applied by EditResultRow**:
- Header: old name red bg, new name green bg + bold
- Path lines: clickable → `openFileRelativePath("file:line")`, hover: cursor-pointer
- Old content lines: red bg
- New content lines: green bg + bold

---

### 8C. Q&A Tools (Ask-type)

Tools that ask questions use `ClineAsk` and the `ask()` callback:
```typescript
// In handler's execute():
const { response, text } = await config.callbacks.ask("followup", questionText)
```

The webview renders these via ChatRow's `message.ask` branch:
- `"followup"` → OptionsButtons with question text
- `"plan_mode_respond"` → PlanCompletionOutputRow
- `"qna_respond"` → QnaOutputRow

### 8C-1. Proto ClineAsk Enum (for ask tools)
File: `proto/cline/ui.proto`
```proto
enum ClineAsk {
    // ... existing
    MY_NEW_ASK_TYPE = XX;
}
```
Run `npm run protos` after editing.

### 8C-2. ClineAsk Type & Proto Conversions (for ask tools)
File: `src/shared/ExtensionMessage.ts`
```typescript
export type ClineAsk = "followup" | ... | "my_new_ask_type"
```
File: `src/shared/proto-conversions/cline-message.ts` — add bidirectional mapping in both `convertClineAskToProtoEnum` and `convertProtoEnumToClineAsk`.

### 8C-3. ButtonConfig (for ask tools with approve/acknowledge buttons)
File: `webview-ui/src/components/chat/chat-view/shared/buttonConfig.ts`
- Add entry in `BUTTON_CONFIGS` with `primaryText`, `secondaryText`, `primaryAction`, `secondaryAction`
- Add case in `getButtonConfig` switch
- Set `enableButtons: false` for turn-end tools without user interaction (like Q&A, plan, report)

### 8C-4. Standalone TSX Component (MANDATORY for ask/say tools)
**Every tool with custom rendering needs its own TSX component.** Do NOT reuse inline JSX in ChatRow — create a separate file:
```
webview-ui/src/components/chat/MyNewToolRow.tsx
```
Reference patterns: `QnaOutputRow.tsx`, `PlanCompletionOutputRow.tsx`, `StatusUpdateRow.tsx`.
Use border + background color themes matching the tool's semantic category.

### 8C-5. TURN_ENDING_TOOL_NAMES (for turn-end ask tools)
File: `src/core/task/assistant-message-order.ts`
```typescript
const TURN_ENDING_TOOL_NAMES = new Set<string>([
    ClineDefaultTool.ATTEMPT,
    ClineDefaultTool.ASK,
    ClineDefaultTool.PLAN_MODE,
    ClineDefaultTool.QNA_RESPOND,
    ClineDefaultTool.MY_NEW_TOOL,  // ← ADD if turn-end
])
```

---

## Step 9: Variant Configuration

File: `src/core/prompts/system-prompt/variants/*/config.ts`

Add the tool to ALL variant `.tools()` lists:

**Rule**: LSP-dependent tools skip local model variants (hermes, glm, devstral, trinity). Pure Node.js tools always included.

---

## Step 10: Build & Verify

```bash
npm run compile
npm run test:unit -- --update-snapshots
# Verify: 1591+ passing, 0 new failures
```

---

## Complete File Checklist

### Core (always needed)
- [ ] `src/shared/tools.ts` (enum + READ_ONLY_TOOLS)
- [ ] `src/core/prompts/i18n/en/{toolName}.ts` (MANDATORY — description + nativeDescription)
- [ ] `src/core/prompts/system-prompt/tools/{tool_name}.ts` (spec — must define GENERIC + NATIVE_NEXT_GEN variants)
- [ ] `src/core/prompts/system-prompt/tools/index.ts` (export)
- [ ] `src/core/prompts/system-prompt/tools/init.ts` (register)
- [ ] `src/core/task/tools/handlers/{ToolName}Handler.ts` (IFullyManagedTool)
- [ ] `src/core/task/tools/ToolExecutorCoordinator.ts` (import + map entry)
- [ ] `src/core/prompts/system-prompt/variants/*/config.ts` x12

### Host Bridge (LSP/IDE tools only)
- [ ] `proto/host/{service}.proto`
- [ ] `src/hosts/vscode/hostbridge/{service}/*.ts`
- [ ] `src/hosts/host-provider-types.ts` (+ xxxClient)
- [ ] `src/hosts/host-provider.ts` (+ static get xxx)
- [ ] `src/hosts/vscode/hostbridge/client/host-grpc-client.ts`
- [ ] `src/hosts/external/host-bridge-client-manager.ts`

### Webview — Read Tools
- [ ] `messageUtils.ts` — LOW_STAKES_TOOLS + getIconByToolName
- [ ] `ToolGroupRenderer.tsx` — getToolDisplayInfo + EXPANDABLE_TOOLS + getToolGroupSummaryFromParsedTools + getActivityText

### Webview — Ask Tools
- [ ] `proto/cline/ui.proto` — ClineAsk enum (run `npm run protos`)
- [ ] `src/shared/ExtensionMessage.ts` — ClineAsk type
- [ ] `src/shared/proto-conversions/cline-message.ts` — bidirectional mapping
- [ ] `webview-ui/src/components/chat/chat-view/shared/buttonConfig.ts` — BUTTON_CONFIGS + getButtonConfig case
- [ ] `webview-ui/src/components/chat/{ToolName}Row.tsx` — standalone TSX component (MANDATORY)
- [ ] `webview-ui/src/components/chat/ChatRow.tsx` — rendering case in ask switch
- [ ] `src/core/task/assistant-message-order.ts` — TURN_ENDING_TOOL_NAMES (if turn-end)

### Webview — Edit Tools
- [ ] `src/shared/ExtensionMessage.ts` — ClineSayTool type
- [ ] `webview-ui/src/components/chat/ChatRow.tsx` — rendering case

### Native Variant Sync
- [ ] `src/core/prompts/i18n/en/toolUseIndex.ts` — prompt rule updates (if tool changes prompt behavior)
- [ ] `src/core/prompts/i18n/en/rules.ts` — rule updates
- [ ] `src/core/prompts/system-prompt/variants/native-next-gen/template.ts` — TOOL_USE / RULES sync
- [ ] `src/core/prompts/system-prompt/variants/native-gpt-5/template.ts` — TOOL_USE / RULES sync
- [ ] `src/core/prompts/i18n/en/nativeGpt51Overrides.ts` — TOOL_USE / RULES sync
- [ ] `src/core/prompts/i18n/en/gemini3Overrides.ts` — TOOL_USE / RULES sync


### Verify
- [ ] `npm run compile` ✅
- [ ] `npm run test:unit -- --update-snapshots` ✅
