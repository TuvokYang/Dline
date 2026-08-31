import { promises as fs } from "node:fs"
import * as path from "node:path"
import chokidar, { type FSWatcher } from "chokidar"
import type { Controller } from "@/core/controller"
import type { HistoryItem } from "@/shared/HistoryItem"
import { Logger } from "@/shared/services/Logger"

interface TaskHistoryControlRequest {
	id: string
	action: "update-and-flush"
	item: HistoryItem
}

interface TaskHistoryControlResponse {
	id: string
	success: boolean
	updateDurationMs?: number
	error?: string
}

export interface TaskHistoryControlHandle {
	dispose(): Promise<void>
}

/**
 * Starts an E2E-only filesystem control channel for TaskHistory operations.
 * Each VS Code instance receives a distinct directory, avoiding fixed-port
 * conflicts while still exercising the real Extension Host Controller.
 */
export async function startTaskHistoryControl(
	controller: Controller,
	controlDirectory: string,
): Promise<TaskHistoryControlHandle> {
	await fs.mkdir(controlDirectory, { recursive: true })
	let watcher: FSWatcher | undefined
	let disposed = false
	const processed = new Set<string>()

	const processRequest = async (requestPath: string): Promise<void> => {
		if (disposed || processed.has(requestPath)) return
		processed.add(requestPath)
		let request: TaskHistoryControlRequest | undefined
		let response: TaskHistoryControlResponse
		try {
			request = JSON.parse(await fs.readFile(requestPath, "utf8")) as TaskHistoryControlRequest
			if (!request.id || request.action !== "update-and-flush" || !request.item?.id) {
				throw new Error("Invalid TaskHistory E2E control request")
			}
			const startedAt = performance.now()
			await controller.updateTaskHistory(request.item)
			const updateDurationMs = performance.now() - startedAt
			await controller.stateManager.taskHistory.flush()
			response = { id: request.id, success: true, updateDurationMs }
		} catch (error) {
			response = {
				id: request?.id ?? path.basename(requestPath),
				success: false,
				error: error instanceof Error ? (error.stack ?? error.message) : String(error),
			}
		}

		const responsePath = requestPath.replace(/\.request\.json$/u, ".response.json")
		await fs.writeFile(responsePath, `${JSON.stringify(response)}\n`, "utf8")
	}

	watcher = chokidar.watch(path.join(controlDirectory, "*.request.json"), {
		ignoreInitial: false,
		awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 },
	})
	watcher.on("add", (requestPath) => void processRequest(requestPath))
	watcher.on("error", (error) => Logger.error("[TaskHistoryE2EControl] Watcher error:", error))

	return {
		async dispose(): Promise<void> {
			if (disposed) return
			disposed = true
			await watcher?.close()
		},
	}
}
