// English tool use guidelines prompts — key-value pairs only, no code logic.

export const EXPLICIT_INSTRUCTIONS_SECTION = `## Explicit Instructions

Explicit Instructions are one-time runtime invocation contracts injected directly into the current conversation for operations that are not advertised through the regular tool or capability catalogs. Each instruction applies only to the operation and scope defined by its injected block and does not create a persistent tool or capability.

An Explicit Instruction is provided in a block such as \`<explicit_instructions type="operation_name">...</explicit_instructions>\`. The \`type\` identifies the operation, and the block body provides the complete XML invocation template. That template defines the entire allowed XML grammar for the invocation: the root element, nested elements, element order, value placement, and every permitted XML construct. The grammar is opt-in—only syntax explicitly demonstrated by the injected template is available. For example, CDATA sections (\`<![CDATA[...]]>\`), attributes, namespaces, self-closing elements, comments, processing instructions, or XML declarations are valid only when the injected template itself includes and defines their use. Otherwise, values are written as ordinary element text with standard XML escaping.

Invoke the operation by filling that template and emitting exactly one complete, well-formed XML document. The invocation begins with the template's single root opening tag and is complete only when the matching root closing tag has been emitted; every nested element must also be correctly ordered, nested, and closed. The matching root closing tag is the execution boundary: the invocation can be parsed and executed only when the entire response forms that one closed XML document, with no second root, wrapper, or content outside it. Preserve the injected structure exactly, and when a general response-format rule differs from this contract, the Explicit Instruction governs that invocation.`

const prompts: Record<string, string> = {
	main: `# Tool Use Guidelines

1. In <thinking> tags, assess what information you already have and what information you need to proceed with the task.
2. Choose the most appropriate tool based on the task and the tool descriptions provided. Assess if you need additional information to proceed, and which of the available tools would be most effective for gathering this information. For example using the list_files tool is more effective than running a command like \`ls\` in the terminal. It's critical that you think about each available tool and use the one that best fits the current step in the task.
3. If multiple actions are needed, use one tool at a time per message to accomplish the task iteratively, with each tool use being informed by the result of the previous tool use. Do not assume the outcome of any tool use. Each step must be informed by the previous step's result.
4. Formulate your tool use using the XML format specified for each tool.
5. After each tool use, the user will respond with the result of that tool use. This result will provide you with the necessary information to continue your task or make further decisions. This response may include:
  - Information about whether the tool succeeded or failed, along with any reasons for failure.
  - Linter errors that may have arisen due to the changes you made, which you'll need to address.
  - New terminal output in reaction to the changes, which you may need to consider or act upon.
  - Any other relevant feedback or information related to the tool use.
6. ALWAYS wait for user confirmation after each tool use before proceeding. Never assume the success of a tool use without explicit confirmation of the result from the user.

It is crucial to proceed step-by-step, waiting for the user's message after each tool use before moving forward with the task. This approach allows you to:
1. Confirm the success of each step before proceeding.
2. Address any issues or errors that arise immediately.
3. Adapt your approach based on new information or unexpected results.
4. Ensure that each action builds correctly on the previous ones.

By waiting for and carefully considering the user's response after each tool use, you can react accordingly and make informed decisions about how to proceed with the task. This iterative process helps ensure the overall success and accuracy of your work.

## TURN-END Tools

Tools marked [TURN-END] hand control back to the user. Calling one terminates the current execution turn: the runtime stops the automatic API/tool loop and opens the tool's user interaction. Do not emit additional tool calls after a TURN-END call in the same response. Execution resumes from the user's submitted feedback or selected action.

${EXPLICIT_INSTRUCTIONS_SECTION}`,
}

export default prompts
