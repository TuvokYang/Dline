import { expect } from "@playwright/test"
import { E2ETestHelper } from "../utils/helpers"
import { demo } from "./utils/demo-fixture"
import { dismissDemoNotifications } from "./utils/png-asset"

const PARENT_TASK = "Review three release tracks in parallel and summarize the findings."
const PARENT_RESULT = "Parallel review complete: interface, mock coverage, and release timing are ready."
const ITEMS = [
	{
		task: "Check interface readiness.",
		context: "Read the safe workspace overview.",
		tool: "read_file",
		arguments: { path: "README.md" },
		resultMarker: "# Test Workspace",
		result: "Interface review complete.",
		delayMs: 13_000,
	},
	{
		task: "Check mock coverage.",
		context: "Read the safe workspace page.",
		tool: "read_file",
		arguments: { path: "index.html" },
		resultMarker: "<title>Test Workspace</title>",
		result: "Mock coverage review complete.",
		delayMs: 14_500,
	},
	{
		task: "Check release timing.",
		context: "List the safe workspace root.",
		tool: "list_files",
		arguments: { path: ".", recursive: false },
		resultMarker: "README.md",
		result: "Release timing review complete.",
		delayMs: 16_000,
	},
] as const

demo("R5", async ({ finishRecording, helper, pace, page, registerRecording, server, sidebar, userDataDir }) => {
	demo.setTimeout(180_000)
	await helper.signin(sidebar)
	server.resetOpenAiMock()
	server.enqueueOpenAiResponses(
		{
			type: "tool",
			id: "call_r5_use_subagents",
			name: "use_subagents",
			arguments: {
				prompt_1: `<task>${ITEMS[0].task}</task><context>${ITEMS[0].context}</context>`,
				prompt_2: `<task>${ITEMS[1].task}</task><context>${ITEMS[1].context}</context>`,
				prompt_3: `<task>${ITEMS[2].task}</task><context>${ITEMS[2].context}</context>`,
				timeout: 120,
			},
			expectedRequestIncludes: [PARENT_TASK],
		},
		...ITEMS.map((item, index) => ({
			type: "tool" as const,
			id: `call_r5_child_read_${index + 1}`,
			name: item.tool,
			arguments: item.arguments,
			reasoning: `Reviewing release track ${index + 1}.`,
			usage: { inputTokens: 700 + index * 100, outputTokens: 70 + index * 10 },
			matchRequestContract: true,
			expectedRequestIncludes: [item.task, item.context],
			expectedToolResultCount: 0,
			requireCompleteToolPairing: true,
		})),
		...ITEMS.map((item, index) => ({
			type: "tool" as const,
			id: `call_r5_child_complete_${index + 1}`,
			name: "attempt_completion",
			arguments: { result: item.result },
			reasoning: `Release track ${index + 1} is ready.`,
			usage: { inputTokens: 900 + index * 100, outputTokens: 90 + index * 10 },
			delayMs: item.delayMs,
			matchRequestContract: true,
			expectedRequestIncludes: [item.task, item.context],
			expectedToolResultCount: 1,
			expectedToolResults: [
				{
					callId: `call_r5_child_read_${index + 1}`,
					contentIncludes: item.resultMarker,
				},
			],
			requireCompleteToolPairing: true,
		})),
		{
			type: "tool",
			id: "call_r5_parent_complete",
			name: "attempt_completion",
			arguments: { result: PARENT_RESULT },
			matchRequestContract: true,
			expectedToolResultCount: 1,
			expectedToolResults: [
				{
					callId: "call_r5_use_subagents",
					contentIncludes: ["Subagent results:", "Total: 3", "Succeeded: 3", ...ITEMS.map((item) => item.result)],
				},
			],
			requireCompleteToolPairing: true,
		},
	)

	await dismissDemoNotifications(page)
	const input = sidebar.getByTestId("chat-input")
	await input.fill(PARENT_TASK)
	await input.press("Enter")
	await expect(input).toHaveValue("")

	const approveButton = sidebar.getByText("Approve", { exact: true })
	const firstChildTask = sidebar.getByText(ITEMS[0].task, { exact: true }).last()
	await expect(approveButton.or(firstChildTask)).toBeVisible({ timeout: 60_000 })
	if (await approveButton.isVisible()) await approveButton.click()
	await expect.poll(() => server.openAiRequestCount, { timeout: 60_000 }).toBe(7)

	await registerRecording("r5-subagents")
	await sidebar.getByRole("tab", { name: /^Activities(?: \d+)?$/ }).click()
	await sidebar.getByTestId("activity-status-filter-all").click()
	await sidebar.getByTestId("activity-kind-filter-subagent").click()

	const cards = sidebar.getByTestId("activity-item")
	await expect(cards).toHaveCount(3)
	for (let index = 0; index < ITEMS.length; index += 1) {
		await cards.nth(index).getByTestId("activity-toggle").click()
	}

	const activities = ITEMS.map((item) => cards.filter({ hasText: item.task }))
	for (const [index, activity] of activities.entries()) {
		await expect(activity).toHaveCount(1)
		await expect(activity).toHaveAttribute("data-activity-status", "running")
		await expect(activity.getByTestId("subagent-activity-task")).toContainText(ITEMS[index].task)
		await expect(activity.getByTestId("subagent-activity-context")).toContainText(ITEMS[index].context)
		await expect(activity.getByTestId("subagent-tool-step-name")).toHaveText(ITEMS[index].tool)
		await expect(activity.getByTestId("subagent-tool-step-status")).toHaveText(/Done$/)
	}
	await pace()
	await Promise.all(activities.map((activity) => expect(activity).toHaveAttribute("data-activity-status", "running")))

	await expect(activities[0]).toHaveAttribute("data-activity-status", "completed", { timeout: 30_000 })
	await expect(activities[1]).toHaveAttribute("data-activity-status", "running")
	await pace(500)
	await expect(activities[1]).toHaveAttribute("data-activity-status", "completed", { timeout: 30_000 })
	await expect(activities[2]).toHaveAttribute("data-activity-status", "running")
	await pace(500)
	await expect(activities[2]).toHaveAttribute("data-activity-status", "completed", { timeout: 30_000 })

	for (const [index, activity] of activities.entries()) {
		await expect(activity.getByTestId("subagent-tool-step-name")).toHaveText([ITEMS[index].tool, "attempt_completion"])
		await expect(activity.getByTestId("subagent-tool-step-status")).toHaveText([/Done$/, /Done$/])
	}
	await pace()

	await sidebar.getByRole("tab", { name: "Work", exact: true }).click()
	await expect(sidebar.getByText(PARENT_RESULT, { exact: false }).last()).toBeVisible({ timeout: 30_000 })
	await pace(1_000)
	await finishRecording()

	const consumptions = server.getMockConsumptions("openai-compatible-chat")
	expect(consumptions).toHaveLength(8)
	expect(consumptions[0]).toMatchObject({ toolName: "use_subagents", toolCallId: "call_r5_use_subagents" })
	expect(consumptions.at(-1)).toMatchObject({ toolName: "attempt_completion", toolCallId: "call_r5_parent_complete" })
	expect(consumptions.every(({ contractError }) => contractError === undefined)).toBe(true)
	const childFinals = consumptions.filter(({ toolCallId }) => toolCallId?.startsWith("call_r5_child_complete_"))
	expect(childFinals).toHaveLength(3)
	const receivedAtMs = childFinals.map((entry) => entry.receivedAtMs)
	expect(Math.max(...receivedAtMs) - Math.min(...receivedAtMs)).toBeLessThan(2_000)
	await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
})
