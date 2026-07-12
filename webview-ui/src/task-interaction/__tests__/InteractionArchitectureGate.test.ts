import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const CURRENT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const WEBVIEW_SOURCE_ROOT = path.resolve(CURRENT_DIRECTORY, "../..")
const LEGACY_WEBVIEW_MARKERS = [
	"BUTTON_CONFIGS",
	"getButtonConfig",
	"executeButtonAction",
	"findInteractionMessage",
	"findLatestStateSnapshot",
] as const

/** Read Webview production TypeScript sources in stable path order. */
async function readSources(directory: string): Promise<string> {
	const entries = await readdir(directory, { withFileTypes: true })
	const contents: string[] = []

	for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
		const entryPath = path.join(directory, entry.name)
		if (entry.isDirectory()) {
			if (entry.name !== "__tests__") {
				contents.push(await readSources(entryPath))
			}
			continue
		}
		if (
			entry.isFile() &&
			(entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
			!entry.name.endsWith(".test.ts") &&
			!entry.name.endsWith(".test.tsx") &&
			!entry.name.endsWith(".spec.ts") &&
			!entry.name.endsWith(".spec.tsx")
		) {
			contents.push(await readFile(entryPath, "utf8"))
		}
	}

	return contents.join("\n")
}

describe("final Webview interaction architecture gate", () => {
	it("removes all legacy button and message inference markers", async () => {
		const sources = await readSources(WEBVIEW_SOURCE_ROOT)

		for (const marker of LEGACY_WEBVIEW_MARKERS) {
			expect(sources).not.toContain(marker)
		}
		expect(sources).toContain("interface SayView")
		expect(sources).not.toMatch(/interface SayView[\s\S]*?actions\s*:/)
	})
})
