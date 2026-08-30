import { randomUUID } from "node:crypto"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import * as path from "node:path"
import { expect } from "@playwright/test"
import type { HistoryItem } from "@shared/HistoryItem"
import { E2ETestHelper, e2e } from "./utils/helpers"
import { MultiInstanceLauncher, type MultiInstanceSurface } from "./utils/multi-instance"

interface ControlResponse {
	success: boolean
	updateDurationMs?: number
	error?: string
}

/**
 * Upper bound for a single task-history metadata update.
 *
 * The reported defect was a metadata write that rewrote a 95 MB history under
 * the cross-process lock, so a real regression lands in the hundreds of
 * milliseconds or worse. The bound is deliberately loose: it must catch a
 * return to whole-file work without turning CI timing noise into failures.
 */
const UPDATE_BUDGET_MS = 750

const SEEDED_TASK_COUNT = 400
const SEEDED_REVISIONS_PER_TASK = 25

function historyPath(dlineDocsDir: string): string {
	return path.join(dlineDocsDir, "tasks", "taskHistory.jsonl")
}

/**
 * Seed a history that already carries many superseded revisions per task,
 * reproducing the shape a long-lived installation reaches.
 */
async function seedLargeHistory(dlineDocsDir: string): Promise<void> {
	const filePath = historyPath(dlineDocsDir)
	await mkdir(path.dirname(filePath), { recursive: true })
	const lines: string[] = []
	let ts = 1
	for (let revision = 0; revision < SEEDED_REVISIONS_PER_TASK; revision++) {
		for (let task = 0; task < SEEDED_TASK_COUNT; task++) {
			const item: HistoryItem = {
				id: `seeded-task-${task}`,
				ts: ts++,
				// Pad the record so the file resembles real history volume.
				task: `seeded revision ${revision} ${"x".repeat(512)}`,
				tokensIn: revision,
				tokensOut: revision,
				totalCost: 0,
			}
			lines.push(JSON.stringify(item))
		}
	}
	await writeFile(filePath, `${lines.join("\n")}\n`, "utf8")
}

async function updateAndFlush(surface: MultiInstanceSurface, item: HistoryItem): Promise<ControlResponse> {
	await mkdir(surface.controlDirectory, { recursive: true })
	const requestId = randomUUID()
	const requestPath = path.join(surface.controlDirectory, `${requestId}.request.json`)
	const responsePath = path.join(surface.controlDirectory, `${requestId}.response.json`)
	await writeFile(requestPath, `${JSON.stringify({ id: requestId, action: "update-and-flush", item })}\n`, "utf8")
	return await E2ETestHelper.waitForValue(async () => {
		const content = await readFile(responsePath, "utf8").catch(() => undefined)
		return content ? (JSON.parse(content) as ControlResponse) : undefined
	}, 60_000)
}

async function countHistoryRows(dlineDocsDir: string): Promise<number> {
	const content = await readFile(historyPath(dlineDocsDir), "utf8").catch(() => "")
	return content.split(/\r?\n/u).filter(Boolean).length
}

e2e(
	"Task history stays responsive and self-compacts on a large history",
	async ({ dlineDir, dlineDocsDir, server, workspaceDir }, testInfo) => {
		e2e.setTimeout(300_000)
		await seedLargeHistory(dlineDocsDir)
		const seededRows = SEEDED_TASK_COUNT * SEEDED_REVISIONS_PER_TASK
		expect(await countHistoryRows(dlineDocsDir)).toBe(seededRows)
		const seededSize = (await stat(historyPath(dlineDocsDir))).size

		const launcher = new MultiInstanceLauncher({ dlineDir, dlineDocsDir, server, testInfo, workspaceDir })
		try {
			const instance = await launcher.launch("task-history-latency")

			// Startup compaction runs off the critical path; it must collapse the
			// superseded revisions rather than leave the file at its seeded size.
			await expect
				.poll(() => countHistoryRows(dlineDocsDir), { timeout: 120_000 })
				.toBeLessThanOrEqual(SEEDED_TASK_COUNT + 1)
			expect((await stat(historyPath(dlineDocsDir))).size).toBeLessThan(seededSize)

			// A metadata update must not wait on whole-file work.
			const response = await updateAndFlush(instance, {
				id: `latency-probe-${Date.now()}`,
				ts: Date.now(),
				task: "large history latency probe",
				tokensIn: 1,
				tokensOut: 1,
				totalCost: 0,
			})
			expect(response).toMatchObject({ success: true })
			expect(response.updateDurationMs).toBeLessThan(UPDATE_BUDGET_MS)
		} finally {
			await launcher.dispose()
		}
	},
)

e2e(
	"Concurrent instances update a large task history without lock starvation",
	async ({ dlineDir, dlineDocsDir, server, workspaceDir }, testInfo) => {
		e2e.setTimeout(300_000)
		await seedLargeHistory(dlineDocsDir)

		const launcher = new MultiInstanceLauncher({ dlineDir, dlineDocsDir, server, testInfo, workspaceDir })
		try {
			const [instanceA, instanceB] = await Promise.all([
				launcher.launch("task-history-load-a"),
				launcher.launch("task-history-load-b"),
			])
			const baseTs = Date.now()

			// Both windows watch the same file, so a write in one triggers a reload in
			// the other. Without coalescing they exhaust the bounded lock retry budget
			// and the update fails outright.
			const responses = await Promise.all([
				updateAndFlush(instanceA, {
					id: `concurrent-a-${baseTs}`,
					ts: baseTs + 1,
					task: "concurrent A",
					tokensIn: 1,
					tokensOut: 1,
					totalCost: 0,
				}),
				updateAndFlush(instanceB, {
					id: `concurrent-b-${baseTs}`,
					ts: baseTs + 2,
					task: "concurrent B",
					tokensIn: 1,
					tokensOut: 1,
					totalCost: 0,
				}),
			])

			for (const response of responses) {
				expect(response).toMatchObject({ success: true })
				expect(response.updateDurationMs).toBeLessThan(UPDATE_BUDGET_MS)
			}
		} finally {
			await launcher.dispose()
		}
	},
)
