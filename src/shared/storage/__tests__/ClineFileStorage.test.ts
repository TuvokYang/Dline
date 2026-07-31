import * as fs from "node:fs"
import fsPromises from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ClineFileStorage } from "../ClineFileStorage"

const fsMock = vi.hoisted(() => ({
	renameSync: vi.fn<typeof import("node:fs").renameSync>(),
	actualRenameSync: undefined as typeof import("node:fs").renameSync | undefined,
}))

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>()
	fsMock.actualRenameSync = actual.renameSync
	return { ...actual, renameSync: fsMock.renameSync }
})

describe("ClineFileStorage", () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "dline-file-storage-"))
		fsMock.renameSync.mockReset()
		fsMock.renameSync.mockImplementation((sourcePath, destinationPath) =>
			fsMock.actualRenameSync!(sourcePath, destinationPath),
		)
	})

	afterEach(async () => {
		await fsPromises.rm(tempDir, { recursive: true, force: true })
	})

	it("retries transient Windows rename failures up to the third attempt", () => {
		const storagePath = path.join(tempDir, "api_keys.json")
		let attempts = 0
		fsMock.renameSync.mockImplementation((sourcePath, destinationPath) => {
			attempts++
			if (attempts < 3) {
				throw Object.assign(new Error("file is temporarily locked"), {
					code: "EPERM",
					syscall: "rename",
					path: sourcePath,
					dest: destinationPath,
				})
			}
			return fsMock.actualRenameSync!(sourcePath, destinationPath)
		})

		const storage = new ClineFileStorage<{ apiKey: string }>(storagePath, "ApiKeyStore")
		storage.setBatch({ profile: { apiKey: "secret" } })

		expect(attempts).toBe(3)
		expect(JSON.parse(fs.readFileSync(storagePath, "utf8"))).toEqual({ profile: { apiKey: "secret" } })
	})

	it("propagates permanent write failures without committing the in-memory value", () => {
		const storagePath = path.join(tempDir, "api_keys.json")
		const storage = new ClineFileStorage<{ apiKey: string }>(storagePath, "ApiKeyStore")
		const failure = Object.assign(new Error("destination is invalid"), {
			code: "EINVAL",
			syscall: "rename",
		})
		fsMock.renameSync.mockImplementation(() => {
			throw failure
		})

		expect(() => storage.setBatch({ profile: { apiKey: "secret" } })).toThrow(failure)
		expect(storage.get("profile")).toBeUndefined()
		expect(fs.existsSync(storagePath)).toBe(false)
	})

	it("stops after three transient rename failures and preserves the original error", () => {
		const storagePath = path.join(tempDir, "api_keys.json")
		const storage = new ClineFileStorage<{ apiKey: string }>(storagePath, "ApiKeyStore")
		const failure = Object.assign(new Error("file remained locked"), {
			code: "EPERM",
			syscall: "rename",
		})
		fsMock.renameSync.mockImplementation(() => {
			throw failure
		})

		expect(() => storage.setBatch({ profile: { apiKey: "secret" } })).toThrow(failure)
		expect(fsMock.renameSync).toHaveBeenCalledTimes(3)
		expect(storage.get("profile")).toBeUndefined()
		expect(fs.existsSync(storagePath)).toBe(false)
	})
})
