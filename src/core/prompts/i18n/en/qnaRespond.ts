// English prompts for qna_respond tool — key-value pairs only, no code logic.
const prompts: Record<string, string> = {
	description: `[TURN-END] Use this tool whenever the user asks a question or requests clarification. This MUST be your first response tool for any user question — do NOT use attempt_completion or any other tool to answer questions. Do NOT use plan_mode_respond for answering questions — plan_mode_respond is ONLY for presenting and discussing implementation plans. Available in both PLAN and ACT modes.`,

	responseInstruction: `The detailed answer to the user's question. Provide a clear, thorough explanation. Use code snippets, examples, and references as needed.`,

	responseUsage: "Your detailed answer here",

	taskProgressInstruction: `Optionally update the task progress checklist after answering.`,

	nativeDescription: `[TURN-END] Use this tool whenever the user asks a question. The primary Q&A tool in both PLAN and ACT modes. Do NOT use plan_mode_respond for questions — that tool is only for presenting implementation plans.`,

	nativeResponseInstruction: `The detailed answer to the user's question. Be thorough and precise.`,
}
export default prompts
