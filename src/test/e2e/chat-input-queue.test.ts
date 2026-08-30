import { expect } from "@playwright/test"
import { E2ETestHelper, e2e } from "./utils/helpers"

/**
 * The queue only exists while the composer is blocked, so every test here first
 * puts the task into a running state with a slow tool call, then types into the
 * still-editable textarea and presses Enter.
 */
e2e(
	"Chat input queue - a send blocked by a running task is queued instead of dropped",
	async ({ helper, server, sidebar, userDataDir }, testInfo) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)
		server.resetOpenAiMock()
		server.enqueueOpenAiResponses({
			type: "tool",
			name: "attempt_completion",
			arguments: { result: "E2E_QUEUE_BLOCKED_DONE" },
			delayMs: 20_000,
		})

		const input = sidebar.getByTestId("chat-input")
		await input.fill("E2E_QUEUE_BLOCKED_TASK")
		await sidebar.getByTestId("send-button").click()
		await expect.poll(() => server.openAiRequestCount, { timeout: 60_000 }).toBe(1)
		await expect(sidebar.getByRole("button", { name: "Cancel", exact: true }).first()).toBeVisible({ timeout: 30_000 })

		// Enter while the task is running must not reach the model as a new request.
		// The markdown body is filled rather than typed because typing newlines
		// would each be read as a send; only the final Enter is the send here.
		await input.fill("## E2E_QUEUED_ENTRY_ONE\n\n- E2E_PENDING_MARKDOWN_ITEM")
		await input.press("Enter")

		const toggle = sidebar.getByTestId("input-queue-toggle")
		await expect(toggle).toBeVisible({ timeout: 30_000 })
		await expect(toggle).toContainText("Queue 1")
		expect(server.openAiRequestCount).toBe(1)

		// The queue now owns the text. Leaving a copy in the composer shows the
		// same input twice and invites sending it a second time by hand.
		await expect(input).toHaveValue("", { timeout: 30_000 })

		await toggle.click()
		const overlay = sidebar.getByTestId("input-queue-overlay")
		await expect(overlay).toBeVisible()
		await expect(overlay).toContainText("E2E_QUEUED_ENTRY_ONE")
		await expect(overlay.getByRole("heading", { name: "E2E_QUEUED_ENTRY_ONE" })).toBeVisible()
		await expect(overlay.getByRole("listitem")).toContainText("E2E_PENDING_MARKDOWN_ITEM")

		const overlayLayout = await overlay.evaluate((element) => {
			const styles = getComputedStyle(element)
			const root = document.querySelector('[data-testid="input-queue-root"]')
			return {
				isPortalled: root ? !root.contains(element) : false,
				maxHeight: styles.maxHeight,
				overflowY: styles.overflowY,
			}
		})
		expect(overlayLayout.isPortalled).toBe(true)
		expect(overlayLayout.maxHeight).not.toBe("none")
		expect(overlayLayout.overflowY).toBe("auto")

		const overlayPaint = await overlay.evaluate((element) => {
			const styles = getComputedStyle(element)
			return {
				backgroundColor: styles.backgroundColor,
				backgroundImage: styles.backgroundImage,
				sidebarBackgroundToken: styles.getPropertyValue("--vscode-sideBar-background"),
			}
		})
		await testInfo.attach("input-queue-overlay-repro.png", {
			body: await overlay.screenshot(),
			contentType: "image/png",
		})
		await testInfo.attach("input-queue-overlay-computed-style.json", {
			body: Buffer.from(JSON.stringify(overlayPaint, null, 2)),
			contentType: "application/json",
		})
		expect(overlayPaint.backgroundColor, JSON.stringify(overlayPaint)).not.toBe("rgba(0, 0, 0, 0)")
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"Chat input queue - clicking send promotes an entry to steering without delivering it",
	async ({ helper, server, sidebar, userDataDir }) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)
		server.resetOpenAiMock()
		server.enqueueOpenAiResponses({
			type: "tool",
			name: "attempt_completion",
			arguments: { result: "E2E_QUEUE_STEERING_DONE" },
			delayMs: 25_000,
		})

		const input = sidebar.getByTestId("chat-input")
		await input.fill("E2E_QUEUE_STEERING_TASK")
		await sidebar.getByTestId("send-button").click()
		await expect.poll(() => server.openAiRequestCount, { timeout: 60_000 }).toBe(1)
		await expect(sidebar.getByRole("button", { name: "Cancel", exact: true }).first()).toBeVisible({ timeout: 30_000 })

		await input.fill("E2E_STEERING_ENTRY")
		await input.press("Enter")

		const toggle = sidebar.getByTestId("input-queue-toggle")
		await expect(toggle).toBeVisible({ timeout: 30_000 })
		await toggle.click()

		const entry = sidebar.locator('[data-testid^="input-queue-entry-"]').first()
		await expect(entry).toHaveAttribute("data-mode", "queued")

		// Clicking send is a state change, not a delivery: the entry stays in the
		// queue and the request count must not move.
		await sidebar.locator('[data-testid^="input-queue-send-"]').first().click()
		await expect(entry).toHaveAttribute("data-mode", "steering", { timeout: 30_000 })
		await expect(toggle).toContainText("steering")
		expect(server.openAiRequestCount).toBe(1)

		// Clicking again returns it to the queued pool.
		await sidebar.locator('[data-testid^="input-queue-send-"]').first().click()
		await expect(entry).toHaveAttribute("data-mode", "queued", { timeout: 30_000 })
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e("Chat input queue - removing an entry is the only way it leaves unsent", async ({ helper, server, sidebar, userDataDir }) => {
	e2e.setTimeout(180_000)
	await helper.signin(sidebar)
	server.resetOpenAiMock()
	server.enqueueOpenAiResponses({
		type: "tool",
		name: "attempt_completion",
		arguments: { result: "E2E_QUEUE_REMOVE_DONE" },
		delayMs: 25_000,
	})

	const input = sidebar.getByTestId("chat-input")
	await input.fill("E2E_QUEUE_REMOVE_TASK")
	await sidebar.getByTestId("send-button").click()
	await expect.poll(() => server.openAiRequestCount, { timeout: 60_000 }).toBe(1)
	await expect(sidebar.getByRole("button", { name: "Cancel", exact: true }).first()).toBeVisible({ timeout: 30_000 })

	await input.fill("E2E_REMOVE_FIRST")
	await input.press("Enter")
	await input.fill("E2E_REMOVE_SECOND")
	await input.press("Enter")

	const toggle = sidebar.getByTestId("input-queue-toggle")
	await expect(toggle).toContainText("Queue 2", { timeout: 30_000 })
	await toggle.click()

	const overlay = sidebar.getByTestId("input-queue-overlay")
	await expect(overlay).toContainText("E2E_REMOVE_FIRST")
	await sidebar.locator('[data-testid^="input-queue-remove-"]').first().click()

	await expect(toggle).toContainText("Queue 1", { timeout: 30_000 })
	await expect(overlay).not.toContainText("E2E_REMOVE_FIRST")
	await expect(overlay).toContainText("E2E_REMOVE_SECOND")
	await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
})

e2e("Chat input queue - a queued entry is delivered at the next turn end", async ({ helper, server, sidebar, userDataDir }) => {
	e2e.setTimeout(240_000)
	await helper.signin(sidebar)
	server.resetOpenAiMock()
	server.enqueueOpenAiResponses(
		{
			type: "tool",
			name: "attempt_completion",
			arguments: { result: "E2E_QUEUE_TURNEND_FIRST" },
			delayMs: 15_000,
		},
		{
			type: "tool",
			name: "attempt_completion",
			arguments: { result: "E2E_QUEUE_TURNEND_SECOND" },
		},
	)

	const input = sidebar.getByTestId("chat-input")
	await input.fill("E2E_QUEUE_TURNEND_TASK")
	await sidebar.getByTestId("send-button").click()
	await expect.poll(() => server.openAiRequestCount, { timeout: 60_000 }).toBe(1)
	await expect(sidebar.getByRole("button", { name: "Cancel", exact: true }).first()).toBeVisible({ timeout: 30_000 })

	await input.fill("## E2E_TURNEND_QUEUED_TEXT\n\n- E2E_DELIVERED_MARKDOWN_ITEM")
	await input.press("Enter")
	await expect(sidebar.getByTestId("input-queue-toggle")).toContainText("Queue 1", { timeout: 30_000 })

	// The first tool ends the turn, which is the only point a queued entry may
	// be delivered. That delivery must produce exactly one more request.
	await expect.poll(() => server.openAiRequestCount, { timeout: 120_000 }).toBe(2)
	await expect(sidebar.getByTestId("input-queue-toggle")).toHaveCount(0, { timeout: 30_000 })

	const consumptions = server.getMockConsumptions()
	const delivered = consumptions.at(-1)
	expect(JSON.stringify(delivered?.requestToolResults ?? [])).toContain("E2E_TURNEND_QUEUED_TEXT")
	const deliveredRequest = JSON.stringify(delivered?.requestBody)
	expect(deliveredRequest).toContain("auxiliary alignment information")

	const deliveredInput = sidebar.getByTestId("queued-user-input").last()
	await expect(deliveredInput).toBeVisible({ timeout: 30_000 })
	await expect(deliveredInput).toHaveAttribute("data-queue-state", "delivered")
	await expect(deliveredInput).toHaveAttribute("data-queued-input-mode", "queued")
	await expect(deliveredInput.getByRole("heading", { name: "E2E_TURNEND_QUEUED_TEXT" })).toBeVisible()
	await expect(deliveredInput.getByRole("listitem")).toContainText("E2E_DELIVERED_MARKDOWN_ITEM")
	await expect(deliveredInput).not.toContainText("auxiliary alignment information")
	await expect(deliveredInput).not.toContainText("辅助对齐信息")
	await expect(deliveredInput.getByTestId("queued-input-markdown-scroll")).toHaveCSS("overflow-y", "auto")
	await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
})

e2e("Chat input queue - cancel keeps the queue and a reload restores it", async ({ helper, server, sidebar, userDataDir }) => {
	e2e.setTimeout(180_000)
	await helper.signin(sidebar)
	server.resetOpenAiMock()
	server.enqueueOpenAiResponses({
		type: "tool",
		name: "attempt_completion",
		arguments: { result: "E2E_QUEUE_CANCEL_DONE" },
		delayMs: 30_000,
	})

	const input = sidebar.getByTestId("chat-input")
	await input.fill("E2E_QUEUE_CANCEL_TASK")
	await sidebar.getByTestId("send-button").click()
	await expect.poll(() => server.openAiRequestCount, { timeout: 60_000 }).toBe(1)

	const cancel = sidebar.getByRole("button", { name: "Cancel", exact: true }).first()
	await expect(cancel).toBeVisible({ timeout: 30_000 })

	await input.fill("E2E_SURVIVES_CANCEL")
	await input.press("Enter")
	await expect(sidebar.getByTestId("input-queue-toggle")).toContainText("Queue 1", { timeout: 30_000 })

	// Cancelling abandons the in-flight work, but retained input belongs to the
	// user: only an explicit delete may discard it.
	await cancel.click()
	await expect(sidebar.getByTestId("input-queue-toggle")).toContainText("Queue 1", { timeout: 60_000 })

	await sidebar.getByTestId("input-queue-toggle").click()
	await expect(sidebar.getByTestId("input-queue-overlay")).toContainText("E2E_SURVIVES_CANCEL")
	await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
})
