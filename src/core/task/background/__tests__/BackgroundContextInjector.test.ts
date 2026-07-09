import { strict as assert } from "node:assert"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { type BackgroundCommand, CommandExecutor, StandaloneTerminalManager } from "@integrations/terminal"
import { describe, it } from "vitest"
import { ToolExecutor } from "../../ToolExecutor"
import type { SubagentRunStats } from "../../tools/subagent/SubagentExecutor"
import { SubagentJobManager } from "../../tools/subagent/SubagentJobManager"
import { BackgroundContextInjector, buildTaskBackgroundSection } from "../BackgroundContextInjector"

/**
 * Wait for queued background job promises to settle.
 * @returns Promise that resolves after the current async queue drains.
 */
async function flushJobs(): Promise<void> {
	await Promise.resolve()
	await Promise.resolve()
}

/**
 * Create a background command record for injector tests.
 * @param id Command identifier.
 * @param command Command text.
 * @returns Background command record with pending injection state.
 */
function createCommand(id: string, command: string): BackgroundCommand {
	return {
		id,
		command,
		startTime: Date.now(),
		status: "completed",
		logFilePath: `logs/${id}.log`,
		lineCount: 1,
		injectionState: "pending",
		process: {} as BackgroundCommand["process"],
	}
}

/**
 * Create subagent execution stats for completed job records.
 * @returns Minimal execution stats for tests.
 */
function createStats(): SubagentRunStats {
	return {
		toolCalls: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheWriteTokens: 0,
		cacheReadTokens: 0,
		totalCost: 0,
		currency: "USD",
		contextTokens: 0,
		contextWindow: 0,
		contextUsagePercentage: 0,
	}
}

describe("BackgroundContextInjector", () => {
	it("exposes task-local background providers for environment details", () => {
		const commands: BackgroundCommand[] = [
			{
				id: "command_1",
				command: "npm test",
				startTime: Date.now(),
				status: "running",
				logFilePath: "logs/command_1.log",
				lineCount: 1,
				process: {} as BackgroundCommand["process"],
			},
		]
		const commandExecutor = Object.create(CommandExecutor.prototype) as CommandExecutor
		const commandState = commandExecutor as unknown as {
			standaloneManager: { getAllBackgroundCommands: () => BackgroundCommand[] }
		}
		commandState.standaloneManager = { getAllBackgroundCommands: () => commands }
		const subagentJobManager = new SubagentJobManager()
		const toolExecutor = Object.create(ToolExecutor.prototype) as ToolExecutor
		const toolState = toolExecutor as unknown as { subagentJobManager: SubagentJobManager }
		toolState.subagentJobManager = subagentJobManager

		assert.deepEqual(commandExecutor.listBackgroundCommands(), commands)
		assert.equal(toolExecutor.getSubagentJobManager(), subagentJobManager)
	})

	it("builds task background section from task-local providers", async () => {
		const subagentJobManager = new SubagentJobManager()
		const job = subagentJobManager.startJob({
			task: "review state",
			prompt: "<task>review state</task><context>ctx</context>",
			timeoutSeconds: 30,
			runner: async () => ({ status: "completed", result: "state ok", stats: createStats() }),
		})
		await flushJobs()
		const commands: BackgroundCommand[] = [
			{
				id: "command_2",
				command: "npm run build",
				startTime: Date.now(),
				status: "running",
				logFilePath: "logs/command_2.log",
				lineCount: 3,
				process: {} as BackgroundCommand["process"],
			},
		]

		const details = buildTaskBackgroundSection(
			{ getSubagentJobManager: () => subagentJobManager },
			{ listBackgroundCommands: () => commands },
		)

		assert.match(details, new RegExp(`${job.jobId}: completed — review state`))
		assert.match(details, /command_2: running — npm run build/)
	})

	it("builds injectable background results and pending ids", async () => {
		const subagentJobManager = new SubagentJobManager()
		const job = subagentJobManager.startJob({
			task: "review result state",
			prompt: "<task>review result state</task><context>ctx</context>",
			timeoutSeconds: 30,
			runner: async () => ({ status: "completed", result: "subagent ok", stats: createStats() }),
		})
		await flushJobs()
		const logPath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "background-result-")), "command.log")
		await fs.writeFile(logPath, "command ok\n", "utf8")
		const command = createCommand("command_4", "npm test")
		command.logFilePath = logPath

		const injector = new BackgroundContextInjector({
			subagentJobManager,
			commandProvider: { listBackgroundCommands: () => [command] },
		})
		const result = await injector.buildResultSection()

		assert.match(result.text, /# Background Results/)
		assert.match(result.text, new RegExp(`${job.jobId}: completed — review result state`))
		assert.match(result.text, /subagent ok/)
		assert.match(result.text, /command_4: completed — npm test/)
		assert.match(result.text, /command ok/)
		assert.deepEqual(result.subagentIds, [job.jobId])
		assert.deepEqual(result.commandIds, [command.id])
	})

	it("omits consumed task-local background state from environment details", async () => {
		const subagentJobManager = new SubagentJobManager()
		const job = subagentJobManager.startJob({
			task: "review consumed state",
			prompt: "<task>review consumed state</task><context>ctx</context>",
			timeoutSeconds: 30,
			runner: async () => ({ status: "completed", result: "done", stats: createStats() }),
		})
		await flushJobs()
		subagentJobManager.markInjected([job.jobId])
		subagentJobManager.markConsumed([job.jobId])
		const command = createCommand("command_3", "npm run lint")
		const standaloneManager = new StandaloneTerminalManager()
		const standaloneState = standaloneManager as unknown as { backgroundCommands: Map<string, BackgroundCommand> }
		standaloneState.backgroundCommands.set(command.id, command)
		const commandExecutor = Object.create(CommandExecutor.prototype) as CommandExecutor
		const commandState = commandExecutor as unknown as { standaloneManager: StandaloneTerminalManager }
		commandState.standaloneManager = standaloneManager
		commandExecutor.markBackgroundCommandsInjected([command.id])
		commandExecutor.markBackgroundCommandsConsumed([command.id])

		const details = buildTaskBackgroundSection({ getSubagentJobManager: () => subagentJobManager }, commandExecutor)

		assert.doesNotMatch(details, /review consumed state/)
		assert.doesNotMatch(details, /npm run lint/)
	})

	it("formats non-consumed subagent and command statuses for environment details", async () => {
		const subagentJobManager = new SubagentJobManager()
		const job = subagentJobManager.startJob({
			task: "review api",
			prompt: "<task>review api</task><context>ctx</context>",
			timeoutSeconds: 30,
			runner: async () => ({
				status: "completed",
				result: "api ok",
				stats: {
					toolCalls: 1,
					inputTokens: 10,
					outputTokens: 5,
					cacheWriteTokens: 0,
					cacheReadTokens: 0,
					totalCost: 0,
					currency: "USD",
					contextTokens: 100,
					contextWindow: 1000,
					contextUsagePercentage: 10,
				},
			}),
		})
		await flushJobs()
		const commands: BackgroundCommand[] = [
			{
				id: "command_1",
				command: "npm test",
				startTime: Date.now(),
				status: "completed",
				logFilePath: "logs/command_1.log",
				lineCount: 12,
				injectionState: "pending",
				process: {} as BackgroundCommand["process"],
			},
		]

		const injector = new BackgroundContextInjector({
			subagentJobManager,
			commandProvider: { listBackgroundCommands: () => commands },
		})
		const details = injector.buildEnvironmentSection()

		assert.match(details, /# Background Subagents/)
		assert.match(details, new RegExp(`${job.jobId}: completed — review api`))
		assert.match(details, /# Background Commands/)
		assert.match(details, /command_1: completed — npm test/)
	})
})
