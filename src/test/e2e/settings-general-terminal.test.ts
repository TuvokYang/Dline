import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, type Frame, type Locator, type Page } from "@playwright/test"
import type { ElectronApplication } from "playwright"
import { E2ETestHelper, e2e } from "./utils/helpers"
import { startSettingControlStabilityObserver, stopSettingControlStabilityObserver } from "./utils/ui-stability"

interface StoredSettings {
	chatInputSendShortcut?: string
	defaultTerminalProfile?: string
	shellIntegrationTimeout?: number
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

async function writeShellEnvironmentConfig(workspaceDir: string, scope: string): Promise<void> {
	const agentsDirectory = path.join(workspaceDir, ".agents")
	await mkdir(agentsDirectory, { recursive: true })
	await writeFile(
		path.join(agentsDirectory, "bashrc.yml"),
		`version: 1
environment:
  DLINE_E2E_BASHRC_ENV: ${scope}
platforms:
  win32:
    profiles:
      powershell-legacy:
        commands:
          - $env:DLINE_E2E_BASHRC_INIT = '${scope}-initialized'
`,
		"utf8",
	)
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

async function setAutoApproveAction(sidebar: Frame, label: string, enabled: boolean): Promise<void> {
	await sidebar.getByLabel("Open auto-approve settings").click()
	const checkbox = sidebar.locator("vscode-checkbox").filter({ hasText: label })
	await expect(checkbox).toHaveCount(1)
	const isChecked = () => checkbox.evaluate((element) => Boolean((element as HTMLInputElement).checked))
	if ((await isChecked()) !== enabled) await sidebar.getByText(label, { exact: true }).click()
	await expect.poll(isChecked).toBe(enabled)
	await sidebar.getByLabel("Close auto-approve settings").click()
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
			await expect(
				firstSidebar.getByText("Set how long Dline waits for shell integration to activate before executing commands.", {
					exact: false,
				}),
			).toBeVisible()
			await expect(
				firstSidebar.getByText("When enabled, Dline will reuse existing terminal windows", { exact: false }),
			).toBeVisible()
			await expect(
				firstSidebar.getByText("Choose whether Dline runs commands in the VS Code terminal or a background process.", {
					exact: true,
				}),
			).toBeVisible()
			await expect(firstSidebar.getByText(/Cline/)).toHaveCount(0)
			const timeout = firstSidebar.locator("#terminal-command-timeout input")
			await startSettingControlStabilityObserver(firstSidebar, { selector: "#terminal-command-timeout input" }, "value")
			await timeout.fill("0.5")
			await expect(firstSidebar.getByText("Enter at least 1 minute", { exact: true })).toBeVisible()
			await timeout.fill("42")
			await timeout.press("Tab")
			await expect(timeout).toHaveValue("42")
			await expect.poll(async () => (await readSettings(dlineDir)).terminalCommandTimeoutSeconds).toBe(2_520)
			await firstSidebar.page().waitForTimeout(300)
			const timeoutSamples = await stopSettingControlStabilityObserver(firstSidebar)
			const firstValidTimeoutSample = timeoutSamples.indexOf("42")
			expect(firstValidTimeoutSample).toBeGreaterThanOrEqual(0)
			expect(timeoutSamples.slice(firstValidTimeoutSample)).not.toContain("30")
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
	async ({ dlineDir, helper, page, server, sidebar, userDataDir, workspaceDir }) => {
		e2e.skip(process.platform !== "win32", "Configured Windows shell execution requires Windows")
		e2e.setTimeout(180_000)
		await writeShellEnvironmentConfig(workspaceDir, "foreground")
		await helper.signin(sidebar)
		await openSettings(page, sidebar)
		await sidebar.getByTestId("tab-terminal").click()
		await setDropdownValue(sidebar, sidebar.locator("#terminal-execution-mode"), "backgroundExec", "Background Exec")
		await setDropdownValue(sidebar, sidebar.locator("#terminal-execution-mode"), "vscodeTerminal", "VS Code Terminal")
		await setDropdownValue(sidebar, sidebar.locator("#default-terminal-profile"), "powershell-legacy", "Windows PowerShell")
		const shellIntegrationTimeout = sidebar
			.getByText("Shell integration timeout (seconds)", { exact: true })
			.locator("..")
			.locator("vscode-text-field")
		await shellIntegrationTimeout.evaluate((element) => {
			;(element as HTMLInputElement).value = "15"
			element.dispatchEvent(new Event("change", { bubbles: true }))
		})
		await expect
			.poll(async () => await readGlobalState(dlineDir))
			.toMatchObject({
				defaultTerminalProfile: "powershell-legacy",
				shellIntegrationTimeout: 15_000,
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
						'Write-Output "E2E_VSCODE_POWERSHELL_OK"; Write-Output "E2E_PS_EDITION=$($PSVersionTable.PSEdition)"; Write-Output "E2E_BASHRC_ENV=$env:DLINE_E2E_BASHRC_ENV"; Write-Output "E2E_BASHRC_INIT=$env:DLINE_E2E_BASHRC_INIT"',
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
							"E2E_BASHRC_ENV=foreground",
							"E2E_BASHRC_INIT=foreground-initialized",
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

e2e(
	"Terminal - background Exec applies the configured PowerShell project environment",
	async ({ dlineDir, helper, page, server, sidebar, userDataDir, workspaceDir }) => {
		e2e.skip(process.platform !== "win32", "Configured Windows shell execution requires Windows")
		e2e.setTimeout(180_000)
		await writeShellEnvironmentConfig(workspaceDir, "background")
		await helper.signin(sidebar)
		await openSettings(page, sidebar)
		await sidebar.getByTestId("tab-terminal").click()
		await setDropdownValue(sidebar, sidebar.locator("#terminal-execution-mode"), "backgroundExec", "Background Exec")
		await setDropdownValue(sidebar, sidebar.locator("#default-terminal-profile"), "powershell-legacy", "Windows PowerShell")
		await expect
			.poll(async () => await readGlobalState(dlineDir))
			.toMatchObject({
				defaultTerminalProfile: "powershell-legacy",
				vscodeTerminalExecutionMode: "backgroundExec",
			})

		server.resetOpenAiMock()
		server.enqueueOpenAiResponses(
			{
				type: "tool",
				id: "call_background_shell_environment",
				name: "execute_command",
				arguments: {
					command:
						'Write-Output "E2E_BACKGROUND_BASHRC_ENV=$env:DLINE_E2E_BASHRC_ENV"; Write-Output "E2E_BACKGROUND_BASHRC_INIT=$env:DLINE_E2E_BASHRC_INIT"',
					workdirectory: ".",
					requires_approval: true,
					synchronous: true,
					timeout: 60,
				},
			},
			{
				type: "tool",
				id: "call_background_shell_environment_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_BACKGROUND_BASHRC_COMPLETE" },
				expectedToolResults: [
					{
						callId: "call_background_shell_environment",
						contentIncludes: [
							"Command executed successfully (exit code 0).",
							"E2E_BACKGROUND_BASHRC_ENV=background",
							"E2E_BACKGROUND_BASHRC_INIT=background-initialized",
						],
					},
				],
			},
		)

		await returnToChat(sidebar)
		const input = sidebar.getByTestId("chat-input")
		await input.fill("Run a background terminal command with the project shell environment.")
		await sidebar.getByTestId("send-button").click()
		await expect(sidebar.getByText("Approve", { exact: true })).toBeVisible({ timeout: 60_000 })
		await sidebar.getByText("Approve", { exact: true }).click()
		await expect(sidebar.getByText("E2E_BACKGROUND_BASHRC_COMPLETE", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await expect.poll(() => server.openAiRequestCount).toBe(2)
		const continuation = server.getMockConsumptions("openai-compatible-chat")[1]
		expect(continuation.contractError).toBeUndefined()
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"Terminal - configured output limit bounds the final tool result and preserves the full log",
	async ({ dlineDir, helper, page, server, sidebar, userDataDir }) => {
		e2e.setTimeout(240_000)
		await helper.signin(sidebar)
		await openSettings(page, sidebar)
		await sidebar.getByTestId("tab-terminal").click()
		await setRangeValue(sidebar.locator("#terminal-output-limit"), "100")
		await expect.poll(async () => (await readSettings(dlineDir)).terminalOutputLineLimit).toBe(100)
		await returnToChat(sidebar)
		await setAutoApproveAction(sidebar, "Execute safe commands", false)

		const outputPrefix = "E2E_TERMINAL_LIMIT_LINE_"
		const prefixCodePoints = [...outputPrefix].map((character) => character.codePointAt(0)).join(",")
		const command = `node -e "const p=String.fromCodePoint(${prefixCodePoints}); for(let i=0;i<220;i++) console.log(p+i)"`
		server.resetOpenAiMock()
		server.enqueueOpenAiResponses(
			{
				type: "tool",
				id: "call_terminal_output_limit",
				name: "execute_command",
				arguments: {
					command,
					workdirectory: ".",
					requires_approval: true,
					synchronous: true,
					timeout: 60,
				},
			},
			{
				type: "tool",
				id: "call_terminal_output_limit_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_TERMINAL_OUTPUT_LIMIT_OK" },
				expectedToolResultCount: 1,
				expectedToolResults: [
					{
						callId: "call_terminal_output_limit",
						contentIncludes: [
							"Command executed successfully (exit code 0).",
							`${outputPrefix}0`,
							`${outputPrefix}219`,
							"lines written to",
							"Full output saved to:",
						],
					},
				],
			},
		)

		const input = sidebar.getByTestId("chat-input")
		await input.fill("Run a bounded foreground output command.")
		await sidebar.getByTestId("send-button").click()
		await expect(sidebar.getByText("Approve", { exact: true })).toBeVisible({ timeout: 60_000 })
		await sidebar.getByText("Approve", { exact: true }).click()
		await expect(sidebar.getByText("E2E_TERMINAL_OUTPUT_LIMIT_OK", { exact: false }).last()).toBeVisible({
			timeout: 90_000,
		})

		const continuation = server.getMockConsumptions("openai-compatible-chat")[1]
		expect(continuation.contractError).toBeUndefined()
		const [toolResult] = continuation.requestToolResults.filter((result) => result.callId === "call_terminal_output_limit")
		expect(toolResult).toBeDefined()
		expect(toolResult.content).toContain(`${outputPrefix}0`)
		expect(toolResult.content).toContain(`${outputPrefix}219`)
		expect(toolResult.content).not.toContain(`${outputPrefix}100\n`)
		const visibleMarkers = toolResult.content.match(new RegExp(outputPrefix, "g")) ?? []
		expect(visibleMarkers.length).toBeGreaterThan(0)
		expect(visibleMarkers.length).toBeLessThanOrEqual(100)
		const logPath = toolResult.content.match(/Full output saved to:\s*([^\r\n]+)/)?.[1]?.trim()
		if (!logPath) throw new Error("Bounded command result did not include its full-output log path")
		const log = await readFile(logPath, "utf8")
		expect(log).toContain(`${outputPrefix}0`)
		expect(log).toContain(`${outputPrefix}219`)
		expect(log.match(new RegExp(outputPrefix, "g"))).toHaveLength(220)
		await expect(sidebar.getByRole("button", { name: "Copy command" }).last()).toBeVisible()
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"Terminal - automatic handoff exposes a background Activity and injects only status plus log metadata",
	async ({ helper, server, sidebar, userDataDir }) => {
		e2e.setTimeout(240_000)
		await helper.signin(sidebar)
		await setAutoApproveAction(sidebar, "Execute safe commands", false)
		const startedMarker = "E2E_AUTO_BACKGROUND_OUTPUT_STARTED"
		const finishedMarker = "E2E_AUTO_BACKGROUND_OUTPUT_FINISHED"
		const startedCodePoints = [...startedMarker].map((character) => character.codePointAt(0)).join(",")
		const finishedCodePoints = [...finishedMarker].map((character) => character.codePointAt(0)).join(",")
		const command = `node -e "const s=String.fromCodePoint(${startedCodePoints}); const f=String.fromCodePoint(${finishedCodePoints}); console.log(s); setTimeout(()=>console.log(f),30000)"`
		server.resetOpenAiMock()
		server.enqueueOpenAiResponses(
			{
				type: "tool",
				id: "call_terminal_automatic_background",
				name: "execute_command",
				arguments: {
					command,
					workdirectory: ".",
					requires_approval: true,
					timeout: 60,
				},
			},
			{
				type: "tool",
				id: "call_terminal_automatic_background_qna",
				name: "qna_respond",
				arguments: { response: "E2E_AUTO_BACKGROUND_HANDOFF_READY" },
				expectedToolResults: [
					{
						callId: "call_terminal_automatic_background",
						contentIncludes: [
							"Command is still running after 10 seconds and is now tracked in the background.",
							"Log file:",
						],
					},
				],
				expectedRequestIncludes: ["# Background Commands", "running", "log:"],
				expectedRequestExcludes: [startedMarker, finishedMarker],
			},
			{
				type: "tool",
				id: "call_terminal_automatic_background_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_AUTO_BACKGROUND_RESULT_OK" },
				expectedRequestIncludes: [
					"E2E_AUTO_BACKGROUND_FEEDBACK",
					"# Background Results",
					"## Background Command Results",
					"completed",
					"log:",
				],
				expectedRequestExcludes: [startedMarker, finishedMarker],
			},
		)

		const input = sidebar.getByTestId("chat-input")
		await input.fill("Run a command that should hand off automatically after ten seconds.")
		await sidebar.getByTestId("send-button").click()
		await expect(sidebar.getByText("Approve", { exact: true })).toBeVisible({ timeout: 60_000 })
		await sidebar.getByText("Approve", { exact: true }).click()

		await sidebar.getByRole("tab", { name: /Activity/ }).click()
		await sidebar.getByRole("button", { name: "All", exact: true }).first().click()
		const activity = sidebar.getByTestId("activity-item").filter({ hasText: "Background Command" })
		await expect(activity).toHaveCount(1, { timeout: 30_000 })
		await expect(activity).toContainText("running", { timeout: 30_000 })
		await activity.locator("button").first().click()
		const logLink = activity.getByRole("button", { name: /Open log file/ })
		await expect(logLink).toBeVisible()
		const logPath = (await logLink.getAttribute("title"))?.replace(/^Click to open:\s*/, "")
		if (!logPath) throw new Error("Background Activity did not expose its log path")

		await sidebar.getByRole("tab", { name: "Work", exact: true }).click()
		await expect(sidebar.getByText("E2E_AUTO_BACKGROUND_HANDOFF_READY", { exact: true })).toBeVisible({
			timeout: 60_000,
		})
		const handoff = server.getMockConsumptions("openai-compatible-chat")[1]
		expect(handoff.contractError).toBeUndefined()

		await sidebar.getByRole("tab", { name: /Activity/ }).click()
		await sidebar.getByRole("button", { name: "All", exact: true }).first().click()
		await expect(activity).toContainText("completed", { timeout: 90_000 })
		await expect.poll(async () => readFile(logPath, "utf8").catch(() => ""), { timeout: 90_000 }).toContain(finishedMarker)
		await sidebar.getByRole("tab", { name: "Work", exact: true }).click()
		await expect(input).toBeEnabled()
		await input.fill("E2E_AUTO_BACKGROUND_FEEDBACK")
		await input.press("Enter")
		await expect(sidebar.getByText("E2E_AUTO_BACKGROUND_RESULT_OK", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		const completion = server.getMockConsumptions("openai-compatible-chat")[2]
		expect(completion.contractError).toBeUndefined()
		const persistedLog = await readFile(logPath, "utf8")
		expect(persistedLog).toContain(startedMarker)
		expect(persistedLog).toContain(finishedMarker)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)
