import * as disk from "@core/storage/disk"
import axios from "axios"
import { expect } from "chai"
import fs from "fs/promises"
import { afterEach, beforeEach, describe, it, vi } from "vitest"
// sinon import removed: using vitest globals
import { ClineEnv, Environment } from "@/config"
import { getFeatureFlagsService } from "@/services/feature-flags"
import { CLINE_RECOMMENDED_MODELS_FALLBACK } from "@/shared/cline/recommended-models"
import { FeatureFlag } from "@/shared/services/feature-flags/feature-flags"
import { Logger } from "@/shared/services/Logger"
import { refreshClineRecommendedModels, resetClineRecommendedModelsCacheForTests } from "../refreshClineRecommendedModels"

describe("refreshClineRecommendedModels", () => {
	let sandbox: any /* sinon.SinonSandbox → vitest */

	beforeEach(() => {
		sandbox = { mockRestore: () => {} }
		resetClineRecommendedModelsCacheForTests()
		vi.spyOn(Logger, "log")
		vi.spyOn(Logger, "error")
	})

	afterEach(() => {
		resetClineRecommendedModelsCacheForTests()
		vi.restoreAllMocks()
	})

	it("returns hardcoded models and skips upstream fetch when rollout flag is off", async () => {
		vi.spyOn(getFeatureFlagsService(), "getBooleanFlagEnabled").mockReturnValue(false)
		const axiosGetStub = vi.spyOn(axios, "get")

		const result = await refreshClineRecommendedModels()

		expect(result).to.deep.equal(CLINE_RECOMMENDED_MODELS_FALLBACK)
		expect(axiosGetStub.mock.calls.length > 0).to.equal(false)
	})

	it("fetches from upstream when rollout flag is on", async () => {
		vi.spyOn(getFeatureFlagsService(), "getBooleanFlagEnabled").mockImplementation((flag: FeatureFlag) => {
			return flag === FeatureFlag.CLINE_RECOMMENDED_MODELS_UPSTREAM
		})
		vi.spyOn(ClineEnv, "config").mockReturnValue({
			environment: Environment.production,
			appBaseUrl: "https://app.cline-mock.bot",
			apiBaseUrl: "https://api.cline-mock.bot",
			mcpBaseUrl: "https://api.cline-mock.bot/v1/mcp",
		})
		vi.spyOn(disk, "ensureCacheDirectoryExists").mockResolvedValue("/tmp")
		vi.spyOn(fs, "writeFile").mockResolvedValue()
		const axiosGetStub = vi.spyOn(axios, "get").mockResolvedValue({
			data: {
				recommended: [{ id: "anthropic/claude-sonnet-4.6", description: "Remote recommended", tags: ["NEW"] }],
				free: [{ id: "z-ai/glm-5", description: "Remote free" }],
			},
		})

		const result = await refreshClineRecommendedModels()

		expect(axiosGetStub.mock.calls.length === 1).to.equal(true)
		expect(result).to.deep.equal({
			recommended: [
				{
					id: "anthropic/claude-sonnet-4.6",
					name: "anthropic/claude-sonnet-4.6",
					description: "Remote recommended",
					tags: ["NEW"],
				},
			],
			free: [
				{
					id: "z-ai/glm-5",
					name: "z-ai/glm-5",
					description: "Remote free",
					tags: [],
				},
			],
		})
	})

	it("uses hardcoded models when rollout flag is turned off after upstream cache is populated", async () => {
		const flagStub = vi.spyOn(getFeatureFlagsService(), "getBooleanFlagEnabled")
		flagStub.mockReturnValueOnce(true)
		flagStub.mockReturnValueOnce(false)
		vi.spyOn(ClineEnv, "config").mockReturnValue({
			environment: Environment.production,
			appBaseUrl: "https://app.cline-mock.bot",
			apiBaseUrl: "https://api.cline-mock.bot",
			mcpBaseUrl: "https://api.cline-mock.bot/v1/mcp",
		})
		vi.spyOn(disk, "ensureCacheDirectoryExists").mockResolvedValue("/tmp")
		vi.spyOn(fs, "writeFile").mockResolvedValue()
		const axiosGetStub = vi.spyOn(axios, "get").mockResolvedValue({
			data: {
				recommended: [{ id: "google/gemini-3.1-pro-preview", description: "Remote recommended", tags: ["NEW"] }],
				free: [{ id: "minimax/minimax-m2.5", description: "Remote free", tags: ["FREE"] }],
			},
		})

		const firstResult = await refreshClineRecommendedModels()
		const secondResult = await refreshClineRecommendedModels()

		expect(axiosGetStub.mock.calls.length === 1).to.equal(true)
		expect(firstResult).to.not.deep.equal(CLINE_RECOMMENDED_MODELS_FALLBACK)
		expect(secondResult).to.deep.equal(CLINE_RECOMMENDED_MODELS_FALLBACK)
	})
})
