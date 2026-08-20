// English task progress prompts — key-value pairs only, no code logic.

const prompts: Record<string, string> = {
	generic: `UPDATING TASK PROGRESS

Use the task_progress parameter only when creating or updating TODO items. Follow exactly one lifecycle mode below. Omit the parameter when no TODO item is being created or updated; blank, whitespace-only, heading-only, or empty-checkbox values do not update the stored list.

**1. FIRST TIME — Create the initial checklist:** Pass the FULL checklist with \`# Title\`, optional \`## Section\` headings, and at least one non-empty \`- [ ]\` item. Do this ONCE at the start of a task. This is list creation, not a progress update.

**2. DURING WORK — Send an incremental update only:** The current checklist is already stored and is shown in \`environment_details\`. Do NOT repeat the full checklist, even if you copy it without changes. Pass only checklist items that are already present in the stored plan and that were completed in this update, using \`- [x]\` with EXACT original text copied character-for-character. You may also include at most ONE unchanged \`- [ ]\` item to identify the current step; it must be an existing item and must remain the next item in strict order.

An incremental update MUST NOT contain \`# Title\`, \`## Section\`, a new heading, or the complete list. Do not add, remove, reorder, rename, rephrase, or regroup items. Do not include unrelated unchecked items. If the plan structure needs to change, stop and use \`change_todo_list\` for user authorization instead of changing task_progress.

**3. ALL COMPLETED — Choose ONE:** When every item in the stored checklist is \`[x]\`, do not send another progress update merely to repeat completion. Choose one action:
   - Pass a NEW full checklist to continue with the next phase of work.
   - Call attempt_completion with a summary covering: what was accomplished, methods used, and test/verification results.
   - Call generate_report with findings, analysis, and recommendations.
   - Call make_plan with the complete plan (in ACT MODE, only when the user explicitly requested a plan).

A full checklist is allowed only for the first creation or after all items in the current checklist are complete and a new phase is genuinely starting. Submitting a full checklist while any current item remains \`[ ]\` is an unauthorized plan replacement and must be rejected.

Updates should be silent — do not announce them. Keep items focused on meaningful milestones. Do not deviate from the plan without user approval.
The task_progress parameter MUST be a separate parameter, not inside other content or argument blocks.

--- Mode 1: Initial creation ---
<task_progress>
# Build React Application
## Set up project
- [ ] Set up project structure
- [ ] Install dependencies
## Build components
- [ ] Create components
- [ ] Test application
</task_progress>

--- Mode 2: Incremental update with completed items only ---
<task_progress>
- [x] Set up project structure
- [x] Install dependencies
</task_progress>

--- Mode 2b: Incremental update with one current item ---
<task_progress>
- [x] Set up project structure
- [x] Install dependencies
- [ ] Create components
</task_progress>

The following is INVALID while the current checklist still has unchecked items because it repeats the full plan and attempts to replace it:
<task_progress>
# Build React Application
## Set up project
- [x] Set up project structure
- [x] Install dependencies
## Build components
- [ ] Create components
- [ ] Test application
</task_progress>

--- Mode 3a: All done, start new checklist ---
<task_progress>
# Add Features
## Authentication
- [ ] Add login page
- [ ] Add signup page
</task_progress>`,

	standardFused: `# Updating Task Progress

Use the \`task_progress\` parameter only when creating or updating TODO items. The current TODO list is stored by the runtime and shown in \`environment_details\`.

## Modes

### 1. Create the initial checklist

Pass the complete checklist with a \`# Title\`, optional \`## Section\` headings, and at least one non-empty \`- [ ]\` item. Do this once at task start. This creates the TODO list and is not a progress update.

### 2. Report progress during work — incremental update only

The current checklist must already exist. Pass only items that are already in that stored checklist and were completed in this update, using the exact original item text character-for-character with \`- [x]\`. You may include at most one unchanged existing \`- [ ]\` item to identify the current next step, and it must remain in strict order.

Do not repeat the full checklist during an incremental update, even when copying it without changes. An incremental update must not contain \`# Title\`, \`## Section\`, a new heading, or any other unchecked item. Do not add, remove, reorder, rename, rephrase, or regroup checklist items. If the plan structure must change, stop using task_progress and request user authorization with \`change_todo_list\`.

### 3. Continue after all items are complete

When every item in the stored checklist is \`[x]\`, choose one action:

- Pass a new complete checklist for a genuinely new phase.
- Call \`attempt_completion\` with a summary of what was accomplished, the methods used, and the test or verification results.
- Call \`generate_report\` with findings and analysis.
- Call \`make_plan\` with the complete plan. In ACT MODE, do this only when the user explicitly requested a plan.

A full checklist is allowed only for initial creation or after all items in the current checklist are complete. Submitting a full checklist while any current item remains \`[ ]\` is an unauthorized plan replacement and must be rejected.

## Parameter Rules

- Omit \`task_progress\` when no TODO item is being created or updated. Blank, whitespace-only, heading-only, or empty-checkbox values are ignored.
- Send progress updates silently without announcing them.
- Keep checklist items focused on milestones.
- Complete items in strict order; do not skip unchecked items.
- Do not deviate from the plan without user approval.
- Provide \`task_progress\` as its own parameter, not inside another content or argument block.

## Examples

### Initial creation

Use this XML parameter form, with the complete Markdown checklist as its value:

\`\`\`xml
<task_progress>
# Build React Application

## Set up project

- [ ] Set up project structure
- [ ] Install dependencies
</task_progress>
\`\`\`

### Report completed items

Use this XML parameter form with the exact completed items:

\`\`\`xml
<task_progress>
- [x] Set up project structure
- [x] Install dependencies
</task_progress>
\`\`\`

### Report completed items and the current item

Use this XML parameter form with the exact completed items followed by one unchanged current item:

\`\`\`xml
<task_progress>
- [x] Set up project structure
- [x] Install dependencies
- [ ] Create components
</task_progress>
\`\`\`

### Start the next checklist

When all current items are complete and work continues, use this XML parameter form for the next complete Markdown checklist:

\`\`\`xml
<task_progress>
# Add Features

- [ ] Add login page
- [ ] Add signup page
</task_progress>
\`\`\``,

	paramInstruction: `Omit task_progress when no TODO item is being created or updated. When provided, it must contain at least one non-empty checklist item. During an existing checklist, send only exact completed item text and at most one exact current item. Do not repeat the full checklist or change its structure. Use a full checklist only for initial creation or after all current items are complete and a new phase begins.`,
}

export default prompts
