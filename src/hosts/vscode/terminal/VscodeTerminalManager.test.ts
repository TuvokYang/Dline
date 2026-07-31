import { WINDOWS_POWERSHELL_LEGACY_PATH } from "@utils/shell"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type * as vscode from "vscode"
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

		expect(terminal.shellPath).toBe(WINDOWS_POWERSHELL_LEGACY_PATH)
		expect((terminal.terminal.creationOptions as vscode.TerminalOptions).shellPath).toBe(WINDOWS_POWERSHELL_LEGACY_PATH)
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
})
