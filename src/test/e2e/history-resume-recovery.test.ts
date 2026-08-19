import { readdir, readFile, writeFile } from "node:fs/promises"
import * as path from "node:path"
import { expect, type Frame } from "@playwright/test"
import { commitCompactionCheckpoint } from "../../core/context/context-management/fitting-commit"
import { FittingRecoveryStore } from "../../core/context/context-management/fitting-recovery-store"
import { prepareCompactionCheckpointRestore } from "../../core/context/context-management/fitting-restore"
import type { TargetWindowFittingState } from "../../core/context/context-management/target-window-fitting"
import type { ContextCompactionCheckpointPayload } from "../../core/task/ContextCompactionCheckpoint"
import type { TaskSnapshot } from "../../core/task/TaskSnapshot"
import { E2ETestHelper, e2e } from "./utils/helpers"

async function sendTask(sidebar: Frame, text: string): Promise<void> {
	const input = sidebar.getByTestId("chat-input")
	await input.fill(text)
	await sidebar.getByTestId("send-button").click()
	await expect(sidebar.getByText(text, { exact: true }).first()).toBeVisible()
}

async function closeCurrentTask(sidebar: Frame): Promise<void> {
	const closeButton = sidebar.getByRole("button", { name: "Close Task", exact: true })
	await expect(closeButton).toBeVisible()
	await closeButton.click()
	await expect(sidebar.getByTestId("chat-input")).toBeVisible()
	await E2ETestHelper.dismissWhatsNewModal(sidebar)
}

async function reopenTask(sidebar: Frame, taskText: string): Promise<void> {
	const historyTask = sidebar.getByText(taskText, { exact: true }).last()
	await expect(historyTask).toBeVisible({ timeout: 30_000 })
	await historyTask.click()
	await expect(sidebar.getByText(taskText, { exact: true }).first()).toBeVisible({ timeout: 30_000 })
}

async function onlyTaskId(dlineDocsDir: string): Promise<string> {
	const entries = await readdir(path.join(dlineDocsDir, "tasks"), { withFileTypes: true })
	const taskIds = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
	if (taskIds.length !== 1 || !taskIds[0]) {
		throw new Error(`Expected exactly one persisted task, found ${taskIds.length}`)
	}
	return taskIds[0]
}

function fittingState(operationId: string, passIndex: number): TargetWindowFittingState {
	return {
		operationId,
		sourceHistory: [],
		turns: [],
		protectedTail: [],
		coveredTurnCount: passIndex,
		passIndex,
		passStartTurnIndex: passIndex,
		passEndTurnIndex: passIndex,
		cumulativeSummary: passIndex === 0 ? "" : `summary-${passIndex}`,
		summaryBaselineHash: passIndex === 0 ? "empty" : `summary-${passIndex - 1}`,
		passPlanned: false,
	}
}

function checkpointPayload(input: {
	taskId: string
	operationId: string
	kind: "root" | "pass"
	passIndex: number
	timestamp: number
	runtimeSnapshot: TaskSnapshot
}): ContextCompactionCheckpointPayload {
	const state = fittingState(input.operationId, input.passIndex)
	return {
		schemaVersion: 1,
		kind: input.kind,
		taskId: input.taskId,
		operationId: input.operationId,
		trigger: "auto_compaction",
		canonicalHistory: [],
		fittingState: state,
		materializedHistory: [],
		canonicalCommitHistory: [],
		protectedContinuation: [],
		passGuidance: [],
		ordinaryInput: [],
		uiMessageBoundary: { count: 1, lastMessageTs: 0 },
		runtimeSnapshot: { ...input.runtimeSnapshot, timestamp: input.timestamp },
		manualState: {},
		oneShotState: { recentlyModifiedFiles: { files: [], revisions: {} } },
		sourceScope: {
			mode: "act",
			providerId: "openai-compatible",
			modelId: "dline-e2e-model",
			contextWindow: 128_000,
			fingerprint: "e2e-source-scope",
		},
		targetScope: {
			mode: "act",
			providerId: "openai-compatible",
			modelId: "dline-e2e-model",
			contextWindow: 128_000,
			fingerprint: "e2e-target-scope",
		},
		indicator: {
			revision: 0,
			phase: "durable",
			durableContextTokens: 100,
			pendingSendTokens: 0,
			receivingTokens: 0,
			environmentTokens: 0,
			contextWindow: 128_000,
			source: "legacy_unsegmented",
			requestPressures: [],
		},
	}
}

async function seedSupersededRestoreJournal(
	taskDirectory: string,
	taskId: string,
	runtimeSnapshot: TaskSnapshot,
): Promise<{ olderOperationId: string; store: FittingRecoveryStore }> {
	const store = new FittingRecoveryStore(path.join(taskDirectory, "context-compaction-recovery"))
	const baseTimestamp = runtimeSnapshot.timestamp
	const olderOperationId = `auto-compaction:${taskId}:3971:${baseTimestamp - 2}`
	const newerOperationId = `auto-compaction:${taskId}:149:${baseTimestamp + 2}`
	const olderRoot = await store.createRoot({
		operationId: olderOperationId,
		branchId: `branch:${olderOperationId}:0`,
		payload: checkpointPayload({
			taskId,
			operationId: olderOperationId,
			kind: "root",
			passIndex: 0,
			timestamp: baseTimestamp - 2,
			runtimeSnapshot,
		}),
	})
	const olderPass = await store.appendCheckpoint({
		operationId: olderOperationId,
		expectedHeadCheckpointId: olderRoot.head.headCheckpointId,
		expectedChainRevision: olderRoot.head.chainRevision,
		passIdentity: {
			operationId: olderOperationId,
			passIndex: 0,
			passStartTurnIndex: 0,
			passEndTurnIndex: 0,
			coveredTurnCount: 0,
			summaryBaselineHash: "empty",
			passHistoryHash: "e2e-history",
		},
		attempt: { attemptIndex: 0, authorizationAttemptId: "e2e-attempt-0" },
		payload: checkpointPayload({
			taskId,
			operationId: olderOperationId,
			kind: "pass",
			passIndex: 1,
			timestamp: baseTimestamp - 2,
			runtimeSnapshot,
		}),
	})
	await prepareCompactionCheckpointRestore<ContextCompactionCheckpointPayload>({
		store,
		operationId: olderOperationId,
		checkpointId: olderRoot.root.checkpointId,
		expectedHeadCheckpointId: olderPass.head.headCheckpointId,
		expectedChainRevision: olderPass.head.chainRevision,
		completionPhase: "cancelled",
	})

	const newerRoot = await store.createRoot({
		operationId: newerOperationId,
		branchId: `branch:${newerOperationId}:0`,
		payload: checkpointPayload({
			taskId,
			operationId: newerOperationId,
			kind: "root",
			passIndex: 0,
			timestamp: baseTimestamp + 2,
			runtimeSnapshot,
		}),
	})
	await commitCompactionCheckpoint<ContextCompactionCheckpointPayload>({
		store,
		operationId: newerOperationId,
		expectedHeadCheckpointId: newerRoot.head.headCheckpointId,
		expectedChainRevision: newerRoot.head.chainRevision,
		requiresAdoption: false,
		applyCanonical: async () => undefined,
	})
	return { olderOperationId, store }
}

e2e(
	"History resume - stale compaction restore cannot hide Resume after completed read and exhausted 503 retries",
	async ({ dlineDocsDir, helper, server, sidebar, userDataDir }) => {
		e2e.setTimeout(240_000)
		server.resetOpenAiMock()
		const taskText = "E2E_HISTORY_STALE_COMPACTION_READ_TASK"
		const resumeDraft = "E2E_HISTORY_STALE_COMPACTION_RESUME_DRAFT"
		server.enqueueOpenAiResponses(
			{ type: "tool", id: "call_history_stale_read", name: "read_file", arguments: { path: "README.md" } },
			{ type: "error", status: 503, code: "e2e_unavailable_0", message: "Service temporarily unavailable" },
			{ type: "error", status: 503, code: "e2e_unavailable_1", message: "Service temporarily unavailable" },
			{ type: "error", status: 503, code: "e2e_unavailable_2", message: "Service temporarily unavailable" },
			{ type: "error", status: 503, code: "e2e_unavailable_3", message: "Service temporarily unavailable" },
			{
				type: "tool",
				id: "call_history_stale_resumed",
				name: "attempt_completion",
				arguments: { result: "E2E_HISTORY_STALE_COMPACTION_RESUME_OK" },
				expectedToolResults: [{ callId: "call_history_stale_read", contentIncludes: "# Test Workspace" }],
				expectedRequestIncludes: ["The previous task session was closed and has now been restored.", resumeDraft],
			},
		)
		await helper.signin(sidebar)
		await sendTask(sidebar, taskText)

		await expect(sidebar.getByText("Dline read 1 file:", { exact: true })).toBeVisible({ timeout: 60_000 })
		const errorCard = sidebar.locator(
			'[data-testid="api-error-box"], [data-testid="error-message-box"], [data-testid="error-presentation-box"], [data-testid="error-retry-box"]',
		)
		await expect(errorCard).toContainText("503", { timeout: 120_000 })
		await expect(errorCard).toContainText("Service temporarily unavailable")
		await expect.poll(() => server.getRequestCount("openai-compatible-chat"), { timeout: 120_000 }).toBe(5)
		await expect(errorCard).toContainText("e2e_unavailable_3", { timeout: 30_000 })
		const footerBeforeClose = sidebar.getByRole("contentinfo")
		await expect(footerBeforeClose.getByText("Retry", { exact: true })).toBeVisible()
		await expect(footerBeforeClose.getByText("Start New Task", { exact: true })).toBeVisible()
		await expect(footerBeforeClose.getByText("Cancel", { exact: true })).toHaveCount(0)

		await closeCurrentTask(sidebar)
		const taskId = await onlyTaskId(dlineDocsDir)
		const taskDirectory = path.join(dlineDocsDir, "tasks", taskId)
		const snapshotPath = path.join(taskDirectory, "snapshot.json")
		const persistedSnapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as TaskSnapshot
		const readBlock = persistedSnapshot.turn?.blocks.find((block) => block.toolName === "read_file")
		expect(readBlock).toMatchObject({ phase: "completed" })
		if (!persistedSnapshot.turn || !readBlock) throw new Error("Expected a completed read_file turn before history recovery")
		const streamingSnapshot: TaskSnapshot = {
			...persistedSnapshot,
			phase: "streaming" as TaskSnapshot["phase"],
			timestamp: Date.now(),
			revision: (persistedSnapshot.revision ?? 0) + 1,
			anchor: {
				...(persistedSnapshot.anchor ?? { apiIndex: persistedSnapshot.apiIndex }),
				turnId: persistedSnapshot.turn.turnId,
				interactionId: undefined,
			},
			interaction: undefined,
			interruptedInteraction: undefined,
			cancellation: undefined,
			runtimeError: undefined,
			completion: undefined,
		}
		await writeFile(snapshotPath, `${JSON.stringify(streamingSnapshot)}\n`, "utf8")
		const { olderOperationId, store } = await seedSupersededRestoreJournal(taskDirectory, taskId, streamingSnapshot)

		await reopenTask(sidebar, taskText)
		const footer = sidebar.getByRole("contentinfo")
		const resumeButton = footer.getByText("Resume", { exact: true })
		const input = sidebar.getByTestId("chat-input")
		await expect(resumeButton).toBeVisible({ timeout: 30_000 })
		await expect(input).toBeEnabled()
		await expect(errorCard).toContainText("Service temporarily unavailable")
		await expect.poll(() => server.getRequestCount("openai-compatible-chat")).toBe(5)
		expect(await store.loadOperation(olderOperationId)).toMatchObject({
			phase: "restore_pending",
			restoreJournal: expect.any(Object),
		})

		await input.fill(resumeDraft)
		await resumeButton.click()
		await expect(input).toHaveValue("")
		await expect(sidebar.getByText("E2E_HISTORY_STALE_COMPACTION_RESUME_OK", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await expect.poll(() => server.getRequestCount("openai-compatible-chat")).toBe(6)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir, [/Service temporarily unavailable/])
	},
)
