// English task progress prompts — key-value pairs only, no code logic.

const prompts: Record<string, string> = {
	generic: `UPDATING TASK PROGRESS

Use the task_progress parameter to report progress. Three modes:

**1. FIRST TIME — Create initial checklist:** Pass the FULL checklist with \`# Title\`, \`## Section\`, and \`- [ ]\` items. Do this ONCE at the start of a task.

**2. DURING WORK — Report completed items:** Only pass \`- [x]\` items with EXACT original text from the checklist — copy character-for-character, do NOT simplify or rephrase. Completed items may span across sections (exact text matching is used, section structure is irrelevant for progress updates). The full checklist is shown in environment_details — no need to repeat it.

**3. ALL COMPLETED — Choose ONE:**
   - Pass a NEW full checklist to continue with the next phase of work.
   - Call attempt_completion with a summary covering: what was accomplished, methods used, and test/verification results.
   - Call generate_report with findings, analysis, and recommendations.
   - Call make_plan with the complete plan (in ACT MODE, only when the user explicitly requested a plan).

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

--- Mode 2: Report completed items ---
<task_progress>
- [x] Set up project structure
- [x] Install dependencies
</task_progress>

--- Mode 2b: Report completed + signal in-progress ---
<task_progress>
- [x] Set up project structure
- [x] Install dependencies
- [ ] Create components
</task_progress>

--- Mode 3a: All done, start new checklist ---
<task_progress>
# Add Features
## Authentication
- [ ] Add login page
- [ ] Add signup page
</task_progress>`,

	nativeNextGen: `UPDATING TASK PROGRESS

Use the task_progress parameter to report progress. Three modes:

**1. FIRST TIME — Create initial checklist:** Pass the FULL checklist with \`# Title\`, \`## Section\`, and \`- [ ]\` items. Do this ONCE at task start.

**2. DURING WORK — Report completed items:** Only pass \`- [x]\` items with EXACT original text — copy character-for-character, do NOT simplify. Completed items may span across sections (exact text matching is used). Full checklist is in environment_details. To signal your current step, also pass ONE \`- [ ]\` item alongside completed items.

**3. ALL COMPLETED — Choose ONE:**
   - Pass a NEW full checklist to continue with the next phase.
   - Call attempt_completion with a summary.
   - Call generate_report with findings and analysis.
   - Call make_plan with the complete plan (in ACT MODE, only when the user explicitly requested a plan).

Updates should be silent. Keep items focused on milestones. Do not deviate from the plan without user approval.
The task_progress parameter MUST be a separate parameter, not inside other content or argument blocks.

--- Mode 1: Initial creation ---
<task_progress>
# Build React Application
## Set up project
- [ ] Set up project structure
- [ ] Install dependencies
</task_progress>

--- Mode 2: Report completed items ---
<task_progress>
- [x] Set up project structure
- [x] Install dependencies
</task_progress>

--- Mode 2b: Report completed + signal in-progress ---
<task_progress>
- [x] Set up project structure
- [x] Install dependencies
- [ ] Create components
</task_progress>

--- Mode 3a: All done, start new checklist ---
<task_progress>
# Add Features
- [ ] Add login page
- [ ] Add signup page
</task_progress>`,

	standardFused: `# Updating Task Progress

Use the \`task_progress\` parameter to report progress.

## Modes

### 1. Create the initial checklist

Pass the complete checklist with a \`# Title\`, optional \`## Section\` headings, and \`- [ ]\` items. Do this once at task start.

### 2. Report progress during work

Pass only completed \`- [x]\` items, using the exact original checklist text character-for-character. Completed items may come from different sections because progress is matched by item text. The full checklist is available in \`environment_details\` and does not need to be repeated. To identify the current step, include one unchanged \`- [ ]\` item alongside the completed items.

### 3. Continue after all items are complete

Choose one action:

- Pass a new complete checklist for the next phase.
- Call \`attempt_completion\` with a summary of what was accomplished, the methods used, and the test or verification results.
- Call \`generate_report\` with findings and analysis.
- Call \`make_plan\` with the complete plan. In ACT MODE, do this only when the user explicitly requested a plan.

## Parameter Rules

- Send progress updates silently without announcing them.
- Keep checklist items focused on milestones.
- Do not deviate from the plan without user approval.
- Provide \`task_progress\` as its own parameter, not inside another content or argument block.

## Examples

### Initial creation

Set \`task_progress\` to a complete Markdown checklist:

\`\`\`markdown
# Build React Application

## Set up project

- [ ] Set up project structure
- [ ] Install dependencies
\`\`\`

### Report completed items

Set \`task_progress\` to the exact completed items:

\`\`\`markdown
- [x] Set up project structure
- [x] Install dependencies
\`\`\`

### Report completed items and the current item

Set \`task_progress\` to the exact completed items followed by one unchanged current item:

\`\`\`markdown
- [x] Set up project structure
- [x] Install dependencies
- [ ] Create components
\`\`\`

### Start the next checklist

When all current items are complete and work continues, set \`task_progress\` to the next complete Markdown checklist:

\`\`\`markdown
# Add Features

- [ ] Add login page
- [ ] Add signup page
\`\`\``,

	nativeGpt5: `UPDATING TASK PROGRESS

Use the task_progress parameter to report progress. Three modes:

**1. FIRST TIME — Create initial checklist:** Pass the FULL checklist with \`# Title\`, \`## Section\`, and \`- [ ]\` items. Do this ONCE at task start.

**2. DURING WORK — Report completed items:** Only pass \`- [x]\` items with EXACT original text — copy character-for-character, do NOT simplify. Completed items may span across sections (exact text matching is used). Full checklist is in environment_details. To signal your current step, also pass ONE \`- [ ]\` item alongside completed items.

**3. ALL COMPLETED — Choose ONE:**
   - Pass a NEW full checklist to continue with the next phase.
   - Call attempt_completion with a summary covering: what was accomplished, methods used, and test/verification results.

Updates should be silent. Keep items focused on milestones. Do not deviate from the plan without user approval.
The task_progress parameter MUST be a separate parameter, NOT inside other content or argument blocks.

--- Mode 1: Initial creation ---
<task_progress>
# Build React Application
## Set up project
- [ ] Set up project structure
- [ ] Install dependencies
</task_progress>

--- Mode 2: Report completed items ---
<task_progress>
- [x] Set up project structure
- [x] Install dependencies
</task_progress>

--- Mode 2b: Report completed + signal in-progress ---
<task_progress>
- [x] Set up project structure
- [x] Install dependencies
- [ ] Create components
</task_progress>

--- Mode 3a: All done, start new checklist ---
<task_progress>
# Add Features
- [ ] Add login page
- [ ] Add signup page
</task_progress>`,

	paramInstruction: `Report task_progress as a separate parameter. Follow the UPDATING TASK PROGRESS section: use exact checklist text for completed items, and include full checklists only when starting or replacing a plan.`,
}

export default prompts
