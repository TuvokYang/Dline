import pWaitFor from "p-wait-for"
import * as vscode from "vscode"
import { consumeShellEnvironmentDiagnostics } from "@/integrations/terminal/shell-environment"
import type { TerminalLaunchConfiguration } from "@/integrations/terminal/types"
import { recordPerfPhase } from "@/services/runtime-telemetry/instrumentation/duration-recorder"
import { PerfDomain } from "@/services/runtime-telemetry/instrumentation/perf-domains"
import { Logger } from "@/shared/services/Logger"
import { arePathsEqual } from "@/utils/path"
import type { VscodeTerminalPoolPreparation, VscodeTerminalPoolRuntime } from "./VscodeTerminalPool"
import { type TerminalInfo, TerminalRegistry } from "./VscodeTerminalRegistry"

const DEFAULT_MINIMUM_WARM_SHELL_INTEGRATION_TIMEOUT_MS = 60_000

export class DefaultVscodeTerminalPoolRuntime implements VscodeTerminalPoolRuntime {
	private warmShellIntegrationTimeout: number

	constructor(
		private shellIntegrationTimeout = 4_000,
		private readonly minimumWarmShellIntegrationTimeout = DEFAULT_MINIMUM_WARM_SHELL_INTEGRATION_TIMEOUT_MS,
	) {
		this.warmShellIntegrationTimeout = Math.max(shellIntegrationTimeout, minimumWarmShellIntegrationTimeout)
	}

	setShellIntegrationTimeout(timeoutMs: number): void {
		this.shellIntegrationTimeout = timeoutMs
		this.warmShellIntegrationTimeout = Math.max(timeoutMs, this.minimumWarmShellIntegrationTimeout)
	}

	createTerminal(
		cwd: string,
		shellPath: string | undefined,
		launchConfiguration: TerminalLaunchConfiguration | undefined,
	): TerminalInfo {
		return TerminalRegistry.createTerminal(cwd, shellPath, launchConfiguration)
	}

	async prepareTerminal(
		terminal: TerminalInfo,
		_preparation: VscodeTerminalPoolPreparation,
		launchConfiguration: TerminalLaunchConfiguration,
	): Promise<void> {
		// VS Code may defer shell integration for a terminal that has never been
		// activated. Preserve focus while giving the terminal a render/startup turn.
		terminal.terminal.show(true)
		try {
			await this.waitForShellIntegration(terminal, this.warmShellIntegrationTimeout, "warm")
			if (launchConfiguration.initializationCommand) {
				await this.executeInternal(terminal, launchConfiguration.initializationCommand)
				if (launchConfiguration.initializationDiagnosticsPath) {
					const diagnostics = await consumeShellEnvironmentDiagnostics(
						launchConfiguration.initializationDiagnosticsPath,
					)
					for (const line of diagnostics) Logger.error(`[ShellEnvironment] ${line}`)
					if (diagnostics.length > 0) {
						throw new Error(`Terminal initialization reported ${diagnostics.length} diagnostic entries`)
					}
				}
			}
		} finally {
			terminal.terminal.hide()
		}
	}

	async prepareCwd(terminal: TerminalInfo, cwd: string): Promise<void> {
		await this.waitForShellIntegration(terminal, this.shellIntegrationTimeout, "cwd")
		await this.executeInternal(terminal, `cd "${cwd.replaceAll('"', '\\"')}"`)
		await pWaitFor(
			() => {
				const current = terminal.terminal.shellIntegration?.cwd?.fsPath
				return current !== undefined && arePathsEqual(current, vscode.Uri.file(cwd).fsPath)
			},
			{ timeout: 1_500 },
		)
	}

	disposeTerminal(terminal: TerminalInfo): void {
		terminal.terminal.dispose()
		TerminalRegistry.removeTerminal(terminal.id)
	}

	isTerminalClosed(terminal: TerminalInfo): boolean {
		return terminal.terminal.exitStatus !== undefined
	}

	onDidCloseTerminal(listener: (terminal: TerminalInfo["terminal"]) => void): vscode.Disposable {
		return vscode.window.onDidCloseTerminal(listener)
	}

	onDidStartTerminalShellExecution(
		listener: (event: { execution?: { read?: () => unknown } }) => void,
	): vscode.Disposable | undefined {
		return (vscode.window as vscode.Window).onDidStartTerminalShellExecution?.(listener)
	}

	onDidEndTerminalShellExecution(
		listener: (event: { terminal: TerminalInfo["terminal"]; exitCode: number | undefined }) => void,
	): vscode.Disposable | undefined {
		return (vscode.window as vscode.Window).onDidEndTerminalShellExecution?.(listener)
	}

	private async waitForShellIntegration(terminal: TerminalInfo, timeoutMs: number, phase: "warm" | "cwd"): Promise<void> {
		const startedAt = performance.now()
		await terminal.terminal.processId
		// The telemetry phase stays fixed while `phase` becomes a dimension: the two
		// preparation kinds measure the same operation and must aggregate together.
		recordPerfPhase(PerfDomain.TerminalPool, "warm_process_started", performance.now() - startedAt, {
			terminalId: terminal.id,
			preparation: phase,
			timeoutMs,
		})
		if (Logger.isDebugEnabled()) {
			Logger.debug(
				`[TerminalPerf] phase=${phase}_process_started terminalId=${terminal.id} durationMs=${Math.round(performance.now() - startedAt)} timeoutMs=${timeoutMs}`,
			)
		}
		await pWaitFor(() => terminal.terminal.shellIntegration?.executeCommand !== undefined, { timeout: timeoutMs })
		recordPerfPhase(PerfDomain.TerminalPool, "warm_shell_integration_ready", performance.now() - startedAt, {
			terminalId: terminal.id,
			preparation: phase,
		})
		if (Logger.isDebugEnabled()) {
			Logger.debug(
				`[TerminalPerf] phase=${phase}_shell_integration_ready terminalId=${terminal.id} durationMs=${Math.round(performance.now() - startedAt)}`,
			)
		}
	}

	private async executeInternal(terminal: TerminalInfo, command: string): Promise<void> {
		const executeCommand = terminal.terminal.shellIntegration?.executeCommand
		if (!executeCommand) throw new Error(`Shell integration unavailable for terminal ${terminal.id}`)
		for await (const _output of executeCommand(command).read()) {
			// Draining the stream is the completion boundary for an internal preparation command.
		}
	}
}
