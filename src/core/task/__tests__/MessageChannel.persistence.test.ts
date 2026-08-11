import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { UIMessage } from "../../storage/UIMessage"
import { MessageChannel } from "../MessageChannel"
import { MessageStateHandler } from "../message-state"
import { TaskState } from "../TaskState"

describe("MessageChannel completion ask persistence", () => {
	let docsDir: string
	let previousDocsDir: string | undefined

	beforeEach(async () => {
		previousDocsDir = process.env.DLINE_DOCS_DIR
		docsDir = await mkdtemp(path.join(os.tmpdir(), "dline-completion-ask-"))
		process.env.DLINE_DOCS_DIR = docsDir
	})

	afterEach(async () => {
		if (previousDocsDir === undefined) {
			delete process.env.DLINE_DOCS_DIR
		} else {
			process.env.DLINE_DOCS_DIR = previousDocsDir
		}
		await rm(docsDir, { force: true, recursive: true })
	})

	it("persists the latest reasoning delta when the task store closes mid-stream", async () => {
		const taskId = "task-partial-reasoning-close"
		const taskState = new TaskState()
		const uiMessage = await UIMessage.open(taskId)
		const messageStateHandler = new MessageStateHandler({
			taskId,
			ulid: "ulid-partial-reasoning-close",
			taskState,
			uiMessage,
			updateTaskHistory: async () => [],
		})
		const channel = new MessageChannel({
			pushMessage: () => {},
			syncState: async () => {},
			messageStateHandler,
			taskState,
			getProviderInfo: () => ({ providerId: "test", modelId: "test-model", mode: "act" }),
			genTs: () => 100,
		})

		await channel.say("reasoning", "first thinking delta", undefined, undefined, true, 100)
		await channel.say("reasoning", "latest complete thinking snapshot", undefined, undefined, true, 100)
		await messageStateHandler.close()

		const reopened = await UIMessage.open(taskId)
		expect(reopened.getAll()).toEqual([
			expect.objectContaining({
				ts: 100,
				type: "say",
				say: "reasoning",
				text: "latest complete thinking snapshot",
				partial: true,
			}),
		])
		await reopened.close()
	})

	it("keeps the upgraded completion ask anchor after reopening ui_messages.jsonl", async () => {
		const taskId = "task-completion-ask"
		const taskState = new TaskState()
		const uiMessage = await UIMessage.open(taskId)
		const messageStateHandler = new MessageStateHandler({
			taskId,
			ulid: "ulid-completion-ask",
			taskState,
			uiMessage,
			updateTaskHistory: async () => [],
		})
		const channel = new MessageChannel({
			pushMessage: () => {},
			syncState: async () => {},
			messageStateHandler,
			taskState,
			getProviderInfo: () => ({ providerId: "test", modelId: "test-model", mode: "act" }),
			genTs: () => 100,
		})

		await channel.say("completion_result", "done", undefined, undefined, false, 100)
		await channel.presentAsk("completion_result", "done", 100, "completion-1")

		const reopened = await UIMessage.open(taskId)
		const persisted = reopened.getAll()
		const raw = await readFile(path.join(docsDir, "tasks", taskId, "ui_messages.jsonl"), "utf8")
		const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0)

		expect(lines).toHaveLength(1)
		expect(persisted).toHaveLength(1)
		expect(persisted[0]).toMatchObject({
			ts: 100,
			type: "ask",
			ask: "completion_result",
			text: "done",
			interactionId: "completion-1",
		})
		expect(persisted[0].say).toBeUndefined()
	})
})
