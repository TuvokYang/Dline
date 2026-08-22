const prompts: Record<string, string> = {
	initial: `# TODO LIST CREATION REQUIRED

ACT MODE is active. In the next tool call that supports \`task_progress\`, create the initial TODO list with a \`# Title\`, optional \`## Section\` headings, and at least one non-empty \`- [ ]\` item.

After creation:
- Follow the stored item text and order exactly.
- Report only newly completed exact \`- [x]\` items. You may also report one exact \`- [ ]\` item, either by itself to identify the current work or after completed items to identify the next work.
- Use \`change_todo_list\` with user approval to change the list structure.
- The full TODO list is shown in \`environment_details\`.`,

	listInstructionsRecommended: `
Create the initial TODO list through \`task_progress\`. Pass the complete list once, with a \`# Title\`, optional \`## Section\` headings, and at least one non-empty \`- [ ]\` item. Afterward, report only exact existing items whose completion state or current-work selection changed.

**Example initial creation:**
\`\`\`
# Implement feature X
## Analyze
- [ ] Review existing code
- [ ] Identify affected modules
## Implement
- [ ] Write core logic
- [ ] Add error handling
## Verify
- [ ] Run tests
- [ ] Check edge cases
\`\`\`

**After initial creation, report only exact existing items whose completion or current-work state changed:**
\`\`\`
- [x] Review existing code
- [x] Identify affected modules
- [ ] Write core logic
\`\`\`

A single exact unchecked item may be sent by itself to identify the current work:
\`\`\`
- [ ] Add error handling
\`\`\``,

	progressUpdateWhenSupported:
		"# TODO LIST UPDATE: If your next tool supports task_progress and either completion state or the current work changed, include the exact update. Otherwise omit task_progress. Tools without task_progress remain valid and must not be blocked.",

	reminder: `
Use \`task_progress\` only when completion state or the current work changes:
- Report newly completed items as exact \`- [x]\` lines from the stored list.
- You may report exactly one existing \`- [ ]\` item by itself to identify the current work.
- When reporting completed items, you may append exactly one existing \`- [ ]\` item to identify the next current work.
- Omit \`task_progress\` when neither completion state nor current work changed.
- Complete items in strict order. Use \`change_todo_list\` with user approval to change list structure.`,

	planModeReminder: `# TODO LIST (RECOMMENDED IN PLAN MODE)

When presenting a finalized plan through \`make_plan\`, include a TODO list with a \`# Title\`, optional \`## Section\` headings, and at least one non-empty item.
After the list is active, changing its structure requires \`change_todo_list\` and user approval.

@REMINDER@`,

	recommended: `# TODO LIST RECOMMENDED

When starting a multi-step task, create a TODO list through \`task_progress\` with a \`# Title\`, optional \`## Section\` headings, and at least one non-empty \`- [ ]\` item.

@LIST_INSTRUCTIONS_RECOMMENDED@`,

	apiRequestCount: `# TODO LIST NEEDED

@API_REQUEST_COUNT@ API requests have been made without a TODO list. Create one in the next tool call that supports \`task_progress\`.

@REMINDER@`,

	completed: `
All {{totalItems}} items completed.

**Next — choose ONE:**
- **Continue work:** Pass a NEW full checklist via task_progress with a required \`# Title\`, optional \`## Section\` headings, and at least one non-empty \`- [ ]\` item to start the next phase.
- **Finish task:** Call attempt_completion. Summarize what was accomplished, methods used, and test/verification results.
- **Deliver report:** Call generate_report with findings, analysis, and recommendations.
- **Present plan:** Call make_plan with the complete plan (in ACT MODE, only when the user explicitly requested a plan).`,

	tamperingRejected: `TODO list update rejected. The submitted \`task_progress\` changes the stored list structure while unchecked items remain. Continue from the stored TODO list and report only exact existing items whose completion state or current-work selection changed. Use \`change_todo_list\` with user approval to change the structure.`,
	titleRequired: `TODO list update rejected. A complete checklist requires a top-level \`# Title\`. \`## Section\` headings are optional and cannot replace the title.`,
	uncheckedItemRequired: `TODO list update rejected. A new complete checklist requires at least one non-empty \`- [ ]\` item. A checklist containing only completed items does not start a new work phase.`,
	skipOrderRejected: `TODO list update rejected. Items must be completed in order. You marked a later item complete while an earlier item remains unchecked. This is the second order violation, so the update was not applied.

Complete these items FIRST (in order):
{{examples}}

To change the order, use change_todo_list to get user authorization. Continue reporting progress via task_progress parameter.`,
	skipOrderWarning: `TODO list warning. You marked a later item complete while an earlier item remains unchecked. The update was accepted once; the next order violation will be rejected. Use \`change_todo_list\` with user approval if the order must change.`,
	itemMismatchRejected: `TODO list update rejected — NEXT TOOL CALLS BLOCKED. The submitted completed items do not match the stored TODO list.

Unmatched items:
{{unmatchedItems}}

Expected format (use EXACT text from the checklist):
{{examples}}

Complete items in strict order FIRST. If plan must change, use change_todo_list to get user authorization.`,
	inProgressMismatchRejected: `TODO list update rejected. The submitted current item (\`- [ ]\`) does not match the stored TODO list. Use exact item text.

Expected items (copy ONE exactly):
{{examples}}

Complete items in strict order FIRST. If plan must change, use change_todo_list.`,
	allCompletedAlready: `TODO list update rejected. All stored items are already complete. Create a new TODO list for a genuine next phase or call \`attempt_completion\`.`,
	attemptCompletionBlocked: `ATTEMPT_COMPLETION BLOCKED — The TODO list still has unchecked items.

Your current checklist is shown above in environment_details. You MUST:
1. Finish ALL remaining \`- [ ]\` items in strict order
2. Report each completed item via task_progress parameter with EXACT text
3. Only call attempt_completion AFTER every item is \`- [x]\`

For stage-by-stage progress summaries, use status_update (set requires_acknowledgment to false — it does not block for user approval). Do NOT try other tools to bypass this restriction.

If the plan genuinely needs to change, use change_todo_list to request user approval.`,

	focusChainChangeAsk: `Dline wants to replace the current TODO list. Review the proposed items and approve or deny them.`,

	focusChainChangeApproved: `The TODO list has been updated with the approved items.`,

	focusChainChangeDenied: `The TODO list change was denied. Continue with the current TODO list.`,

	focusChainChangeMissing: `The proposed TODO list must contain a required top-level \`# Title\` and at least one non-empty \`- [ ]\` or \`- [x]\` item.`,

	focusChainChangeNoItemsApproved: `No TODO items were approved. The current TODO list remains unchanged.`,

	focusChainChangeToolDescription: `Request user approval to replace the current TODO list. Only approved items are applied.`,

	focusChainChangeNewPlanInstruction: `The complete proposed TODO list, organized with # Title and optional ## Section headings. It must contain at least one non-empty checklist item. Example: "# Build Feature\n## Setup\n- [ ] Create files\n## Implement\n- [ ] Write code"`,

	focusChainChangeNewPlanNativeInstruction: `The complete proposed TODO list with a # Title, optional ## Section headings, and at least one non-empty checklist item.`,

	focusChainChangeReasonInstruction: `The reason for changing the current plan. This helps the user understand why the change is needed.`,

	focusChainChangeReasonNativeInstruction: `The reason for changing the current plan.`,

	main: `TODO LIST MANAGEMENT

Tools that expose \`task_progress\` can create or update the TODO list shown in \`environment_details\`.

- Create the initial list once with a \`# Title\`, optional \`## Section\` headings, and at least one non-empty \`- [ ]\` item.
- During work, report exact newly completed items and at most one exact current \`- [ ]\` item; the current item may be sent by itself.
- Omit \`task_progress\` when neither completion state nor current work changed. Blank or structurally empty values do not update the list.
- Do not add, remove, rename, reorder, regroup, or repeat the full list while unchecked items remain.
- Use \`change_todo_list\` with user approval to change the list structure.
- Complete items in strict order. \`attempt_completion\` remains blocked until every TODO item is \`[x]\`.

See Updating Task Progress for the lifecycle and examples.`,
}

export default prompts
