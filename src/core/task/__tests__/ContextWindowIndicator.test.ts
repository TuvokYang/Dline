import { type ContextWindowIndicatorLineage, getContextWindowIndicatorTotalTokens } from "@shared/context-window-indicator"
import { describe, expect, it } from "vitest"
import { ContextWindowIndicator } from "../ContextWindowIndicator"

const ordinaryAttempt0: ContextWindowIndicatorLineage = {
	kind: "ordinary",
	requestId: "request-1",
	requestSequence: 1,
	attemptId: "attempt-0",
}

const ordinaryAttempt1: ContextWindowIndicatorLineage = {
	kind: "ordinary",
	requestId: "request-1",
	requestSequence: 1,
	attemptId: "attempt-1",
}

const passBranch0: ContextWindowIndicatorLineage = {
	kind: "compaction_pass",
	operationId: "operation-1",
	passIndex: 0,
	attemptIndex: 0,
	attemptId: "pass-attempt-0",
	headCheckpointId: "checkpoint-0",
	chainRevision: 0,
	branchId: "branch-0",
}

function createIndicator() {
	return new ContextWindowIndicator({
		taskId: "task-1",
		durableContextTokens: 100,
		environmentTokens: 20,
		contextWindow: 1_000,
		profileId: "source-profile",
		profileName: "Source",
		mode: "act",
		updatedAt: 1,
	})
}

describe("ContextWindowIndicator", () => {
	it("publishes one segmented target snapshot before a request is sent", () => {
		const indicator = createIndicator()

		const snapshot = indicator.beginSend({
			lineage: ordinaryAttempt0,
			durableContextTokens: 100,
			pendingSendTokens: 300,
			environmentTokens: 50,
			contextWindow: 500,
			profileId: "target-profile",
			profileName: "Target",
			mode: "plan",
			updatedAt: 2,
		})

		expect(snapshot).toMatchObject({
			revision: 1,
			epoch: 1,
			phase: "sending",
			durableContextTokens: 100,
			pendingSendTokens: 300,
			receivingTokens: 0,
			environmentTokens: 50,
			contextWindow: 500,
			profileId: "target-profile",
			mode: "plan",
			lineage: ordinaryAttempt0,
		})
		expect(getContextWindowIndicatorTotalTokens(snapshot)).toBe(450)
	})

	it("adopts a committed Profile scope without changing tokens or lineage", () => {
		const indicator = createIndicator()

		const adopted = indicator.adoptScope({
			contextWindow: 2_000,
			profileId: "target-profile",
			profileName: "Target",
			mode: "plan",
			updatedAt: 2,
		})

		expect(adopted).toMatchObject({
			revision: 1,
			epoch: 1,
			phase: "stable",
			durableContextTokens: 100,
			environmentTokens: 20,
			contextWindow: 2_000,
			profileId: "target-profile",
			profileName: "Target",
			mode: "plan",
			lineage: { kind: "baseline" },
		})

		indicator.beginSend({
			lineage: ordinaryAttempt0,
			durableContextTokens: 100,
			pendingSendTokens: 50,
			environmentTokens: 20,
			contextWindow: 2_000,
			profileId: "target-profile",
			profileName: "Target",
			mode: "plan",
		})
		const rolledBack = indicator.rollback({ lineage: ordinaryAttempt0 })

		expect(rolledBack).toMatchObject({
			contextWindow: 2_000,
			profileId: "target-profile",
			profileName: "Target",
			mode: "plan",
			durableContextTokens: 100,
			environmentTokens: 20,
		})
	})

	it("accepts only monotonic receiving totals from the current lineage", () => {
		const indicator = createIndicator()
		indicator.beginSend({
			lineage: ordinaryAttempt0,
			durableContextTokens: 100,
			pendingSendTokens: 300,
			environmentTokens: 50,
			contextWindow: 500,
			mode: "act",
		})

		const receiving = indicator.receive({ lineage: ordinaryAttempt0, receivingTokens: 40, updatedAt: 3 })
		const duplicate = indicator.receive({ lineage: ordinaryAttempt0, receivingTokens: 40, updatedAt: 4 })
		const lower = indicator.receive({ lineage: ordinaryAttempt0, receivingTokens: 35, updatedAt: 5 })
		const stale = indicator.receive({ lineage: ordinaryAttempt1, receivingTokens: 80, updatedAt: 6 })

		expect(receiving).toMatchObject({ revision: 2, phase: "receiving", receivingTokens: 40 })
		expect(duplicate.revision).toBe(2)
		expect(lower.revision).toBe(2)
		expect(stale.revision).toBe(2)
	})

	it("invalidates an old attempt and detached branch when a newer epoch starts", () => {
		const indicator = createIndicator()
		indicator.beginSend({
			lineage: passBranch0,
			durableContextTokens: 100,
			pendingSendTokens: 200,
			environmentTokens: 30,
			contextWindow: 600,
			mode: "act",
		})
		indicator.beginSend({
			lineage: ordinaryAttempt1,
			durableContextTokens: 100,
			pendingSendTokens: 250,
			environmentTokens: 30,
			contextWindow: 600,
			mode: "act",
		})

		const stalePass = indicator.receive({ lineage: passBranch0, receivingTokens: 90 })
		const current = indicator.receive({ lineage: ordinaryAttempt1, receivingTokens: 25 })

		expect(stalePass).toMatchObject({ epoch: 2, revision: 2, receivingTokens: 0 })
		expect(current).toMatchObject({ epoch: 2, revision: 3, receivingTokens: 25 })
	})

	it("commits, rolls back, and restores without leaving temporary segments active", () => {
		const indicator = createIndicator()
		indicator.beginSend({
			lineage: ordinaryAttempt0,
			durableContextTokens: 100,
			pendingSendTokens: 300,
			environmentTokens: 20,
			contextWindow: 1_000,
			mode: "act",
		})
		indicator.receive({ lineage: ordinaryAttempt0, receivingTokens: 50 })
		const checkpointLineage: ContextWindowIndicatorLineage = {
			kind: "checkpoint",
			operationId: "operation-1",
			checkpointId: "checkpoint-1",
			chainRevision: 1,
			branchId: "branch-0",
		}
		const committed = indicator.commit({
			lineage: ordinaryAttempt0,
			nextLineage: checkpointLineage,
			durableContextTokens: 420,
			pendingSendTokens: 30,
			environmentTokens: 25,
			updatedAt: 4,
		})
		const settled = indicator.settle({ lineage: checkpointLineage, updatedAt: 5 })
		indicator.beginSend({
			lineage: ordinaryAttempt1,
			durableContextTokens: 450,
			pendingSendTokens: 100,
			environmentTokens: 25,
			contextWindow: 1_000,
			mode: "act",
		})
		const rolledBack = indicator.rollback({ lineage: ordinaryAttempt1, updatedAt: 7 })
		const restoreLineage: ContextWindowIndicatorLineage = {
			kind: "restore",
			operationId: "operation-1",
			journalId: "restore-1",
			targetCheckpointId: "checkpoint-0",
			headCheckpointId: "checkpoint-0",
			chainRevision: 2,
			branchId: "branch-1",
		}
		const restored = indicator.restore({
			lineage: restoreLineage,
			durableContextTokens: 80,
			pendingSendTokens: 20,
			environmentTokens: 20,
			contextWindow: 1_000,
			profileId: "source-profile",
			mode: "act",
			updatedAt: 8,
		})

		expect(committed).toMatchObject({
			phase: "committing",
			durableContextTokens: 450,
			pendingSendTokens: 0,
			receivingTokens: 0,
			lineage: checkpointLineage,
		})
		expect(settled.phase).toBe("stable")
		expect(rolledBack).toMatchObject({
			phase: "rolling_back",
			durableContextTokens: 450,
			pendingSendTokens: 0,
			receivingTokens: 0,
			lineage: checkpointLineage,
		})
		expect(restored).toMatchObject({
			phase: "restoring",
			epoch: 4,
			durableContextTokens: 100,
			pendingSendTokens: 0,
			receivingTokens: 0,
			environmentTokens: 20,
			lineage: restoreLineage,
		})
	})

	it("refreshes dynamic environment and Provider scope only while stable", () => {
		const indicator = createIndicator()
		const refreshed = indicator.refreshStable({
			environmentTokens: 45,
			contextWindow: 2_000,
			profileName: "refreshed-profile",
			mode: "plan",
			updatedAt: 2,
		})
		const sending = indicator.beginSend({
			lineage: { kind: "ordinary", requestId: "request", requestSequence: 1, attemptId: "attempt" },
			durableContextTokens: 100,
			pendingSendTokens: 10,
			environmentTokens: 45,
			contextWindow: 2_000,
			profileName: "refreshed-profile",
			mode: "plan",
			updatedAt: 3,
		})
		const ignored = indicator.refreshStable({
			environmentTokens: 90,
			contextWindow: 4_000,
			profileName: "stale-profile",
			mode: "act",
			updatedAt: 4,
		})

		expect(refreshed).toMatchObject({
			phase: "stable",
			environmentTokens: 45,
			contextWindow: 2_000,
			profileName: "refreshed-profile",
			mode: "plan",
		})
		expect(ignored).toEqual(sending)
	})
})
