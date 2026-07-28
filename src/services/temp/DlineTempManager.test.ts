import assert from "node:assert/strict"
import * as path from "node:path"
import { describe, it } from "vitest"
import { DlineTempManager } from "./DlineTempManager"

describe("DlineTempManager", () => {
	it("owns the Dline system temp directory", () => {
		assert.equal(path.basename(DlineTempManager.getTempDir()), "dline")
	})

	it("uses the supplied stable identity as the exact log filename stem", () => {
		const filePath = DlineTempManager.createTempFilePath("command_100_1")

		assert.equal(path.dirname(filePath), DlineTempManager.getTempDir())
		assert.equal(path.basename(filePath), "command_100_1.log")
	})

	it("recognizes only the Dline temp directory and its descendants", () => {
		const tempDir = DlineTempManager.getTempDir()

		assert.equal(DlineTempManager.isManagedPath(tempDir), true)
		assert.equal(DlineTempManager.isManagedPath(path.join(tempDir, "nested", "output.log")), true)
		assert.equal(DlineTempManager.isManagedPath(path.join(tempDir, "..", "cline", "output.log")), false)
		assert.equal(DlineTempManager.isManagedPath(`${tempDir}-other`), false)
		assert.equal(DlineTempManager.isManagedPath(path.dirname(tempDir)), false)
	})
})
