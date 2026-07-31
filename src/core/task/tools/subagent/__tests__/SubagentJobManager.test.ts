import { strict as assert } from "node:assert"
import { describe, it } from "vitest"
import { SubagentJobManager } from "../SubagentJobManager"

/**
 * Wait for queued background job promises to settle.
 * @returns Promise that resolves after the current async queue drains.
 */
async function flushJobs(): Promise<void> {
	await Promise.resolve()
	await Promise.resolve()
}

describe("SubagentJobManager", () => {
	it("lists a completed batch as one injectable batch result", async () => {
		const manager = new SubagentJobManager()
		const batch = manager.startBatch({
			timeoutSeconds: 30,
			items: [
				{
					task: "review api",
					prompt: "<task>review api</task><context>ctx</context>",
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
				},
				{
					task: "review tests",
					prompt: "<task>review tests</task><context>ctx</context>",
					runner: async () => ({
						status: "completed",
						result: "tests ok",
						stats: {
							toolCalls: 2,
							inputTokens: 20,
							outputTokens: 8,
							cacheWriteTokens: 0,
							cacheReadTokens: 0,
							totalCost: 0,
							currency: "USD",
							contextTokens: 150,
							contextWindow: 1000,
							contextUsagePercentage: 15,
						},
					}),
				},
			],
		})

		await flushJobs()

		const managerWithResults = manager as unknown as {
			listInjectableResults?: () => Array<{ kind: string; batch: { batchJobId: string }; jobs: Array<{ jobId: string }> }>
		}
		const results = managerWithResults.listInjectableResults?.()

		assert.ok(Array.isArray(results), "listInjectableResults should return an array")
		assert.equal(results.length, 1)
		assert.equal(results[0]?.kind, "batch")
		assert.equal(results[0]?.batch.batchJobId, batch.batchJobId)
		assert.deepEqual(
			results[0]?.jobs.map((job) => job.jobId),
			batch.itemJobIds,
		)
	})

	it("moves injection state forward only", async () => {
		const manager = new SubagentJobManager()
		const job = manager.startJob({
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

		manager.markConsumed([job.jobId])
		assert.equal(manager.getJob(job.jobId)?.injectionState, "pending")
		assert.equal(manager.listInjectableResults().length, 1)

		manager.markInjected([job.jobId])
		assert.equal(manager.getJob(job.jobId)?.injectionState, "injected")
		assert.equal(manager.listInjectableResults().length, 0)

		manager.markConsumed([job.jobId])
		assert.equal(manager.getJob(job.jobId)?.injectionState, "consumed")

		manager.markInjected([job.jobId])
		assert.equal(manager.getJob(job.jobId)?.injectionState, "consumed")
	})

	it("links batch and item injection states", async () => {
		const manager = new SubagentJobManager()
		const batch = manager.startBatch({
			timeoutSeconds: 30,
			items: [
				{
					task: "review api",
					prompt: "<task>review api</task><context>ctx</context>",
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
				},
				{
					task: "review tests",
					prompt: "<task>review tests</task><context>ctx</context>",
					runner: async () => ({
						status: "completed",
						result: "tests ok",
						stats: {
							toolCalls: 2,
							inputTokens: 20,
							outputTokens: 8,
							cacheWriteTokens: 0,
							cacheReadTokens: 0,
							totalCost: 0,
							currency: "USD",
							contextTokens: 150,
							contextWindow: 1000,
							contextUsagePercentage: 15,
						},
					}),
				},
			],
		})
		await flushJobs()

		manager.markInjected([batch.batchJobId])
		assert.deepEqual(
			batch.itemJobIds.map((jobId) => manager.getJob(jobId)?.injectionState),
			["injected", "injected"],
		)

		manager.markConsumed([batch.itemJobIds[0]])
		assert.equal(manager.getBatch(batch.batchJobId)?.injectionState, "injected")

		manager.markConsumed([batch.itemJobIds[1]])
		assert.equal(manager.getBatch(batch.batchJobId)?.injectionState, "consumed")
	})

	it("notifies batch creation before starting item runners", async () => {
		const manager = new SubagentJobManager()
		let runnerStarted = false
		let createdBeforeRun = false
		let createdJobIds: string[] = []

		manager.startBatch({
			timeoutSeconds: 30,
			items: [
				{
					task: "review api",
					prompt: "<task>review api</task><context>ctx</context>",
					runner: async () => {
						runnerStarted = true
						return {
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
						}
					},
				},
			],
			onCreated: (batch) => {
				createdBeforeRun = !runnerStarted
				createdJobIds = batch.itemJobIds
			},
		})

		await flushJobs()

		assert.equal(createdBeforeRun, true)
		assert.deepEqual(createdJobIds, ["subagent_1"])
	})

	it("marks an all-cancelled background batch as cancelled", async () => {
		const manager = new SubagentJobManager()
		const batch = manager.startBatch({
			timeoutSeconds: 30,
			items: ["one", "two", "three"].map((task) => ({
				task,
				prompt: `<task>${task}</task><context>ctx</context>`,
				runner: async () => ({
					status: "cancelled" as const,
					error: "Subagent run cancelled.",
					stats: {
						toolCalls: 0,
						inputTokens: 0,
						outputTokens: 0,
						cacheWriteTokens: 0,
						cacheReadTokens: 0,
						totalCost: 0,
						currency: "USD",
						contextTokens: 0,
						contextWindow: 1000,
						contextUsagePercentage: 0,
					},
				}),
			})),
		})

		await flushJobs()

		assert.equal(manager.getBatch(batch.batchJobId)?.status, "cancelled")
		const [injectable] = manager.listInjectableResults()
		assert.equal(injectable?.kind, "batch")
		if (injectable?.kind !== "batch") assert.fail("cancelled batch should remain injectable")
		assert.equal(injectable.batch.status, "cancelled")
	})
})
