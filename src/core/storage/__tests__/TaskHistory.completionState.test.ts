import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { HistoryItem } from "@shared/HistoryItem"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BufferedUnifyStore } from "../backend/api/UnifyStore"
import { openBufferedJsonlStore } from "../backend/jsonl/JsonlUnifyStore"
import { TaskHistory } from "../TaskHistory"

function item(overrides: Partial<HistoryItem> = {}): HistoryItem {
	return {
		id: "task-1",
		task: "Keep metadata intact",
		ts: 100,
		tokensIn: 11,
		tokensOut: 12,
		totalCost: 1.25,
		isFavorited: true,
		modelId: "model-1",
		...overrides,
	}
}

describe("TaskHistory completion state", () => {
	let tempDir: string
	let filePath: string
	let store: BufferedUnifyStore<HistoryItem>
	let history: TaskHistory

	beforeEach(async () => {
		tempDir = await mkdtemp(path.join(os.tmpdir(), "dline-task-history-completion-"))
		filePath = path.join(tempDir, "taskHistory.jsonl")
		store = await openBufferedJsonlStore<HistoryItem>(filePath, {
			schemaId: "task-history-completion-test",
			flushIntervalMs: 60_000,
		})
		history = new TaskHistory(store)
		await history.upsert(item())
	})

	afterEach(async () => {
		await history.dispose()
		await rm(tempDir, { recursive: true, force: true })
	})

	it("durably patches completion without overwriting unrelated metadata", async () => {
		const updated = await history.setCompletionState({ taskId: "task-1", isCompleted: true, revision: 7 })

		expect(updated).toMatchObject({
			id: "task-1",
			isCompleted: true,
			completionStateRevision: 7,
			isFavorited: true,
			totalCost: 1.25,
			modelId: "model-1",
			tokensIn: 11,
			tokensOut: 12,
		})
		const persistedRows = (await readFile(filePath, "utf8"))
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as HistoryItem)
		expect(persistedRows).toEqual([expect.objectContaining({ isCompleted: true, completionStateRevision: 7 })])
	})

	it("establishes a revisioned projection when a legacy boolean already has the same value", async () => {
		await store.mutate((items) => items.map((existing) => ({ ...existing, isCompleted: true })))

		await expect(history.setCompletionState({ taskId: "task-1", isCompleted: true, revision: 7 })).resolves.toMatchObject({
			isCompleted: true,
			completionStateRevision: 7,
		})
	})

	it("rejects stale or conflicting equal revisions without rewriting the current projection", async () => {
		await history.setCompletionState({ taskId: "task-1", isCompleted: true, revision: 7 })

		await expect(history.setCompletionState({ taskId: "task-1", isCompleted: false, revision: 7 })).resolves.toBeUndefined()
		await expect(history.setCompletionState({ taskId: "task-1", isCompleted: false, revision: 6 })).resolves.toBeUndefined()
		await expect(history.getById("task-1")).resolves.toMatchObject({
			isCompleted: true,
			completionStateRevision: 7,
		})
	})

	it("persists a later true to false transition", async () => {
		await history.setCompletionState({ taskId: "task-1", isCompleted: true, revision: 7 })

		await expect(history.setCompletionState({ taskId: "task-1", isCompleted: false, revision: 8 })).resolves.toMatchObject({
			isCompleted: false,
			completionStateRevision: 8,
		})
		await expect(history.getById("task-1")).resolves.toMatchObject({
			isCompleted: false,
			completionStateRevision: 8,
		})
	})

	it("preserves a newer completion projection during buffered metadata updates", async () => {
		await history.setCompletionState({ taskId: "task-1", isCompleted: true, revision: 7 })

		await history.upsertTaskHistory(item({ isCompleted: false, completionStateRevision: 99, tokensIn: 99, totalCost: 4.5 }))

		await expect(history.getById("task-1")).resolves.toMatchObject({
			isCompleted: true,
			completionStateRevision: 7,
			tokensIn: 99,
			totalCost: 4.5,
		})
	})

	it("does not establish a completion projection through an ordinary upsert", async () => {
		await history.upsert(item({ isCompleted: true, completionStateRevision: 99 }))

		await expect(history.getById("task-1")).resolves.not.toHaveProperty("isCompleted")
		await expect(history.getById("task-1")).resolves.not.toHaveProperty("completionStateRevision")
	})

	it("serializes buffered metadata reads with durable completion mutations", async () => {
		let markStageStarted!: () => void
		let releaseStage!: () => void
		const stageStarted = new Promise<void>((resolve) => {
			markStageStarted = resolve
		})
		const stageRelease = new Promise<void>((resolve) => {
			releaseStage = resolve
		})
		const originalStageUpdateAt = store.stageUpdateAt.bind(store)
		vi.spyOn(store, "stageUpdateAt").mockImplementation(async (index, updatedItem) => {
			markStageStarted()
			await stageRelease
			await originalStageUpdateAt(index, updatedItem)
		})
		const mutate = vi.spyOn(store, "mutate")

		const metadataUpdate = history.upsertTaskHistory(item({ tokensIn: 99 }))
		await stageStarted
		const completionUpdate = history.setCompletionState({ taskId: "task-1", isCompleted: true, revision: 7 })

		expect(mutate).not.toHaveBeenCalled()
		releaseStage()
		await Promise.all([metadataUpdate, completionUpdate])
		await expect(history.getById("task-1")).resolves.toMatchObject({
			isCompleted: true,
			completionStateRevision: 7,
			tokensIn: 99,
		})
	})

	it("does not rewrite an unchanged completion value", async () => {
		await history.setCompletionState({ taskId: "task-1", isCompleted: true, revision: 7 })
		const before = await readFile(filePath, "utf8")

		await expect(history.setCompletionState({ taskId: "task-1", isCompleted: true, revision: 8 })).resolves.toBeUndefined()
		expect(await readFile(filePath, "utf8")).toBe(before)
	})
})
