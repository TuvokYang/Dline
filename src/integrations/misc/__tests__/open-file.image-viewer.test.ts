import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { materializeTaskImageViewer } from "../open-file"

const PNG_1X1_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="

describe("materializeTaskImageViewer", () => {
	let tempDirectory: string
	let taskDirectory: string

	beforeEach(async () => {
		tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "dline-image-viewer-"))
		taskDirectory = path.join(tempDirectory, "tasks", "task-1")
	})

	afterEach(async () => {
		await fs.rm(tempDirectory, { recursive: true, force: true })
	})

	it("materializes viewer content only under task tmp and clears stale startup files", async () => {
		const stalePath = path.join(taskDirectory, "tmp", "image-viewer", "stale.png")
		await fs.mkdir(path.dirname(stalePath), { recursive: true })
		await fs.writeFile(stalePath, "stale")
		const viewerPath = await materializeTaskImageViewer(`data:image/png;base64,${PNG_1X1_BASE64}`, taskDirectory)

		expect(path.relative(taskDirectory, viewerPath).split(path.sep).join("/"))
			.toMatch(/^tmp\/image-viewer\/[a-f0-9]{64}\.png$/)
		expect(path.basename(viewerPath)).not.toContain("temp_image_")
		expect((await fs.readFile(viewerPath)).toString("base64")).toBe(PNG_1X1_BASE64)
		await expect(fs.access(stalePath)).rejects.toThrow()
	})

	it("rejects non-canonical or unsupported viewer data", async () => {
		await expect(materializeTaskImageViewer("data:image/gif;base64,AAAA", taskDirectory)).rejects.toThrow(
			"Invalid task image viewer request",
		)
		await expect(materializeTaskImageViewer("data:image/png;base64,AA=A", taskDirectory)).rejects.toThrow(
			"Invalid task image viewer request",
		)
	})
})
