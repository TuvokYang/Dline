import fs from "fs/promises"
import { afterEach, describe, expect, it, vi } from "vitest"
import { writeExcludesFile } from "../CheckpointExclusions"

vi.mock("fs/promises", () => ({
	default: {
		mkdir: vi.fn().mockResolvedValue(undefined),
		writeFile: vi.fn().mockResolvedValue(undefined),
	},
}))

describe("writeExcludesFile", () => {
	afterEach(() => {
		vi.clearAllMocks()
	})

	it("persists repository boundary patterns in the shadow repository excludes", async () => {
		await writeExcludesFile("C:/shadow/.git", ["*.large"], "tmp/", ["/packages/submodule/", "/packages/nested/"])

		expect(fs.writeFile).toHaveBeenCalledOnce()
		const [, content] = vi.mocked(fs.writeFile).mock.calls[0] ?? []
		expect(content).toEqual(expect.stringContaining("/packages/submodule/"))
		expect(content).toEqual(expect.stringContaining("/packages/nested/"))
		expect(content).toEqual(expect.stringContaining("*.large"))
		expect(content).toEqual(expect.stringContaining("tmp/"))
	})
})
