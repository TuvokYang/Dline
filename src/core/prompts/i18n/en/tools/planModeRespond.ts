// English prompts — key-value pairs only, no code logic.
const prompts: Record<string, string> = {
	description: `[TURN-END] Present a COMPLETE implementation plan covering ALL user requirements. Use ONLY after thorough exploration and analysis. Your response MUST include the full plan with detailed analysis, architecture decisions, and a complete task_progress checklist organized with # Title and ## Section headings covering every step needed to fulfill ALL requirements. Do not simplify or omit parts of the plan — the user needs to see the entire plan to approve it. Do not call repeatedly — use qna_respond for questions and discussion. This tool is only available in PLAN MODE.
However, if while writing your response you realize you actually need to do more exploration before providing a complete plan, you can add the optional needs_more_exploration parameter to indicate this.`,
	gemini3Description: `[TURN-END] Respond with a COMPLETE implementation plan covering ALL user requirements. This tool should ONLY be used when you have already explored the relevant files and are ready to present a concrete, detailed plan. Your response MUST include the full plan with detailed analysis, architecture decisions, and a complete task_progress checklist organized with # Title and ## Section headings covering every step needed to fulfill ALL requirements. Do not simplify or omit parts of the plan. Only use this tool after you have collected sufficient context. This tool is only available in PLAN MODE, as indicated by the environment_details.
If additional exploration is required while generating the plan, the optional needs_more_exploration parameter can be set to true to enable further research.`,
	responseInstruction: `The response to provide to the user. Do not try to use tools in this parameter, this is simply a chat response. (You MUST use the response parameter, do not simply place the response text directly within <plan_mode_respond> tags.)`,
	responseUsage: "Your response here",
	nativeResponseInstruction: "The response to provide to the user.",
	gemini3ResponseInstruction: "A chat message response to the user.",
	needsMoreExplorationInstruction:
		"Set to true if while formulating your response that you found you need to do more exploration with tools, for example reading files. (Remember, you can explore the project with tools like read_file in PLAN MODE without the user having to toggle to ACT MODE.) Defaults to false if not specified.",
	needsMoreExplorationUsage:
		"true or false (optional, but you MUST set to true if in <response> you need to read files or use other exploration tools)",
	gemini3NeedsMoreExplorationInstruction:
		"needs_more_exploration can be set to true if it is determined that further exploration with read_file/search tools is necessary to formulate a complete plan. This determination can be reached during the response generation process, but should not be acknowledged until this parameter is set to true if required.",
	taskProgressInstruction:
		"A checklist showing task progress after this tool use is completed. (See 'Updating Task Progress' section for more details)",
	taskProgressUsage:
		"Checklist here (If you have presented the user with concrete steps or requirements, you can optionally include a todo list outlining these steps.)",
	nativeTaskProgressInstruction:
		"A checklist showing task progress with the latest status of each subtasks included previously if any.",
	gemini3TaskProgressInstruction:
		"A checklist showing task progress after this tool use is completed. If you are presenting a final implementation plan to the user with needs_more_exploration set to false, you should include a checklist of items to be completed during Act Mode when implementation is underway. (See 'Updating Task Progress' section for more details)",
}
export default prompts
