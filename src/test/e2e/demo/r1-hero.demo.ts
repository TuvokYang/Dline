import { readFile } from "node:fs/promises"
import path from "node:path"
import { expect } from "@playwright/test"
import { demo } from "./utils/demo-fixture"

const TASK_TEXT = "Create a small greeting module for this workspace."
const RELATIVE_PATH = "src/greeting.ts"
const FILE_CONTENT = 'export const greeting = "Hello from Dline!"\n'
const COMPLETION_TEXT = "Created src/greeting.ts successfully."

demo("R1", async ({ finishRecording, helper, pace, registerRecording, server, sidebar, workspaceDir }) => {
	await helper.signin(sidebar)
	server.resetOpenAiMock()
	server.enqueueOpenAiResponses(
		{
			type: "tool",
			id: "call_demo_write",
			name: "write_to_file",
			arguments: { path: RELATIVE_PATH, content: FILE_CONTENT },
		},
		{
			type: "tool",
			id: "call_demo_complete",
			name: "attempt_completion",
			arguments: { result: COMPLETION_TEXT },
			expectedToolResults: [{ callId: "call_demo_write", contentIncludes: "successfully saved" }],
		},
	)

	const input = sidebar.getByTestId("chat-input")
	await input.fill(TASK_TEXT)
	await pace(500)
	await registerRecording("r1-hero")
	await sidebar.getByTestId("send-button").click()

	const approve = sidebar.getByText("Approve", { exact: true })
	await expect(approve).toBeVisible({ timeout: 60_000 })
	await expect(sidebar.page().getByText("greeting.ts: New File (Editable)", { exact: false })).toBeVisible()
	await pace()
	await approve.click()

	const absolutePath = path.join(workspaceDir, RELATIVE_PATH)
	await expect
		.poll(
			() =>
				readFile(absolutePath, "utf8")
					.then((content) => content.trimEnd())
					.catch(() => ""),
			{
				timeout: 30_000,
			},
		)
		.toBe(FILE_CONTENT.trimEnd())
	await pace()
	await expect(sidebar.getByText(COMPLETION_TEXT, { exact: false }).last()).toBeVisible({ timeout: 60_000 })
	await pace()
	await finishRecording()

	const consumptions = server.getMockConsumptions("openai-compatible-chat")
	expect(consumptions.map((entry) => entry.toolName)).toEqual(["write_to_file", "attempt_completion"])
	expect(consumptions.every((entry) => entry.contractError === undefined)).toBe(true)
})
