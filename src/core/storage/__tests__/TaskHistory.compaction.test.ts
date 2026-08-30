import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { HistoryItem } from "@/shared/HistoryItem"
import { openBufferedJsonlStore } from "../backend/jsonl/JsonlUnifyStore"
import { TaskHistory } from "../TaskHistory"

let tempDir: string
let filePath: string
let history: TaskHistory | undefined

function historyItem(id: string, ts: number, task: string): HistoryItem {
	return { id, ts, task, tokensIn: 0, tokensOut: 0, totalCost: 0 }
}

/** Seed a history file that holds `revisions` superseded rows per task. */
async function seedRedundantHistory(taskCount: number, revisions: number): Promise<void> {
	const lines: string[] = []
	let ts = 1
	for (let revision = 0; revision < revisions; revision++) {
		for (let task = 0; task < taskCount; task++) {
			lines.push(JSON.stringify(historyItem(`task-${task}`, ts++, `revision-${revision}`)))
		}
	}
	await fs.writeFile(filePath, `${lines.join("\n")}\n`, "utf8")
}

async function openHistory(): Promise<TaskHistory> {
	const store = await openBufferedJsonlStore<HistoryItem>(filePath, {
		schemaId: "task-history",
		flushIntervalMs: 60_000,
		acceptInitialItem: (item) => item.ts > 0,
	})
	return new TaskHistory(store)
}

async function countLines(): Promise<number> {
	const raw = await fs.readFile(filePath, "utf8")
	return raw.split("\n").filter((line) => line.trim().length > 0).length
}

describe("TaskHistory compaction", () => {
	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dline-task-history-compaction-"))
		filePath = path.join(tempDir, "taskHistory.jsonl")
	})

	afterEach(async () => {
		await history?.dispose()
		history = undefined
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	// Every metadata update appends a whole record, so a long-lived history keeps
	// dozens of dead revisions per task. Each later write then rewrites all of
	// them while holding the cross-process lock.
	it("collapses superseded revisions to one entry per task", async () => {
		await seedRedundantHistory(20, 60)
		history = await openHistory()
		expect(await countLines()).toBe(1_200)

		const removed = await history.compact()

		expect(removed).toBe(1_180)
		expect(await countLines()).toBe(20)
	})

	it("keeps the newest revision of every task", async () => {
		await seedRedundantHistory(5, 250)
		history = await openHistory()

		await history.compact()

		const surviving = await history.getAll()
		expect(surviving).toHaveLength(5)
		expect(new Set(surviving.map((item) => item.task))).toEqual(new Set(["revision-249"]))
	})

	// Compaction rewrites the whole file, so it must not run when there is
	// nothing worth reclaiming.
	it("does not rewrite the file when the surplus is below the threshold", async () => {
		await seedRedundantHistory(10, 3)
		history = await openHistory()
		const before = await fs.stat(filePath)

		const removed = await history.compact()

		expect(removed).toBe(0)
		expect((await fs.stat(filePath)).mtimeMs).toBe(before.mtimeMs)
		expect(await countLines()).toBe(30)
	})

	it("is a no-op for a history that holds no superseded rows", async () => {
		await seedRedundantHistory(2_000, 1)
		history = await openHistory()

		expect(await history.compact()).toBe(0)
		expect(await countLines()).toBe(2_000)
	})
})
