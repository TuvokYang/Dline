import { expect, type Frame } from "@playwright/test"
import { E2ETestHelper, e2e } from "./utils/helpers"

/**
 * Regression coverage for the spawn_task approval interaction.
 *
 * Symptom: after the user approves the spawn_task request, the task footer
 * stays stuck showing only the task-level Cancel action and the conversation
 * can no longer continue (no second interaction, no tool result, no new API
 * request). This file reproduces the full approval chain through a real VS
 * Code window with the mock API:
 *
 *   1. model emits spawn_task tool call
 *   2. outer block approval (tool_approval) appears -> Approve
 *   3. handler opens its own spawn_task_approval interaction -> Approve
 *   4. task must keep running and reach the queued attempt_completion
 */

async function sendTask(sidebar: Frame, text: string): Promise<void> {
	const input = sidebar.getByTestId("chat-input")
	await input.fill(text)
	await sidebar.getByTestId("send-button").click()
	await expect(sidebar.getByText(text, { exact: true }).first()).toBeVisible()
}

/** Click every pending Approve action until none is left or the timeout wins. */
async function approveUntilGone(sidebar: Frame, limit = 3): Promise<void> {
	for (let attempt = 0; attempt < limit; attempt++) {
		const approve = sidebar.getByText("Approve", { exact: true }).first()
		try {
			await approve.waitFor({ state: "visible", timeout: 20_000 })
		} catch {
			// No approval waiting anymore; the chain settled.
			return
		}
		await approve.click()
	}
}

e2e("Spawn task - approval chain closes and the conversation continues", async ({ helper, server, sidebar, userDataDir }) => {
	e2e.setTimeout(240_000)
	await helper.signin(sidebar)
	server.resetOpenAiMock()
	server.enqueueOpenAiResponses(
		{
			type: "tool",
			id: "call_spawn_task",
			name: "spawn_task",
			arguments: { task: "E2E spawned sub-task", mode: "plan", context: "E2E spawn context" },
		},
		{
			type: "tool",
			id: "call_spawn_task_completion",
			name: "attempt_completion",
			arguments: { result: "E2E_SPAWN_TASK_CONTINUED" },
		},
	)

	await sendTask(sidebar, "Spawn a sub-task for the E2E workspace, then finish.")

	// First approval gate must appear (outer block approval for spawn_task).
	await expect(sidebar.getByText("Approve", { exact: true }).first()).toBeVisible({ timeout: 60_000 })

	// Approve every gate in the chain (outer tool gate, then the handler's
	// spawn_task_approval). The footer must never remain stuck on Cancel.
	await approveUntilGone(sidebar)

	// The conversation must continue: the queued completion is reached.
	await expect(sidebar.getByText("E2E_SPAWN_TASK_CONTINUED", { exact: false }).last()).toBeVisible({
		timeout: 60_000,
	})
	// No approval or task-level cancel-only footer may remain.
	await expect(sidebar.getByText("Approve", { exact: true })).toHaveCount(0)
	const input = sidebar.getByTestId("chat-input")
	await expect(input).toBeEnabled()
	await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
})
