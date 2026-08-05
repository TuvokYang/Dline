import { WINDOWS_POWERSHELL_LEGACY_PATH } from "@utils/shell"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"
import { VscodeTerminalManager } from "./VscodeTerminalManager"
import { TerminalRegistry } from "./VscodeTerminalRegistry"

function clearTerminalRegistry(): void {
	for (const terminal of TerminalRegistry.getAllTerminals()) {
		terminal.terminal.dispose()
		TerminalRegistry.removeTerminal(terminal.id)
	}
}

describe("VscodeTerminalManager Windows shell selection", () => {
	const originalPlatform = process.platform

	beforeEach(() => {
		Object.defineProperty(process, "platform", { value: "win32" })
		clearTerminalRegistry()
	})

	afterEach(() => {
		clearTerminalRegistry()
		Object.defineProperty(process, "platform", { value: originalPlatform })
	})

	it("creates the Dline default terminal with Windows PowerShell", async () => {
		const manager = new VscodeTerminalManager()

		const terminal = await manager.getOrCreateTerminal("C:\\workspace")
		const vscodeTerminal = terminal.terminal as unknown as vscode.Terminal

		expect(terminal.shellPath).toBe(WINDOWS_POWERSHELL_LEGACY_PATH)
		expect((vscodeTerminal.creationOptions as vscode.TerminalOptions).shellPath).toBe(WINDOWS_POWERSHELL_LEGACY_PATH)
		manager.disposeAll()
	})

	it("keeps Command Prompt available when it is selected explicitly", async () => {
		const manager = new VscodeTerminalManager()
		manager.configure({
			defaultTerminalProfile: "cmd",
			shellIntegrationTimeout: 4_000,
			terminalOutputLineLimit: 500,
			terminalReuseEnabled: true,
		})

		const terminal = await manager.getOrCreateTerminal("C:\\workspace")

		expect(terminal.shellPath).toBe("C:\\Windows\\System32\\cmd.exe")
		manager.disposeAll()
	})

	it("passes project environment overrides to a configuration-owned terminal", async () => {
		const manager = new VscodeTerminalManager()

		const terminal = await manager.getOrCreateTerminal("C:\\workspace", {
			configurationId: "workspace-environment-v1",
			environment: { DLINE_E2E_ENV: "configured", REMOVE_ME: null },
		})
		const vscodeTerminal = terminal.terminal as unknown as vscode.Terminal
		const creationOptions = vscodeTerminal.creationOptions as vscode.TerminalOptions

		expect(terminal.configurationId).toBe("workspace-environment-v1")
		expect(creationOptions.env).toMatchObject({
			DLINE_ACTIVE: "true",
			DLINE_E2E_ENV: "configured",
			REMOVE_ME: null,
		})
		manager.disposeAll()
	})

	it("runs startup initialization once when a configuration-owned terminal is created", async () => {
		const manager = new VscodeTerminalManager()
		const runCommand = vi
			.spyOn(manager, "runCommand")
			.mockImplementation(() => Promise.resolve() as unknown as ReturnType<VscodeTerminalManager["runCommand"]>)

		const first = await manager.getOrCreateTerminal("C:\\workspace", {
			configurationId: "workspace-startup-v1",
			initializationCommand: "Initialize-DlineTerminal",
		})
		Object.defineProperty(first.terminal, "shellIntegration", {
			configurable: true,
			value: { cwd: vscode.Uri.file("C:\\workspace") },
		})
		const reused = await manager.getOrCreateTerminal("C:\\workspace", {
			configurationId: "workspace-startup-v1",
			initializationCommand: "Initialize-DlineTerminal",
		})

		expect(reused).toBe(first)
		expect(runCommand).toHaveBeenCalledTimes(1)
		expect(runCommand).toHaveBeenCalledWith(first, "Initialize-DlineTerminal")
		expect(first.lastCommand).toBe("")
		manager.disposeAll()
	})
})
