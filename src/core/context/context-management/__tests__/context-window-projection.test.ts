import { describe, expect, it } from "vitest"
import { estimateContextWindowCandidate, resolveContextWindowProjection } from "../context-window-projection"

describe("context window projection", () => {
	it("keeps the latest reliable provider usage and accumulates only uncovered positive estimate growth", () => {
		const projection = resolveContextWindowProjection({
			requestInfos: [
				{ contextTokens: 110_000, estimatedContextTokens: 100_000, contextTokensSource: "provider" },
				{ estimatedContextTokens: 120_000, contextTokensSource: "estimate", cancelReason: "streaming_failed" },
				{ estimatedContextTokens: 125_000, contextTokensSource: "estimate" },
			],
			candidateEstimatedTokens: 130_000,
			candidateDeltaTokens: 5_000,
			contextWindow: 272_000,
			triggerTokens: 261_340,
		})

		expect(projection).toMatchObject({
			baselineTokens: 110_000,
			pendingDeltaTokens: 25_000,
			candidateDeltaTokens: 5_000,
			projectedUsageTokens: 140_000,
			pressureSource: "provider",
			shouldCompact: false,
		})
	})

	it("replaces the baseline and clears covered pending growth when new reliable usage arrives", () => {
		const projection = resolveContextWindowProjection({
			requestInfos: [
				{ contextTokens: 100_000, estimatedContextTokens: 90_000, contextTokensSource: "provider" },
				{ estimatedContextTokens: 110_000, contextTokensSource: "estimate" },
				{ contextTokens: 120_000, estimatedContextTokens: 115_000, contextTokensSource: "provider" },
			],
			candidateEstimatedTokens: 120_000,
			candidateDeltaTokens: 5_000,
			contextWindow: 272_000,
			triggerTokens: 261_340,
		})

		expect(projection).toMatchObject({
			baselineTokens: 120_000,
			pendingDeltaTokens: 0,
			candidateDeltaTokens: 5_000,
			projectedUsageTokens: 125_000,
			pressureSource: "provider",
		})
	})

	it("uses absolute estimates without pretending they are provider usage when no reliable usage exists", () => {
		const projection = resolveContextWindowProjection({
			requestInfos: [{ estimatedContextTokens: 50_000, contextTokensSource: "estimate" }],
			candidateEstimatedTokens: 55_000,
			candidateDeltaTokens: 5_000,
			contextWindow: 128_000,
			triggerTokens: 120_500,
		})

		expect(projection).toMatchObject({
			baselineTokens: 50_000,
			pendingDeltaTokens: 0,
			candidateDeltaTokens: 5_000,
			projectedUsageTokens: 55_000,
			pressureSource: "estimate",
		})
	})

	it("uses the larger complete candidate when Provider usage has no comparable estimate anchor", () => {
		const projection = resolveContextWindowProjection({
			requestInfos: [{ contextTokens: 217_409, contextTokensSource: "provider" }],
			candidateEstimatedTokens: 570_000,
			contextWindow: 572_000,
			triggerTokens: 572_000,
		})

		expect(projection).toMatchObject({
			baselineTokens: 217_409,
			pendingDeltaTokens: 0,
			candidateDeltaTokens: 352_591,
			projectedUsageTokens: 570_000,
			pressureSource: "provider",
			shouldCompact: true,
		})
	})

	it("fails closed to the complete candidate when Provider usage has no local estimate anchor", () => {
		const projection = resolveContextWindowProjection({
			requestInfos: [{ contextTokens: 135_000, contextTokensSource: "provider" }],
			candidateEstimatedTokens: 382_000,
			contextWindow: 372_000,
			triggerTokens: 360_000,
		})

		expect(projection).toMatchObject({
			baselineTokens: 135_000,
			candidateDeltaTokens: 247_000,
			projectedUsageTokens: 382_000,
			pressureSource: "provider",
			shouldCompact: true,
		})
	})

	it("does not let a smaller reconstructed candidate erase reliable provider occupancy", () => {
		const projection = resolveContextWindowProjection({
			requestInfos: [{ contextTokens: 140_100, estimatedContextTokens: 16_083, contextTokensSource: "provider" }],
			candidateEstimatedTokens: 16_083,
			contextWindow: 131_072,
			triggerTokens: 131_072,
		})

		expect(projection).toMatchObject({
			baselineTokens: 140_100,
			candidateDeltaTokens: 0,
			projectedUsageTokens: 140_100,
			pressureSource: "provider",
			shouldCompact: true,
		})
	})

	it("applies the shared 2K tolerance to the complete projected candidate", () => {
		const projection = resolveContextWindowProjection({
			requestInfos: [],
			candidateEstimatedTokens: 259_340,
			candidateDeltaTokens: 259_340,
			contextWindow: 272_000,
			triggerTokens: 261_340,
		})

		expect(projection.shouldCompact).toBe(true)
		expect(projection.remainingTokens).toBe(12_660)
		expect(projection.remainingRatio).toBeCloseTo(12_660 / 272_000)
	})

	it("crosses the 472k admission boundary when a 442.7k provider baseline gains the current candidate", () => {
		const projection = resolveContextWindowProjection({
			requestInfos: [{ contextTokens: 442_700, estimatedContextTokens: 442_700, contextTokensSource: "provider" }],
			candidateEstimatedTokens: 443_200,
			contextWindow: 472_000,
			triggerTokens: 444_900,
		})

		expect(projection).toMatchObject({
			baselineTokens: 442_700,
			candidateDeltaTokens: 500,
			projectedUsageTokens: 443_200,
			shouldCompact: true,
		})
	})

	it("estimates the complete provider candidate including system prompt, tools, server tools, and messages", () => {
		const small = estimateContextWindowCandidate({
			systemPrompt: "system",
			messages: [{ role: "user", content: "short" }],
			tools: [{ name: "read_file" }],
			serverTools: [{ type: "web_search" }],
		})
		const large = estimateContextWindowCandidate({
			systemPrompt: "system".repeat(100),
			messages: [{ role: "user", content: "large".repeat(1_000) }],
			tools: [{ name: "read_file" }, { name: "execute_command" }],
			serverTools: [{ type: "web_search" }],
		})

		expect(small).toBeGreaterThan(0)
		expect(large).toBeGreaterThan(small)
	})

	it("does not treat an unsent base64 image payload as ordinary text pressure", () => {
		const text = "x".repeat(960_000)
		const previousCandidate = {
			systemPrompt: "system",
			messages: [{ role: "user", content: [{ type: "text", text }] }],
		}
		const previousEstimate = estimateContextWindowCandidate(previousCandidate)
		const onePixelPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z8WQAAAAASUVORK5CYII="
		const candidate = {
			...previousCandidate,
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text },
						{
							type: "image",
							source: { type: "base64", media_type: "image/png", data: `${onePixelPng}${"A".repeat(900_000)}` },
						},
					],
				},
			],
		}
		const conservativeEstimate = estimateContextWindowCandidate(candidate)
		const candidateEstimate = estimateContextWindowCandidate(candidate, { providerId: "openai", modelId: "gpt-5.6-sol" })
		const projection = resolveContextWindowProjection({
			requestInfos: [
				{
					contextTokens: 240_000,
					estimatedContextTokens: previousEstimate,
					contextTokensSource: "provider",
				},
			],
			candidateEstimatedTokens: candidateEstimate,
			contextWindow: 472_000,
			triggerTokens: 446_400,
		})

		expect(previousEstimate).toBeGreaterThan(200_000)
		expect(conservativeEstimate - previousEstimate).toBeGreaterThan(200_000)
		expect(candidateEstimate - previousEstimate).toBeLessThan(10_000)
		expect(projection.candidateDeltaTokens).toBeLessThan(10_000)
		expect(projection.shouldCompact).toBe(false)
	})
})
