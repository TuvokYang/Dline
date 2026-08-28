import { beforeEach, describe, expect, it, vi } from "vitest"
import type { TerminalLaunchConfiguration } from "@/integrations/terminal/types"
import type { VscodeTerminalPoolPreparation } from "./VscodeTerminalPool"
import { DefaultVscodeTerminalPoolRuntime } from "./VscodeTerminalPoolRuntime"
import type { TerminalInfo } from "./VscodeTerminalRegistry"

function preparation(): VscodeTerminalPoolPreparation {
	return {
		cwd: "C:\\workspace",
		workspaceRoot: "C:\\workspace",
		profileId: "powershell-legacy",
		shellPath: "powershell",
		environmentFingerprint: "default",
		createLaunchConfiguration: () => ({}),
	}
}

function terminalInfo(): TerminalInfo {
	let shellIntegration: { executeCommand: ReturnType<typeof vi.fn> } | undefined
	const terminal = {
		processId: Promise.resolve(1),
		show: vi.fn(() => {
			shellIntegration = {
				executeCommand: vi.fn(() => ({
					async *read() {
						yield ""
					},
				})),
			}
		}),
		hide: vi.fn(),
		get shellIntegration() {
			return shellIntegration
		},
	} as unknown as TerminalInfo["terminal"]
	return {
		terminal,
		busy: false,
		lastCommand: "",
		id: 1,
		lastActive: Date.now(),
	}
}

describe("DefaultVscodeTerminalPoolRuntime", () => {
	beforeEach(() => vi.restoreAllMocks())

	it("activates a new terminal before waiting for shell integration and hides it after preparation", async () => {
		const runtime = new DefaultVscodeTerminalPoolRuntime(100)
		const terminal = terminalInfo()

		await runtime.prepareTerminal(terminal, preparation(), {} as TerminalLaunchConfiguration)

		expect(terminal.terminal.show).toHaveBeenCalledWith(true)
		expect(terminal.terminal.hide).toHaveBeenCalledOnce()
		expect(vi.mocked(terminal.terminal.show).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(terminal.terminal.hide).mock.invocationCallOrder[0],
		)
	})

	it("keeps the background warm budget above the foreground shell wait setting", async () => {
		const runtime = new DefaultVscodeTerminalPoolRuntime(100, 60_000)
		runtime.setShellIntegrationTimeout(15_000)
		const terminal = terminalInfo()

		await runtime.prepareTerminal(terminal, preparation(), {} as TerminalLaunchConfiguration)

		expect(terminal.terminal.show).toHaveBeenCalledWith(true)
	})
})
