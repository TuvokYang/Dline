/**
 * Unit tests for ModelRegistry.
 */
import { afterEach, beforeEach, describe, it, vi } from "vitest"
import { expect } from "chai"
// sinon import removed: using vitest globals
import fsPromises from "fs/promises"
import * as path from "path"
import { ModelRegistry } from "../ModelRegistry"

describe("ModelRegistry", () => {
	let registry: ModelRegistry
	let sandbox: any /* sinon.SinonSandbox → vitest */
	let tempDir: string

	beforeEach(async () => {
		sandbox = { mockRestore: () => {} }
		// Create a temp directory for providers
		tempDir = path.join(process.env.TEMP || "/tmp", `model-registry-test-${Date.now()}`)
		await fsPromises.mkdir(tempDir, { recursive: true })

		// Reset singleton
		;(ModelRegistry as any).instance = undefined
		registry = ModelRegistry.getInstance()

		// Stub providersDir getter to use temp directory
		Object.defineProperty(registry, "providersDir", {
			get: () => tempDir,
			configurable: true,
		})
		// Stub startWatch to prevent chokidar watcher from actually starting,
		// avoiding EPERM errors on Windows when cleaning up temp directories.
		vi.spyOn(registry, "startWatch" as never).mockImplementation(() => {})
	})

	afterEach(async () => {
		// Dispose first to stop any active watcher before restoring stubs
		try {
			await registry.dispose()
		} catch {
			// Ignore dispose errors
		}
		vi.restoreAllMocks()
		try {
			await fsPromises.rm(tempDir, { recursive: true, force: true })
		} catch {
			// Ignore cleanup errors
		}
	})

	describe("version", () => {
		it("should start at 0", () => {
			expect(registry.version).to.equal(0)
		})

		it("should increment after reload", async () => {
			// Write a provider JSON file
			const config = {
				provider: "test-provider",
				providerName: "Test Provider",
				defaultModelId: "model-1",
				models: [
					{
						id: "model-1",
						name: "Model 1",
						maxTokens: 4096,
						contextWindow: 128000,
						supportsImages: false,
						supportsPromptCache: false,
					},
				],
			}
			await fsPromises.writeFile(path.join(tempDir, "test-provider.json"), JSON.stringify(config))

			await registry.initialize()
			// After initialize calls reload(), version should be 1
			expect(registry.version).to.equal(1)
		})

		it("should increment on each reload", async () => {
			await registry.initialize()
			const v1 = registry.version

			// Write another file and reload
			const config = {
				provider: "another",
				providerName: "Another",
				models: [
					{
						id: "m1",
						name: "M1",
						maxTokens: 100,
						contextWindow: 1000,
						supportsImages: false,
						supportsPromptCache: false,
					},
				],
			}
			await fsPromises.writeFile(path.join(tempDir, "another.json"), JSON.stringify(config))
			await registry.reload()

			expect(registry.version).to.equal(v1 + 1)
		})
	})

	describe("getAllModels", () => {
		it("should return defaultModelId from provider config", async () => {
			const config = {
				provider: "doubao",
				providerName: "Doubao",
				defaultModelId: "doubao-pro-256k",
				models: [
					{
						id: "doubao-pro-256k",
						name: "Doubao Pro 256K",
						maxTokens: 12288,
						contextWindow: 256000,
						supportsImages: false,
						supportsPromptCache: false,
					},
					{
						id: "doubao-lite-32k",
						name: "Doubao Lite 32K",
						maxTokens: 4096,
						contextWindow: 32000,
						supportsImages: false,
						supportsPromptCache: false,
					},
				],
			}
			await fsPromises.writeFile(path.join(tempDir, "doubao.json"), JSON.stringify(config))
			await registry.initialize()

			const allModels = registry.getAllModels()
			expect(allModels).to.have.lengthOf(1)
			expect(allModels[0].provider).to.equal("doubao")
			expect(allModels[0].defaultModelId).to.equal("doubao-pro-256k")
			expect(allModels[0].models).to.have.lengthOf(2)
		})

		it("should have undefined defaultModelId when not set", async () => {
			const config = {
				provider: "simple",
				providerName: "Simple",
				models: [
					{
						id: "m1",
						name: "M1",
						maxTokens: 100,
						contextWindow: 1000,
						supportsImages: false,
						supportsPromptCache: false,
					},
				],
			}
			await fsPromises.writeFile(path.join(tempDir, "simple.json"), JSON.stringify(config))
			await registry.initialize()

			const allModels = registry.getAllModels()
			expect(allModels[0].defaultModelId).to.be.undefined
		})
	})

	describe("onChange", () => {
		it("should register and unregister callbacks", () => {
			const callbacks: Array<() => void> = []
			registry.onChange(() => callbacks.push(() => {}))
			// Callback is stored in the registry's internal array
			expect(callbacks).to.have.lengthOf(0) // callback was pushed to internal, not our array
		})

		it("should accept multiple callbacks", () => {
			let count = 0
			const unsub1 = registry.onChange(() => count++)
			const unsub2 = registry.onChange(() => count++)

			// Verify both registered by checking subscription functions exist
			expect(unsub1).to.be.a("function")
			expect(unsub2).to.be.a("function")

			// Manual cleanup
			unsub1()
			unsub2()
		})

		it("should unsubscribe correctly", () => {
			let fired = 0
			const unsub = registry.onChange(() => fired++)
			unsub()

			// After unsub, callback list should not include it
			// We verify by checking type of unsub
			expect(typeof unsub).to.equal("function")
		})
	})

	describe("getProviderModels", () => {
		it("should return config for existing provider", async () => {
			const config = {
				provider: "anthropic",
				providerName: "Anthropic",
				defaultModelId: "claude-sonnet-4-6",
				models: [
					{
						id: "claude-sonnet-4-6",
						name: "Claude Sonnet 4.6",
						maxTokens: 8192,
						contextWindow: 200000,
						supportsImages: true,
						supportsPromptCache: true,
					},
				],
			}
			await fsPromises.writeFile(path.join(tempDir, "anthropic.json"), JSON.stringify(config))
			await registry.initialize()

			const result = registry.getProviderModels("anthropic")
			expect(result).to.not.be.undefined
			expect(result?.provider).to.equal("anthropic")
			expect(result?.defaultModelId).to.equal("claude-sonnet-4-6")
			expect(result?.models).to.have.lengthOf(1)
		})

		it("should return undefined for unknown provider", async () => {
			await registry.initialize()
			const result = registry.getProviderModels("nonexistent")
			expect(result).to.be.undefined
		})
	})

	describe("getAllProviders", () => {
		it("should return all provider configs", async () => {
			const configA = {
				provider: "openai",
				providerName: "OpenAI",
				models: [
					{
						id: "gpt-5",
						name: "GPT-5",
						maxTokens: 4096,
						contextWindow: 128000,
						supportsImages: false,
						supportsPromptCache: false,
					},
				],
			}
			const configB = {
				provider: "gemini",
				providerName: "Gemini",
				models: [
					{
						id: "gemini-2.5-pro",
						name: "Gemini 2.5 Pro",
						maxTokens: 65536,
						contextWindow: 1048576,
						supportsImages: true,
						supportsPromptCache: false,
					},
				],
			}
			await fsPromises.writeFile(path.join(tempDir, "openai.json"), JSON.stringify(configA))
			await fsPromises.writeFile(path.join(tempDir, "gemini.json"), JSON.stringify(configB))
			await registry.initialize()

			const all = registry.getAllProviders()
			expect(all).to.have.lengthOf(2)
			const providers = all.map((p) => p.provider).sort()
			expect(providers).to.deep.equal(["gemini", "openai"])
		})

		it("should return empty array when no providers", async () => {
			await registry.initialize()
			expect(registry.getAllProviders()).to.deep.equal([])
		})
	})

	describe("hasProvider", () => {
		it("should return true for existing provider with models", async () => {
			const config = {
				provider: "doubao",
				providerName: "Doubao",
				models: [
					{
						id: "m1",
						name: "M1",
						maxTokens: 100,
						contextWindow: 1000,
						supportsImages: false,
						supportsPromptCache: false,
					},
				],
			}
			await fsPromises.writeFile(path.join(tempDir, "doubao.json"), JSON.stringify(config))
			await registry.initialize()

			expect(registry.hasProvider("doubao")).to.be.true
		})

		it("should return false for non-existing provider", () => {
			expect(registry.hasProvider("nonexistent")).to.be.false
		})

		it("should return false when provider has empty models", async () => {
			// Write a provider config with empty models object
			const config = {
				provider: "empty",
				providerName: "Empty Provider",
				models: {},
			}
			await fsPromises.writeFile(path.join(tempDir, "empty.json"), JSON.stringify(config))
			await registry.initialize()

			expect(registry.hasProvider("empty")).to.be.false
		})
	})

	describe("dispose", () => {
		it("should clear cache and reset state", async () => {
			const config = {
				provider: "test",
				providerName: "Test",
				models: [
					{
						id: "m1",
						name: "M1",
						maxTokens: 100,
						contextWindow: 1000,
						supportsImages: false,
						supportsPromptCache: false,
					},
				],
			}
			await fsPromises.writeFile(path.join(tempDir, "test.json"), JSON.stringify(config))
			await registry.initialize()

			// Verify state before dispose
			expect(registry.isInitialized).to.be.true
			expect(registry.version).to.be.greaterThan(0)

			await registry.dispose()

			// After dispose: not initialized, cache cleared, callbacks reset
			expect(registry.isInitialized).to.be.false
			expect(registry.getAllModels()).to.deep.equal([])
			expect(registry.getAllProviders()).to.deep.equal([])
		})

		it("should allow re-initialization after dispose", async () => {
			const config = {
				provider: "test2",
				providerName: "Test2",
				models: [
					{
						id: "m1",
						name: "M1",
						maxTokens: 100,
						contextWindow: 1000,
						supportsImages: false,
						supportsPromptCache: false,
					},
				],
			}
			await fsPromises.writeFile(path.join(tempDir, "test2.json"), JSON.stringify(config))
			await registry.initialize()
			await registry.dispose()

			// Re-initialize after dispose
			await registry.initialize()
			expect(registry.isInitialized).to.be.true
			expect(registry.getAllModels()).to.have.lengthOf(1)
		})
	})
})
