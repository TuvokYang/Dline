import type { ClineMessage, ExtensionState } from "@shared/ExtensionMessage"
import { describe, expect, it, vi } from "vitest"
import { getTaskHeaderText } from "@/core/storage/disk"
import { readJsonl } from "@/core/storage/jsonl-utils"
import { Controller } from "../index"

// Disk boundary spies: buildState must never fall back to re-reading
// ui_messages.jsonl (getSavedClineMessages -> readJsonl) while the task header
// is still available from the in-memory message list.
vi.mock("@/core/storage/disk", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/core/storage/disk")>()
	return { ...actual, getTaskHeaderText: vi.fn(async () => "") }
})

vi.mock("@/core/storage/jsonl-utils", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/core/storage/jsonl-utils")>()
	return { ...actual, readJsonl: vi.fn() }
})

// buildState also probes OpenAI Codex auth status; keep it hermetic in unit tests.
vi.mock("@/integrations/openai-codex/oauth", () => ({
	openAiCodexOAuthManager: { isAuthenticated: vi.fn(async () => false) },
}))

// The full task-view projection needs a complete runtime state; header sourcing
// under test does not depend on it, so stub the projector output.
vi.mock("@/core/task/view/TaskViewProjector", () => ({
	projectTaskView: vi.fn(() => undefined),
}))

// Environment singletons that are not part of the header-sourcing behavior.
vi.mock("@/services/logging/distinctId", () => ({
	getDistinctId: () => "test-distinct-id",
}))

vi.mock("@/utils/announcements", () => ({
	getLatestAnnouncementId: () => "test-announcement",
}))

const HEADER_TEXT = "test task header"

/** Build a realistic long-conversation message list with a leading task header. */
function buildMessages(count: number): ClineMessage[] {
	const messages: ClineMessage[] = [{ ts: 1, type: "say", say: "task", text: HEADER_TEXT }]
	for (let i = 2; i <= count; i++) {
		messages.push({ ts: i, type: "say", say: "text", text: `message ${i}` })
	}
	return messages
}

/** Minimal Controller-shaped object exposing every field buildState touches. */
function createFakeController(messages: ClineMessage[]): Record<string, unknown> {
	return {
		task: {
			taskId: "test-task-1",
			taskSm: {
				planModeProfile: undefined,
				actModeProfile: undefined,
				mode: "act",
				taskCapabilityToggles: undefined,
			},
			messageStateHandler: { clineMessages: messages },
			taskState: {
				checkpointManagerErrorMessage: undefined,
				currentFocusChainChecklist: null,
				focusChainHistory: null,
			},
			getRuntimeState: () => ({}),
			hasAutoRetrySequence: () => false,
			hasPendingAutoRetry: () => false,
		},
		stateManager: {
			setActiveTaskId: vi.fn(),
			getApiConfiguration: () => ({}),
			getGlobalStateKey: (key: string) => (key === "taskHistory" ? [] : undefined),
			getGlobalSettingsKey: () => undefined,
			getWorkspaceStateKey: () => undefined,
			getRemoteConfigSettings: () => ({}),
		},
		modeSwitchCoordinator: { getSnapshot: () => ({}) },
		getTaskLockStatus: () => undefined,
		backgroundCommandRunning: undefined,
		backgroundCommandTaskId: undefined,
	}
}

const buildState = (
	Controller.prototype as unknown as {
		buildState: (revision: number) => Promise<ExtensionState>
	}
).buildState

describe("buildState header sourcing", () => {
	it("never re-reads the task header from disk while messages are in memory", async () => {
		const getTaskHeaderTextMock = vi.mocked(getTaskHeaderText)
		const readJsonlMock = vi.mocked(readJsonl)
		getTaskHeaderTextMock.mockClear()
		readJsonlMock.mockClear()

		const messages = buildMessages(1500)
		const fakeController = createFakeController(messages)

		// Simulate repeated state pushes: every MessageChannel.say schedules one.
		for (let revision = 1; revision <= 3; revision++) {
			const state = await buildState.call(fakeController, revision)
			expect(state.taskTitleMessage?.text).toBe(HEADER_TEXT)
		}

		expect(getTaskHeaderTextMock).not.toHaveBeenCalled()
		expect(readJsonlMock).not.toHaveBeenCalled()
	})

	it("keeps returning the in-memory header even when disk is unavailable", async () => {
		const messages = buildMessages(50)
		const fakeController = createFakeController(messages)

		const state = await buildState.call(fakeController, 1)

		expect(state.taskTitleMessage?.text).toBe(HEADER_TEXT)
		expect(state.totalMessageCount).toBe(50)
		expect(state.firstItemIndex).toBe(0)
	})
})
