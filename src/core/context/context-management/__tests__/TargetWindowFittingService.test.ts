import { describe, expect, it } from "vitest"
import { decideTargetWindowFitting } from "../TargetWindowFittingService"

describe("target window fitting decision", () => {
	it("continues at the strict 80 percent boundary when another complete turn remains", () => {
		expect(
			decideTargetWindowFitting({
				candidateEstimatedTokens: 217_600,
				providerContextWindow: 1_000_000,
				maxContextTokens: 272_000,
				hasMoreTurns: true,
			}),
		).toEqual({
			status: "continue",
			projectedUsageTokens: 217_600,
			targetContextWindow: 272_000,
			fittingExitTarget: 217_600,
		})
	})

	it("completes only when the complete target candidate is strictly below the exit target", () => {
		expect(
			decideTargetWindowFitting({
				candidateEstimatedTokens: 217_599,
				providerContextWindow: 1_000_000,
				maxContextTokens: 272_000,
				hasMoreTurns: true,
			}),
		).toEqual({
			status: "complete",
			projectedUsageTokens: 217_599,
			targetContextWindow: 272_000,
			fittingExitTarget: 217_600,
		})
	})

	it("fails without admitting the ordinary continuation when no complete turn remains to reduce pressure", () => {
		expect(
			decideTargetWindowFitting({
				candidateEstimatedTokens: 217_600,
				providerContextWindow: 1_000_000,
				maxContextTokens: 272_000,
				hasMoreTurns: false,
			}),
		).toEqual({
			status: "exhausted",
			projectedUsageTokens: 217_600,
			targetContextWindow: 272_000,
			fittingExitTarget: 217_600,
		})
	})
})
