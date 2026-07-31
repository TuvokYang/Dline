import { readFile } from "node:fs/promises"
import path from "node:path"
import { expect, type Frame, type Locator, type Page } from "@playwright/test"
import type { ElectronApplication } from "playwright"
import { E2ETestHelper, e2e } from "./utils/helpers"

interface StoredSettings {
	chatInputSendShortcut?: string
	defaultTerminalProfile?: string
	terminalCommandTimeoutSeconds?: number
	terminalOutputLineLimit?: number
	vscodeTerminalExecutionMode?: string
}

async function readSettings(dlineDir: string): Promise<StoredSettings> {
	return JSON.parse(await readFile(path.join(dlineDir, "data", "settings", "settings.json"), "utf8"))
}

async function readGlobalState(dlineDir: string): Promise<StoredSettings> {
	return JSON.parse(await readFile(path.join(dlineDir, "data", "globalState.json"), "utf8"))
}

async function openSettings(page: Page, sidebar: Frame): Promise<void> {
	await page.getByRole("button", { name: "Settings", exact: true }).click()
	await expect(sidebar.getByRole("heading", { name: "API Configuration" })).toBeVisible()
}

async function setDropdownValue(sidebar: Frame, dropdown: Locator, value: string, label: string): Promise<void> {
	await dropdown.evaluate((element) => {
		const target = element as HTMLElement & { __e2eChangeValues?: string[] }
		target.__e2eChangeValues = []
		target.addEventListener("change", () => {
			target.__e2eChangeValues?.push((target as unknown as HTMLSelectElement).value)
		})
	})
	await dropdown.click()
	await sidebar.getByRole("option", { name: label, exact: true }).click()
	await expect.poll(() => dropdown.evaluate((element) => (element as HTMLSelectElement).value)).toBe(value)
	await expect
		.poll(() =>
			dropdown.evaluate((element) => (element as HTMLElement & { __e2eChangeValues?: string[] }).__e2eChangeValues ?? []),
		)
		.toContain(value)
}

async function setRangeValue(range: Locator, value: string): Promise<void> {
	const { min, step } = await range.evaluate((element) => {
		const input = element as HTMLInputElement
		return { min: Number(input.min), step: Number(input.step) }
	})
	const steps = (Number(value) - min) / step
	expect(Number.isSafeInteger(steps)).toBe(true)
	await range.focus()
	await range.press("Home")
	for (let index = 0; index < steps; index++) {
		await range.press("ArrowRight")
	}
	await expect(range).toHaveValue(value)
}

async function selectSendShortcut(sidebar: Frame, value: string): Promise<void> {
	await sidebar.getByTestId("tab-general").click()
	const dropdown = sidebar.locator("#chat-input-send-shortcut")
	const labels: Record<string, string> = { enter: "Enter", ctrlEnter: "Ctrl + Enter", shiftEnter: "Shift + Enter" }
	await setDropdownValue(sidebar, dropdown, value, labels[value])
}

async function returnToChat(sidebar: Frame): Promise<void> {
	await sidebar.getByRole("button", { name: "Done", exact: true }).click()
	await expect(sidebar.getByTestId("chat-input")).toBeVisible()
}

async function expectShortcutTurn(
	sidebar: Frame,
	server: { openAiRequestCount: number },
	inputText: string,
	wrongShortcut: string,
	sendShortcut: string,
	completionMarker: string,
): Promise<void> {
	const beforeRequests = server.openAiRequestCount
	const input = sidebar.getByTestId("chat-input")
	await input.fill(inputText)
	await input.press(wrongShortcut)
	await expect(input).toHaveValue(`${inputText}\n`)
	expect(server.openAiRequestCount).toBe(beforeRequests)
	await input.fill(inputText)
	await input.press(sendShortcut)
	await expect(sidebar.getByText(inputText, { exact: true }).last()).toBeVisible()
	await expect(sidebar.getByText(completionMarker, { exact: false }).last()).toBeVisible({ timeout: 60_000 })
	await expect.poll(() => server.openAiRequestCount).toBe(beforeRequests + 1)
}

e2e(
	"Settings - persists input shortcuts and terminal limits, then applies all send shortcut modes",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(240_000)
		let firstApp: ElectronApplication | undefined
		let reopenedApp: ElectronApplication | undefined

		try {
			firstApp = await openVSCode(workspaceDir)
			const firstPage = await firstApp.firstWindow()
			await E2ETestHelper.openClineSidebar(firstPage)
			const firstSidebar = await helper.getSidebar(firstPage)
			await helper.signin(firstSidebar)
			await openSettings(firstPage, firstSidebar)

			await selectSendShortcut(firstSidebar, "ctrlEnter")
			await firstSidebar.getByTestId("tab-terminal").click()
			const timeout = firstSidebar.locator("#terminal-command-timeout input")
			await timeout.fill("0.5")
			await expect(firstSidebar.getByText("Enter at least 1 minute", { exact: true })).toBeVisible()
			await timeout.fill("42")
			await timeout.press("Tab")
			await expect(timeout).toHaveValue("42")
			await setDropdownValue(
				firstSidebar,
				firstSidebar.locator("#terminal-execution-mode"),
				"backgroundExec",
				"Background Exec",
			)
			await expect.poll(async () => (await readGlobalState(dlineDir)).vscodeTerminalExecutionMode).toBe("backgroundExec")
			await setRangeValue(firstSidebar.locator("#terminal-output-limit"), "900")
			await expect.poll(async () => (await readSettings(dlineDir)).terminalOutputLineLimit).toBe(900)

			await expect
				.poll(async () => await readSettings(dlineDir))
				.toMatchObject({
					chatInputSendShortcut: "ctrlEnter",
					terminalCommandTimeoutSeconds: 2_520,
					terminalOutputLineLimit: 900,
				})
			await firstApp.close()
			firstApp = undefined

			reopenedApp = await openVSCode(workspaceDir)
			const reopenedPage = await reopenedApp.firstWindow()
			await E2ETestHelper.openClineSidebar(reopenedPage)
			const reopenedSidebar = await helper.getSidebar(reopenedPage)
			await helper.signin(reopenedSidebar)
			await openSettings(reopenedPage, reopenedSidebar)

			await reopenedSidebar.getByTestId("tab-general").click()
			await expect
				.poll(() =>
					reopenedSidebar
						.locator("#chat-input-send-shortcut")
						.evaluate((element) => (element as HTMLSelectElement).value),
				)
				.toBe("ctrlEnter")
			await reopenedSidebar.getByTestId("tab-terminal").click()
			await expect(reopenedSidebar.locator("#terminal-command-timeout input")).toHaveValue("42")
			await expect(reopenedSidebar.locator("#terminal-output-limit")).toHaveValue("900")
			await expect
				.poll(() =>
					reopenedSidebar
						.locator("#terminal-execution-mode")
						.evaluate((element) => (element as HTMLSelectElement).value),
				)
				.toBe("backgroundExec")

			server.resetOpenAiMock()
			server.enqueueOpenAiResponses(
				{ type: "tool", name: "attempt_completion", arguments: { result: "E2E_CTRL_ENTER_COMPLETE" } },
				{ type: "tool", name: "attempt_completion", arguments: { result: "E2E_SHIFT_ENTER_COMPLETE" } },
				{ type: "tool", name: "attempt_completion", arguments: { result: "E2E_ENTER_COMPLETE" } },
			)
			await returnToChat(reopenedSidebar)
			await expectShortcutTurn(
				reopenedSidebar,
				server,
				"E2E_CTRL_ENTER_INPUT",
				"Enter",
				"Control+Enter",
				"E2E_CTRL_ENTER_COMPLETE",
			)

			await openSettings(reopenedPage, reopenedSidebar)
			await selectSendShortcut(reopenedSidebar, "shiftEnter")
			await expect.poll(async () => (await readSettings(dlineDir)).chatInputSendShortcut).toBe("shiftEnter")
			await returnToChat(reopenedSidebar)
			await expectShortcutTurn(
				reopenedSidebar,
				server,
				"E2E_SHIFT_ENTER_INPUT",
				"Enter",
				"Shift+Enter",
				"E2E_SHIFT_ENTER_COMPLETE",
			)

			await openSettings(reopenedPage, reopenedSidebar)
			await selectSendShortcut(reopenedSidebar, "enter")
			await expect.poll(async () => (await readSettings(dlineDir)).chatInputSendShortcut).toBe("enter")
			await returnToChat(reopenedSidebar)
			await expectShortcutTurn(reopenedSidebar, server, "E2E_ENTER_INPUT", "Shift+Enter", "Enter", "E2E_ENTER_COMPLETE")
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await reopenedApp?.close()
			await firstApp?.close()
		}
	},
)

e2e(
	"Terminal - foreground VS Code terminal executes with the configured Windows shell",
	async ({ dlineDir, helper, page, server, sidebar, userDataDir }) => {
		e2e.skip(process.platform !== "win32", "Configured Windows shell execution requires Windows")
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)
		await openSettings(page, sidebar)
		await sidebar.getByTestId("tab-terminal").click()
		await setDropdownValue(sidebar, sidebar.locator("#terminal-execution-mode"), "backgroundExec", "Background Exec")
		await setDropdownValue(sidebar, sidebar.locator("#terminal-execution-mode"), "vscodeTerminal", "VS Code Terminal")
		await setDropdownValue(sidebar, sidebar.locator("#default-terminal-profile"), "powershell-legacy", "Windows PowerShell")
		await expect
			.poll(async () => await readGlobalState(dlineDir))
			.toMatchObject({
				defaultTerminalProfile: "powershell-legacy",
				vscodeTerminalExecutionMode: "vscodeTerminal",
			})

		server.resetOpenAiMock()
		server.enqueueOpenAiResponses(
			{
				type: "tool",
				id: "call_vscode_powershell",
				name: "execute_command",
				arguments: {
					command:
						'Write-Output "E2E_VSCODE_POWERSHELL_OK"; Write-Output "E2E_PS_EDITION=$($PSVersionTable.PSEdition)"',
					workdirectory: ".",
					requires_approval: true,
					synchronous: true,
					timeout: 60,
				},
			},
			{
				type: "tool",
				id: "call_vscode_powershell_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_VSCODE_POWERSHELL_COMPLETE" },
				expectedToolResults: [
					{
						callId: "call_vscode_powershell",
						contentIncludes: [
							"Command executed successfully (exit code 0).",
							"E2E_VSCODE_POWERSHELL_OK",
							"E2E_PS_EDITION=Desktop",
						],
					},
				],
			},
		)

		await returnToChat(sidebar)
		const input = sidebar.getByTestId("chat-input")
		await input.fill("Run the configured foreground PowerShell command.")
		await sidebar.getByTestId("send-button").click()
		const approveButton = sidebar.getByText("Approve", { exact: true })
		await expect(approveButton).toBeVisible({ timeout: 60_000 })
		await approveButton.click()

		await expect(sidebar.getByText("E2E_VSCODE_POWERSHELL_COMPLETE", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await expect.poll(() => server.openAiRequestCount).toBe(2)
		const continuation = server.getMockConsumptions("openai-compatible-chat")[1]
		expect(continuation.requestToolResults).toContainEqual(
			expect.objectContaining({
				callId: "call_vscode_powershell",
				content: expect.stringContaining("E2E_PS_EDITION=Desktop"),
			}),
		)
		const output = await E2ETestHelper.readDlineOutput(userDataDir)
		expect(output).toContain("[TerminalManager] Running command")
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)
