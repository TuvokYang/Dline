import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
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
			},
			postStateToWebview: vi.fn(),
		} as any

		const response = await getApiProfiles(controller, EmptyRequest.create({}))

		expect(response.profiles).to.have.length(1)
		expect(response.profiles[0].provider).to.equal("anthropic")
		expect(response.profiles[0].apiKey).to.equal("sk-ant-test")
		expect(response.profiles[0].enabled).to.equal(true)
		expect(response.profiles[0].usedFor).to.deep.equal(["act", "plan"])

		const storedProfilesPath = path.join(process.env.DLINE_DIR!, "data", "settings", "api_profiles.json")
		const storedProfiles = JSON.parse(await fs.readFile(storedProfilesPath, "utf8"))
		expect(storedProfiles[0]).not.to.have.property("apiKey")
		expect(storedProfiles[0]).not.to.have.property("api_key")

		const keyEntries = Object.values(getAllApiKeys())
		expect(keyEntries).to.have.length(1)
		expect(keyEntries[0].apiKey).to.equal("sk-ant-test")
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
			`${JSON.stringify(validPrefix, null, "\t")},\n\t\t\t\t\"outputPrice\": 0\n\t\t\t}\n\t\t}\n\t}\n]`,
			"utf8",
		)

		const controller = {
			stateManager: {
				getApiConfiguration: () => ({}),
				setGlobalState: vi.fn(),
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
