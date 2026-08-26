import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { afterEach, describe, expect, it } from "vitest"
import { UIMessage } from "../../storage/UIMessage"
import { MessageStateHandler } from "../message-state"
import { TaskState } from "../TaskState"

const originalDocumentsDirectory = process.env.DLINE_DOCUMENTS_DIRECTORY

afterEach(() => {
	if (originalDocumentsDirectory === undefined) delete process.env.DLINE_DOCUMENTS_DIRECTORY
	else process.env.DLINE_DOCUMENTS_DIRECTORY = originalDocumentsDirectory
})

describe("MessageState compaction transient overlay", () => {
	it("keeps partial compaction rows out of JSONL and finalizes exactly one durable row", async () => {
		const documentsDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "dline-transient-compaction-"))
		process.env.DLINE_DOCUMENTS_DIRECTORY = documentsDirectory
		const taskId = "task-transient-compaction"
		const uiMessage = await UIMessage.open(taskId)
		const state = new MessageStateHandler({
			taskId,
			ulid: "ulid-transient-compaction",
			taskState: new TaskState(),
			updateTaskHistory: async () => [],
			uiMessage,
		})
		const partial: ClineMessage = {
			ts: 100,
			type: "say",
			say: "tool",
			partial: true,
			text: JSON.stringify({ tool: "summarizeTask", content: "partial", compactionStatus: "running" }),
		}

		state.upsertTransientClineMessage(partial)
		await state.flushUiMessages()
		await uiMessage.close()

		const afterPartial = await UIMessage.open(taskId)
		expect(afterPartial.getAll()).toEqual([])
		await afterPartial.close()

		const reopened = await UIMessage.open(taskId)
		const finalState = new MessageStateHandler({
			taskId,
			ulid: "ulid-transient-compaction",
			taskState: new TaskState(),
			updateTaskHistory: async () => [],
			uiMessage: reopened,
		})
		finalState.upsertTransientClineMessage(partial)
		await finalState.commitTransientClineMessage({
			...partial,
			partial: false,
			text: JSON.stringify({ tool: "summarizeTask", content: "completed", compactionStatus: "completed" }),
			compactionConversationRange: {
				logicalTurnRange: [0, 0],
				apiConversationRange: [0, 1],
				preCompactionApiEndIndex: 1,
			},
		})
		await reopened.close()

		const durable = await UIMessage.open(taskId)
		expect(durable.getAll()).toEqual([
			expect.objectContaining({
				ts: 100,
				partial: false,
				say: "tool",
				compactionConversationRange: {
					logicalTurnRange: [0, 0],
					apiConversationRange: [0, 1],
					preCompactionApiEndIndex: 1,
				},
			}),
		])
		await durable.close()
		await fs.rm(documentsDirectory, { recursive: true, force: true })
	})
})
