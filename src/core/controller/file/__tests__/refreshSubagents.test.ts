import * as disk from "@core/storage/disk"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { HostProvider } from "@/hosts/host-provider"
import { refreshSubagents } from "../refreshSubagents"

/**
 * Unit tests for refreshSubagents discovery and precedence behavior.
 */
describe("refreshSubagents", () => {
	let tempDir: string
	let localDir: string
	let globalDir: string

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "refresh-subagents-test-"))
		localDir = path.join(tempDir, "workspace", ".agents", "subagents")
		globalDir = path.join(tempDir, "global", "subagents")

		await fs.mkdir(localDir, { recursive: true })
		await fs.mkdir(globalDir, { recursive: true })

		vi.spyOn(HostProvider, "workspace", "get").mockReturnValue({
			getWorkspacePaths: vi.fn().mockResolvedValue({ paths: [path.join(tempDir, "workspace")] }),
		} as any)

		vi.spyOn(disk, "getSubagentsScanDirectories").mockReturnValue([
			{ path: localDir, source: "project" },
			{ path: globalDir, source: "global" },
		])
	})

	afterEach(async () => {
		vi.restoreAllMocks()
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	it("should prefer local subagents over global subagents with same name", async () => {
		await fs.writeFile(
			path.join(localDir, "code-reviewer.yaml"),
			"---\nname: code-reviewer\ndescription: Local reviewer\n---\nReview local code.",
			"utf8",
		)
		await fs.writeFile(
			path.join(globalDir, "code-reviewer.yaml"),
			"---\nname: code-reviewer\ndescription: Global reviewer\n---\nReview global code.",
			"utf8",
		)

		const globalToggles = { [path.join(globalDir, "code-reviewer.yaml")]: false }
		const controller = {
			stateManager: {
				getGlobalSettingsKey: (key: string) => (key === "globalSubagentsToggles" ? globalToggles : undefined),
				mutateGlobalSettingsKey: vi.fn(
					async (_key: string, mutate: (current: Record<string, boolean>) => Record<string, boolean>) =>
						mutate(globalToggles),
				),
				getWorkspaceStateKey: (key: string) =>
					key === "localSubagentsToggles" ? { [path.join(localDir, "code-reviewer.yaml")]: true } : undefined,
				setGlobalState: vi.fn(),
				setWorkspaceState: vi.fn(),
			},
		} as any

		const response = await refreshSubagents(controller)

		expect(response.globalSubagents).toHaveLength(0)
		expect(response.localSubagents).toHaveLength(1)
		expect(response.localSubagents[0].name).toBe("code-reviewer")
		expect(response.localSubagents[0].description).toBe("Local reviewer")
		expect(response.localSubagents[0].enabled).toBe(true)
	})
})
