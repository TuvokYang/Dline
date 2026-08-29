import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { EmptyRequest } from "@shared/proto/dline/common"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * P0 regression guard: a Catalog read must not keep rewriting the Catalog file.
 *
 * `getApiProfiles` is served by every Controller (sidebar plus each editor panel).
 * When a read wrote the file, the write woke the Catalog watcher, the watcher
 * advanced the Catalog revision, every Webview reloaded, and each reload wrote
 * again. With several panels open, `api_profiles.json` never reached the
 * watcher's stability window and newly opened panels stayed on
 * "Loading profiles…" no matter how small the file was.
 */

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dline-profile-storm-"))

vi.mock("@core/storage/disk", () => ({
	getDlineDataDir: () => dataDir,
}))

function createController() {
	return {
		stateManager: {
			flushPendingState: vi.fn().mockResolvedValue(undefined),
			getApiConfiguration: vi.fn().mockReturnValue({}),
			setGlobalState: vi.fn(),
			setGlobalStateBatch: vi.fn(),
			getGlobalSettingsKey: vi.fn(),
		},
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
	} as never
}

async function writeCatalog(profiles: unknown[]): Promise<string> {
	const settingsDir = path.join(dataDir, "settings")
	await fs.mkdir(settingsDir, { recursive: true })
	const filePath = path.join(settingsDir, "api_profiles.json")
	await fs.writeFile(filePath, JSON.stringify(profiles, null, "\t"), "utf8")
	return filePath
}

describe("getApiProfiles read/write storm", () => {
	beforeEach(async () => {
		vi.resetModules()
	})

	afterEach(async () => {
		await fs.rm(path.join(dataDir, "settings"), { recursive: true, force: true })
	})

	it("does not rewrite the Catalog on every read once registry drift is repaired", async () => {
		const filePath = await writeCatalog([
			{ id: "profile-1", name: "openai:gpt-4o", provider: "openai", modelId: "gpt-4o", enabled: true },
		])
		const module = await import("../getApiProfiles")
		module.resetRegistryModelInfoRepairGateForTest()

		const controller = createController()
		await module.getApiProfiles(controller, EmptyRequest.create({}))
		// Let any fire-and-forget repair settle before sampling the file identity.
		await new Promise((resolve) => setTimeout(resolve, 50))
		const afterFirst = await fs.stat(filePath)

		for (let index = 0; index < 5; index++) {
			await module.getApiProfiles(controller, EmptyRequest.create({}))
		}
		await new Promise((resolve) => setTimeout(resolve, 50))
		const afterRepeats = await fs.stat(filePath)

		// Repeated reads must leave the Catalog byte-identical, so the watcher stays quiet.
		expect(afterRepeats.mtimeMs).toBe(afterFirst.mtimeMs)
		expect(afterRepeats.size).toBe(afterFirst.size)
	})

	it("keeps repeated synchronous reads from rewriting the Catalog", async () => {
		const filePath = await writeCatalog([
			{ id: "profile-1", name: "openai:gpt-4o", provider: "openai", modelId: "gpt-4o", enabled: true },
		])
		const module = await import("../getApiProfiles")
		module.resetRegistryModelInfoRepairGateForTest()

		module.readApiProfiles()
		await new Promise((resolve) => setTimeout(resolve, 50))
		const afterFirst = await fs.stat(filePath)

		for (let index = 0; index < 10; index++) {
			module.readApiProfiles()
		}
		await new Promise((resolve) => setTimeout(resolve, 50))
		const afterRepeats = await fs.stat(filePath)

		expect(afterRepeats.mtimeMs).toBe(afterFirst.mtimeMs)
		expect(afterRepeats.size).toBe(afterFirst.size)
	})
})
