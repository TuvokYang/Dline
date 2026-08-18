import { readFile } from "node:fs/promises"
import * as path from "node:path"
import { describe, expect, it } from "vitest"

const INCLUSIVE_PROMPT_USAGE_ADAPTERS = [
	"doubao.ts",
	"fireworks.ts",
	"groq.ts",
	"hicap.ts",
	"lmstudio.ts",
	"moonshot.ts",
	"qwen.ts",
	"requesty.ts",
	"xai.ts",
	"zai.ts",
] as const

describe("Provider inclusive prompt usage boundary", () => {
	it.each(INCLUSIVE_PROMPT_USAGE_ADAPTERS)("normalizes %s through the shared non-overlapping usage policy", async (file) => {
		const source = await readFile(path.join(__dirname, "..", file), "utf8")

		expect(source).toContain('import { splitInclusiveInputUsage } from "../transform/usage-normalization"')
		expect(source).toContain("splitInclusiveInputUsage({")
		expect(source).not.toMatch(/inputTokens:\s*[^\n]*(?:prompt_tokens|promptTokens)/)
	})
})
