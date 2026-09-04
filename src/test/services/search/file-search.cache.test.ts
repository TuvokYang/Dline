import * as fileSearch from "@services/search/file-search"
import * as childProcess from "child_process"
import * as fs from "fs"
import { EventEmitter, Readable } from "stream"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { HostProvider } from "@/hosts/host-provider"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock("child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("child_process")>()
	return {
		...actual,
		spawn: spawnMock,
	}
})

/**
 * Builds a ripgrep stub that streams `files` and exits cleanly.
 *
 * Each invocation gets its own stream instances so repeated calls cannot
 * accidentally share an already-consumed Readable and appear to succeed.
 */
function stubRipgrepProcess(files: readonly string[]): childProcess.ChildProcess {
	const stdout = new Readable({ read() {} })
	const stderr = new Readable({ read() {} })
	const proc = Object.assign(new EventEmitter(), {
		stdout,
		stderr,
		kill: vi.fn(),
	}) as unknown as childProcess.ChildProcess

	setImmediate(() => {
		for (const file of files) {
			stdout.push(`${file}\n`)
		}
		stdout.push(null)
		stderr.push(null)
		proc.emit("exit", 0)
	})

	return proc
}

describe("file-search workspace enumeration cache", () => {
	beforeEach(() => {
		spawnMock.mockReset()
		const spawnWrapper: typeof childProcess.spawn = (command, options) => spawnMock(command, options)
		vi.spyOn(fileSearch, "getSpawnFunction").mockReturnValue(spawnWrapper)
		vi.spyOn(fs.promises, "access").mockResolvedValue(undefined as any)
		vi.spyOn(fs.promises, "lstat").mockResolvedValue({ isDirectory: () => false } as fs.Stats)

		setVscodeHostProviderMock()
		vi.spyOn(HostProvider.window, "getOpenTabs").mockResolvedValue({ paths: [] } as any)
		// VS Code has no workspace index, so production always falls through to
		// ripgrep. Make that explicit instead of relying on the default stub.
		vi.spyOn(HostProvider.workspace, "searchWorkspaceItems").mockRejectedValue(
			new Error("searchWorkspaceItems is not implemented on the VS Code host"),
		)

		fileSearch.clearWorkspaceEnumerationCache()
	})

	afterEach(() => {
		fileSearch.clearWorkspaceEnumerationCache()
		vi.restoreAllMocks()
	})

	it("does not spawn one ripgrep process per keystroke for the same workspace", async () => {
		spawnMock.mockImplementation(() => stubRipgrepProcess(["src/alpha.ts", "src/beta.ts"]))

		// Mirrors a user typing "@al" — the debounce fires once per character.
		await fileSearch.searchWorkspaceFiles("a", "/workspace", 20)
		await fileSearch.searchWorkspaceFiles("al", "/workspace", 20)
		await fileSearch.searchWorkspaceFiles("alp", "/workspace", 20)

		expect(spawnMock).toHaveBeenCalledTimes(1)
	})

	it("returns identical results whether served from the cache or a fresh enumeration", async () => {
		spawnMock.mockImplementation(() => stubRipgrepProcess(["src/alpha.ts", "src/beta.ts"]))

		const fresh = await fileSearch.searchWorkspaceFiles("alpha", "/workspace", 20)
		const cached = await fileSearch.searchWorkspaceFiles("alpha", "/workspace", 20)

		expect(cached.items).toEqual(fresh.items)
		expect(cached.source).toEqual(fresh.source)
		expect(spawnMock).toHaveBeenCalledTimes(1)
	})

	it("collapses concurrent searches of the same workspace into a single enumeration", async () => {
		spawnMock.mockImplementation(() => stubRipgrepProcess(["src/alpha.ts"]))

		await Promise.all([
			fileSearch.searchWorkspaceFiles("a", "/workspace", 20),
			fileSearch.searchWorkspaceFiles("al", "/workspace", 20),
			fileSearch.searchWorkspaceFiles("alp", "/workspace", 20),
		])

		expect(spawnMock).toHaveBeenCalledTimes(1)
	})

	it("keeps separate cache entries per workspace root", async () => {
		spawnMock.mockImplementation(() => stubRipgrepProcess(["src/alpha.ts"]))

		await fileSearch.searchWorkspaceFiles("a", "/workspace-one", 20)
		await fileSearch.searchWorkspaceFiles("a", "/workspace-two", 20)
		await fileSearch.searchWorkspaceFiles("a", "/workspace-one", 20)

		expect(spawnMock).toHaveBeenCalledTimes(2)
	})

	it("re-enumerates after the cache entry expires", async () => {
		spawnMock.mockImplementation(() => stubRipgrepProcess(["src/alpha.ts"]))

		// Only the clock is faked: ripgrep stubs rely on real `setImmediate`, so
		// faking timers wholesale would deadlock the stream teardown.
		const realNow = Date.now
		let clock = realNow()
		vi.spyOn(Date, "now").mockImplementation(() => clock)

		await fileSearch.searchWorkspaceFiles("a", "/workspace", 20)
		clock += fileSearch.WORKSPACE_ENUMERATION_CACHE_TTL_MS + 1
		await fileSearch.searchWorkspaceFiles("a", "/workspace", 20)

		expect(spawnMock).toHaveBeenCalledTimes(2)
	})

	it("does not cache failed enumerations", async () => {
		spawnMock.mockImplementationOnce(() => {
			const stdout = new Readable({ read() {} })
			const stderr = new Readable({ read() {} })
			const proc = Object.assign(new EventEmitter(), {
				stdout,
				stderr,
				kill: vi.fn(),
			}) as unknown as childProcess.ChildProcess
			setImmediate(() => {
				stdout.push(null)
				stderr.push("rg: fatal\n")
				stderr.push(null)
				proc.emit("exit", 2)
			})
			return proc
		})
		spawnMock.mockImplementation(() => stubRipgrepProcess(["src/alpha.ts"]))

		await expect(fileSearch.searchWorkspaceFiles("a", "/workspace", 20)).rejects.toThrow()

		const recovered = await fileSearch.searchWorkspaceFiles("a", "/workspace", 20)

		expect(recovered.items.length).toBeGreaterThan(0)
		expect(spawnMock).toHaveBeenCalledTimes(2)
	})

	it("does not enumerate at all when the host index serves the query", async () => {
		vi.mocked(HostProvider.workspace.searchWorkspaceItems).mockResolvedValue({
			items: [{ path: "src/alpha.ts", type: 1, label: "alpha.ts" }],
		} as any)

		const result = await fileSearch.searchWorkspaceFiles("alpha", "/workspace", 20)

		expect(result.source).toBe("host_index")
		expect(spawnMock).not.toHaveBeenCalled()
	})
})
