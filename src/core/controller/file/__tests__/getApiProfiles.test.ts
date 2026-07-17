import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ModelRegistry } from "@core/model-registry/ModelRegistry"
import { getAllApiKeys, resetAllStores } from "@core/storage/secrets"
import { EmptyRequest } from "@shared/proto/dline/common"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it, vi } from "vitest"
import { getApiProfiles } from "../getApiProfiles"
import { updateApiProfiles } from "../updateApiProfiles"

describe("getApiProfiles", () => {
	let tempDir: string
	let originalDlineHomeDir: string | undefined
	let originalDlineDir: string | undefined

	beforeEach(async () => {
		originalDlineHomeDir = process.env.DLINE_HOME_DIR
		originalDlineDir = process.env.DLINE_DIR
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dline-api-profiles-"))
		process.env.DLINE_HOME_DIR = path.join(tempDir, "home")
		process.env.DLINE_DIR = path.join(tempDir, "state")
		;(ModelRegistry as any).instance = undefined
		resetAllStores()
	})

	afterEach(async () => {
		if (originalDlineHomeDir === undefined) {
			delete process.env.DLINE_HOME_DIR
		} else {
			process.env.DLINE_HOME_DIR = originalDlineHomeDir
		}
		if (originalDlineDir === undefined) {
			delete process.env.DLINE_DIR
		} else {
			process.env.DLINE_DIR = originalDlineDir
		}
		resetAllStores()
		;(ModelRegistry as any).instance = undefined
		await fs.rm(tempDir, { recursive: true, force: true })
		vi.restoreAllMocks()
	})

	it("hydrates migrated provider profiles with apiKey in the returned list without storing it in api_profiles.json", async () => {
		const providersDir = path.join(process.env.DLINE_HOME_DIR!, "providers")
		await fs.mkdir(providersDir, { recursive: true })
		await fs.writeFile(
			path.join(providersDir, "anthropic.json"),
			JSON.stringify({
				provider: "anthropic",
				defaultModelId: "claude-3-5-sonnet",
				models: {
					"claude-3-5-sonnet": {},
				},
			}),
			"utf8",
		)

		const controller = {
			stateManager: {
				getApiConfiguration: () => ({}),
				getSecretKey: (key: string) => (key === "apiKey" ? "sk-ant-test" : undefined),
				setGlobalState: vi.fn(),
				flushPendingState: vi.fn().mockResolvedValue(undefined),
			},
			postStateToWebview: vi.fn(),
		} as any

		const response = await getApiProfiles(controller, EmptyRequest.create({}))

		expect(response.profiles).to.have.length(1)
		expect(response.profiles[0].provider).to.equal("anthropic")
		expect(response.profiles[0].apiKey).to.equal("sk-ant-test")
		expect(response.profiles[0].enabled).to.equal(true)
		expect(response.profiles[0].usedFor).to.deep.equal(["act", "plan", "subagents"])

		const storedProfilesPath = path.join(process.env.DLINE_DIR!, "data", "settings", "api_profiles.json")
		const storedProfiles = JSON.parse(await fs.readFile(storedProfilesPath, "utf8"))
		expect(storedProfiles[0]).not.to.have.property("apiKey")
		expect(storedProfiles[0]).not.to.have.property("api_key")

		const keyEntries = Object.values(getAllApiKeys())
		expect(keyEntries).to.have.length(1)
		expect(keyEntries[0].apiKey).to.equal("sk-ant-test")
	})

	it("hydrates official modelInfo from providers json and strips stored profile snapshots", async () => {
		const providersDir = path.join(process.env.DLINE_HOME_DIR!, "providers")
		const settingsDir = path.join(process.env.DLINE_DIR!, "data", "settings")
		const storedProfilesPath = path.join(settingsDir, "api_profiles.json")
		await fs.mkdir(providersDir, { recursive: true })
		await fs.mkdir(settingsDir, { recursive: true })
		await fs.writeFile(
			path.join(providersDir, "deepseek.json"),
			JSON.stringify({
				provider: "deepseek",
				providerName: "DeepSeek",
				billingMode: "token",
				defaultModelId: "deepseek-v4-pro",
				models: {
					"deepseek-v4-pro": {
						id: "deepseek-v4-pro",
						capabilities: {
							contextWindow: 272_000,
							maxTokens: 128_000,
							supportsImages: false,
							supportsPromptCache: true,
						},
						pricing: {
							inputPrice: 1,
							outputPrice: 2,
						},
					},
				},
			}),
			"utf8",
		)
		await fs.writeFile(
			storedProfilesPath,
			JSON.stringify(
				[
					{
						id: "deepseek-profile",
						name: "deepseek:deepseek-v4-pro",
						provider: "deepseek",
						modelId: "deepseek-v4-pro",
						usedFor: ["act", "plan"],
						enabled: true,
						modelInfo: {
							id: "deepseek-v4-pro",
							capabilities: {
								contextWindow: 1_000_000,
								maxTokens: 64_000,
							},
						},
					},
				],
				null,
				"\t",
			),
			"utf8",
		)

		const controller = {
			stateManager: {
				getApiConfiguration: () => ({}),
				setGlobalState: vi.fn(),
				flushPendingState: vi.fn().mockResolvedValue(undefined),
			},
			postStateToWebview: vi.fn(),
		} as any

		const response = await getApiProfiles(controller, EmptyRequest.create({}))

		expect(response.profiles).to.have.length(1)
		// Non-override providers (deepseek, anthropic, etc.) no longer
		// hydrate modelInfo from the registry — stale top-level modelInfo
		// is cleared to prevent a read-merge-strip loop.
		expect(response.profiles[0].modelInfo).to.be.undefined

		const storedProfiles = JSON.parse(await fs.readFile(storedProfilesPath, "utf8"))
		expect(storedProfiles[0]).not.to.have.property("modelInfo")
	})

	it("stores only editable modelInfo overrides for registry-backed configurable profiles", async () => {
		const providersDir = path.join(process.env.DLINE_HOME_DIR!, "providers")
		const settingsDir = path.join(process.env.DLINE_DIR!, "data", "settings")
		const storedProfilesPath = path.join(settingsDir, "api_profiles.json")
		await fs.mkdir(providersDir, { recursive: true })
		await fs.mkdir(settingsDir, { recursive: true })
		await fs.writeFile(
			path.join(providersDir, "openai.json"),
			JSON.stringify({
				provider: "openai",
				providerName: "OpenAI Compatible",
				billingMode: "token",
				defaultModelId: "gpt-compatible",
				models: {
					"gpt-compatible": {
						id: "gpt-compatible",
						capabilities: {
							contextWindow: 128_000,
							maxTokens: 8_192,
							supportsImages: false,
							supportsPromptCache: true,
						},
						pricing: {
							inputPrice: 1,
							outputPrice: 2,
							currency: "USD",
						},
					},
				},
			}),
			"utf8",
		)
		await fs.writeFile(
			storedProfilesPath,
			JSON.stringify(
				[
					{
						id: "openai-profile",
						name: "openai:gpt-compatible",
						provider: "openai",
						modelId: "gpt-compatible",
						usedFor: ["act", "plan"],
						enabled: true,
						modelInfo: {
							id: "gpt-compatible",
							capabilities: {
								contextWindow: 256_000,
							},
							pricing: {
								inputPrice: 1,
								outputPrice: 3,
							},
						},
					},
				],
				null,
				"\t",
			),
			"utf8",
		)

		const controller = {
			stateManager: {
				getApiConfiguration: () => ({}),
				setGlobalState: vi.fn(),
				flushPendingState: vi.fn().mockResolvedValue(undefined),
			},
			postStateToWebview: vi.fn(),
		} as any

		const response = await getApiProfiles(controller, EmptyRequest.create({}))

		expect(response.profiles[0].modelInfo?.capabilities?.contextWindow).to.equal(256_000)
		expect(response.profiles[0].modelInfo?.capabilities?.maxTokens).to.equal(8_192)
		expect(response.profiles[0].modelInfo?.capabilities?.supportsPromptCache).to.equal(true)
		expect(response.profiles[0].modelInfo?.pricing?.inputPrice).to.equal(1)
		expect(response.profiles[0].modelInfo?.pricing?.outputPrice).to.equal(3)

		const storedProfiles = JSON.parse(await fs.readFile(storedProfilesPath, "utf8"))
		expect(storedProfiles[0].modelInfo).to.deep.equal({
			id: "gpt-compatible",
			capabilities: {
				contextWindow: 256_000,
			},
			pricing: {
				outputPrice: 3,
			},
		})
	})

	it("keeps modelInfo for user-configurable OpenAI compatible profiles", async () => {
		const settingsDir = path.join(process.env.DLINE_DIR!, "data", "settings")
		const storedProfilesPath = path.join(settingsDir, "api_profiles.json")
		await fs.mkdir(settingsDir, { recursive: true })
		await fs.writeFile(
			storedProfilesPath,
			JSON.stringify(
				[
					{
						id: "openai-compatible-profile",
						name: "openai:custom-model",
						provider: "openai",
						modelId: "custom-model",
						usedFor: ["act", "plan"],
						enabled: true,
						modelInfo: {
							id: "custom-model",
							capabilities: {
								contextWindow: 64_000,
								maxTokens: 8_192,
							},
						},
					},
				],
				null,
				"\t",
			),
			"utf8",
		)

		const controller = {
			stateManager: {
				getApiConfiguration: () => ({}),
				setGlobalState: vi.fn(),
				flushPendingState: vi.fn().mockResolvedValue(undefined),
			},
			postStateToWebview: vi.fn(),
		} as any

		const response = await getApiProfiles(controller, EmptyRequest.create({}))

		expect(response.profiles[0].modelInfo?.capabilities?.contextWindow).to.equal(64_000)
		const storedProfiles = JSON.parse(await fs.readFile(storedProfilesPath, "utf8"))
		expect(storedProfiles[0]).to.have.property("modelInfo")
	})

	it("keeps modelInfo for custom Anthropic profiles", async () => {
		const providersDir = path.join(process.env.DLINE_HOME_DIR!, "providers")
		const settingsDir = path.join(process.env.DLINE_DIR!, "data", "settings")
		const storedProfilesPath = path.join(settingsDir, "api_profiles.json")
		await fs.mkdir(providersDir, { recursive: true })
		await fs.mkdir(settingsDir, { recursive: true })
		await fs.writeFile(
			path.join(providersDir, "anthropic.json"),
			JSON.stringify({
				provider: "anthropic",
				providerName: "Anthropic",
				billingMode: "token",
				defaultModelId: "claude-sonnet-4-6",
				models: {
					"claude-sonnet-4-6": {
						id: "claude-sonnet-4-6",
						capabilities: {
							contextWindow: 200_000,
							maxTokens: 64_000,
						},
					},
				},
			}),
			"utf8",
		)
		await fs.writeFile(
			storedProfilesPath,
			JSON.stringify(
				[
					{
						id: "anthropic-custom-profile",
						name: "anthropic:internal-claude",
						provider: "anthropic",
						modelId: "internal-claude",
						usedFor: ["act", "plan"],
						enabled: true,
						modelInfo: {
							id: "internal-claude",
							capabilities: {
								contextWindow: 96_000,
								maxTokens: 16_384,
							},
						},
					},
				],
				null,
				"\t",
			),
			"utf8",
		)

		const controller = {
			stateManager: {
				getApiConfiguration: () => ({}),
				setGlobalState: vi.fn(),
				flushPendingState: vi.fn().mockResolvedValue(undefined),
			},
			postStateToWebview: vi.fn(),
		} as any

		const response = await getApiProfiles(controller, EmptyRequest.create({}))

		expect(response.profiles[0].modelInfo?.capabilities?.contextWindow).to.equal(96_000)
		const storedProfiles = JSON.parse(await fs.readFile(storedProfilesPath, "utf8"))
		expect(storedProfiles[0]).to.have.property("modelInfo")
	})

	it("keeps api_profiles.json valid when delete/update writes are issued back to back", async () => {
		const largeProfiles = Array.from({ length: 40 }, (_, index) => ({
			id: `profile-${index}`,
			name: `deepseek:model-${index}`,
			provider: "deepseek",
			modelId: `model-${index}`,
			usedFor: ["act", "plan"],
			enabled: true,
			modelInfo: {
				id: `model-${index}`,
				name: `model-${index}`,
				description: "x".repeat(2000),
				pricing: {
					inputPrice: index,
					outputPrice: index + 1,
				},
			},
		}))
		const finalProfiles = [
			{
				id: "final-profile",
				name: "openai-native:gpt-5.5",
				provider: "openai-native",
				modelId: "gpt-5.5",
				usedFor: ["act", "plan"],
				enabled: true,
			},
		]

		const controller = {} as any
		const firstWrite = updateApiProfiles(controller, { profiles: largeProfiles } as any)
		const deleteWrite = updateApiProfiles(controller, { profiles: finalProfiles } as any)

		await Promise.all([firstWrite, deleteWrite])

		const storedProfilesPath = path.join(process.env.DLINE_DIR!, "data", "settings", "api_profiles.json")
		const raw = await fs.readFile(storedProfilesPath, "utf8")
		const storedProfiles = JSON.parse(raw)

		expect(storedProfiles).to.have.length(1)
		expect(storedProfiles[0].id).to.equal("final-profile")
		expect(raw).not.to.include("profile-39")
	})

	it("persists the provider registry default when a profile modelId is blank", async () => {
		const providersDir = path.join(process.env.DLINE_HOME_DIR!, "providers")
		const settingsDir = path.join(process.env.DLINE_DIR!, "data", "settings")
		const storedProfilesPath = path.join(settingsDir, "api_profiles.json")
		await fs.mkdir(providersDir, { recursive: true })
		await fs.mkdir(settingsDir, { recursive: true })
		await fs.writeFile(
			path.join(providersDir, "openai-native.json"),
			JSON.stringify({
				provider: "openai-native",
				defaultModelId: "registry-default-model",
				models: { "registry-default-model": { id: "registry-default-model" } },
			}),
			"utf8",
		)
		await fs.writeFile(
			storedProfilesPath,
			JSON.stringify([
				{
					id: "default-profile",
					name: "openai-native profile",
					provider: "openai-native",
					modelId: "",
					usedFor: ["act", "plan"],
					enabled: true,
				},
			]),
			"utf8",
		)

		const controller = {
			stateManager: {
				getApiConfiguration: () => ({}),
				setGlobalState: vi.fn(),
				flushPendingState: vi.fn().mockResolvedValue(undefined),
			},
			postStateToWebview: vi.fn(),
		} as any

		const response = await getApiProfiles(controller, EmptyRequest.create({}))

		expect(response.profiles[0].modelId).to.equal("registry-default-model")
		const storedProfiles = JSON.parse(await fs.readFile(storedProfilesPath, "utf8"))
		expect(storedProfiles[0].modelId).to.equal("registry-default-model")
	})

	it("rejects an unreadable profile file instead of returning an empty list", async () => {
		const settingsDir = path.join(process.env.DLINE_DIR!, "data", "settings")
		await fs.mkdir(settingsDir, { recursive: true })
		await fs.writeFile(path.join(settingsDir, "api_profiles.json"), "not-json", "utf8")
		const controller = {} as any

		let thrown: unknown
		try {
			await getApiProfiles(controller, EmptyRequest.create({}))
		} catch (error) {
			thrown = error
		}
		expect(thrown).to.be.instanceOf(SyntaxError)
	})

	it("recovers api_profiles.json when a valid array has trailing broken JSON", async () => {
		const settingsDir = path.join(process.env.DLINE_DIR!, "data", "settings")
		const storedProfilesPath = path.join(settingsDir, "api_profiles.json")
		await fs.mkdir(settingsDir, { recursive: true })
		const validPrefix = [
			{
				id: "deepseek-profile",
				name: "deepseek:deepseek-v4-pro",
				provider: "deepseek",
				modelId: "deepseek-v4-pro",
				usedFor: ["act", "plan"],
				enabled: true,
			},
		]
		await fs.writeFile(
			storedProfilesPath,
			`${JSON.stringify(validPrefix, null, "\t")},\n\t\t\t\t"outputPrice": 0\n\t\t\t}\n\t\t}\n\t}\n]`,
			"utf8",
		)

		const controller = {
			stateManager: {
				getApiConfiguration: () => ({}),
				setGlobalState: vi.fn(),
				flushPendingState: vi.fn().mockResolvedValue(undefined),
			},
			postStateToWebview: vi.fn(),
		} as any

		const response = await getApiProfiles(controller, EmptyRequest.create({}))

		expect(response.profiles).to.have.length(1)
		expect(response.profiles[0].id).to.equal("deepseek-profile")

		const repairedRaw = await fs.readFile(storedProfilesPath, "utf8")
		const repairedProfiles = JSON.parse(repairedRaw)
		expect(repairedProfiles).to.have.length(1)
		expect(repairedProfiles[0].id).to.equal("deepseek-profile")
		expect(repairedRaw.trim().endsWith("]")).to.equal(true)
		expect(repairedRaw).not.to.include('"outputPrice": 0')
	})
})
