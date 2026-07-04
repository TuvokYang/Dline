/**
 * Unit tests for seed-initializer.
 */

import type { ProviderModelsConfig } from "@shared/providers/types"
import { expect } from "chai"
// sinon import removed: using vitest globals
import fs from "fs"
import fsPromises from "fs/promises"
import * as path from "path"
import { afterEach, beforeEach, describe, it, vi } from "vitest"

// Mock provider data for testing seed initialization
const mockAllProviderModels = vi.hoisted(
	(): Record<string, ProviderModelsConfig> => ({
		"test-provider": {
			provider: "test-provider",
			providerName: "Test Provider",
			billingMode: "token",
			defaultModelId: "test-model-1",
			models: {
				"test-model-1": {
					id: "test-model-1",
					name: "Test Model 1",
					capabilities: { maxTokens: 4096, contextWindow: 128000, supportsImages: false, supportsPromptCache: false },
				},
			},
		},
		"provider-with-optional": {
			provider: "provider-with-optional",
			providerName: "Optional Provider",
			billingMode: "token",
			models: {
				"opt-model": {
					id: "opt-model",
					name: "Optional Model",
					capabilities: {
						maxTokens: 8192,
						contextWindow: 200000,
						supportsImages: true,
						supportsPromptCache: true,
						supportsReasoning: true,
					},
					pricing: { inputPrice: 3.0, outputPrice: 15.0, currency: "USD" },
					description: "A test model with optional fields",
				},
			},
		},
	}),
)

vi.mock("@shared/providers/model-infos", () => ({
	allProviderModels: mockAllProviderModels,
}))

import { ensureSeedProviders } from "../seed-initializer"

describe("seed-initializer", () => {
	let sandbox: any /* sinon.SinonSandbox → vitest */
	let tempDir: string
	let writeFileStub: any /* sinon.SinonStub → vitest */

	beforeEach(async () => {
		sandbox = { mockRestore: () => {} }
		tempDir = path.join(process.env.TEMP || "/tmp", `seed-init-test-${Date.now()}`)
		await fsPromises.mkdir(tempDir, { recursive: true })
		// Stub fsPromises.mkdir so the function doesn't fail on existing dir
		vi.spyOn(fsPromises, "mkdir" as "mkdir").mockResolvedValue(void 0)
		// Stub writeFile to intercept and verify written content
		writeFileStub = vi.spyOn(fsPromises, "writeFile").mockResolvedValue()
	})

	afterEach(async () => {
		vi.restoreAllMocks()
		try {
			await fsPromises.rm(tempDir, { recursive: true, force: true })
		} catch {
			// Ignore cleanup errors
		}
	})

	it("should create JSON for missing providers", async () => {
		// All files are missing
		vi.spyOn(fs, "existsSync").mockReturnValue(false)

		const created = await ensureSeedProviders(tempDir)

		expect(created).to.equal(2)
		expect(writeFileStub.mock.calls.length).to.equal(2)
	})

	it("should skip existing JSON files", async () => {
		// Only test-provider.json exists; provider-with-optional should be created
		const existsStub = vi.spyOn(fs, "existsSync")
		existsStub.mockImplementation((filePath: fs.PathLike) => {
			const p = filePath.toString()
			return p === path.join(tempDir, "test-provider.json")
		})

		const created = await ensureSeedProviders(tempDir)

		expect(created).to.equal(1)
		expect(writeFileStub.mock.calls.length).to.equal(1)
		// The created file should be for the missing provider
		const writtenPaths = writeFileStub.mock.calls.map((call: unknown[]) => call[0] as string)
		expect(writtenPaths.every((p: string) => p.includes("provider-with-optional"))).to.be.true
	})

	it("should serialize defaultModelId in JSON output", async () => {
		vi.spyOn(fs, "existsSync").mockReturnValue(false)

		await ensureSeedProviders(tempDir)

		// Find the write call for test-provider which has defaultModelId
		const writeCalls = writeFileStub.mock.calls
		const testProviderCall = writeCalls.find((call: unknown[]) => (call[0] as string).includes("test-provider"))
		expect(testProviderCall).to.not.be.undefined

		const jsonContent = testProviderCall?.[1] as string
		const parsed = JSON.parse(jsonContent)
		expect(parsed.defaultModelId).to.equal("test-model-1")
		expect(parsed.provider).to.equal("test-provider")
		expect(parsed.providerName).to.equal("Test Provider")
		expect(parsed.models).to.be.an("array").with.lengthOf(1)
		expect(parsed.models[0].id).to.equal("test-model-1")
	})

	it("should strip undefined fields from JSON output", async () => {
		vi.spyOn(fs, "existsSync").mockReturnValue(false)

		await ensureSeedProviders(tempDir)

		// Find the write call for provider-with-optional which has optional fields
		const writeCalls = writeFileStub.mock.calls
		const optionalCall = writeCalls.find((call: unknown[]) => (call[0] as string).includes("provider-with-optional"))
		expect(optionalCall).to.not.be.undefined

		const jsonContent = optionalCall?.[1] as string
		const parsed = JSON.parse(jsonContent)
		const model = parsed.models[0]

		// Present fields should exist
		expect(model.id).to.equal("opt-model")
		expect(model.description).to.equal("A test model with optional fields")
		expect(model.currency).to.equal("USD")
		expect(model.supportsReasoning).to.be.true
		expect(model.inputPrice).to.equal(3.0)
		expect(model.outputPrice).to.equal(15.0)

		// Undefined fields must not appear in the JSON
		expect("temperature" in model).to.be.false
		expect("cacheWritesPrice" in model).to.be.false
		expect("cacheReadsPrice" in model).to.be.false
		expect("supportsGlobalEndpoint" in model).to.be.false
		expect("apiFormat" in model).to.be.false
		expect("tiers" in model).to.be.false
	})
})
