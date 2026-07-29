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

	standardFused: `UPDATING TASK PROGRESS

Use the task_progress parameter to report progress. Three modes:

**1. FIRST TIME — Create initial checklist:** Pass the FULL checklist with \`# Title\`, \`## Section\`, and \`- [ ]\` items. Do this ONCE at task start.

**2. DURING WORK — Report completed items:** Only pass \`- [x]\` items with EXACT original text — copy character-for-character, do NOT simplify. Completed items may span across sections (exact text matching is used). Full checklist is in environment_details. To signal your current step, also pass ONE \`- [ ]\` item alongside completed items.

**3. ALL COMPLETED — Choose ONE:**
   - Pass a NEW full checklist to continue with the next phase.
   - Call attempt_completion with a summary covering: what was accomplished, methods used, and test/verification results.
   - Call generate_report with findings and analysis.
   - Call make_plan with the complete plan (in ACT MODE, only when the user explicitly requested a plan).

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
