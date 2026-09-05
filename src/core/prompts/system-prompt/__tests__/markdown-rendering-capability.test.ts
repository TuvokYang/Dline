import { describe, expect, it } from "vitest"

import capabilities from "@/core/prompts/i18n/en/system/capabilities"
import { LITE_CAPABILITIES } from "@/core/prompts/i18n/en/variants/lite/content"

/**
 * The webview typesets these fenced languages, and the engine loads these TeX
 * packages. Both prompt variants must describe exactly that, otherwise the model
 * emits macros we cannot render or avoids output we can render.
 *
 * Mirrors `LATEX_TEX_PACKAGES` in
 * `webview-ui/src/components/common/latex-engine.ts`; the webview is a separate
 * TypeScript project, so the list is restated here and asserted in both places.
 */
const ANNOUNCED_TEX_PACKAGES = ["base", "ams", "newcommand", "noundefined", "boldsymbol", "braket", "mhchem", "color"] as const

/** Mirrors `LATEX_LANGUAGE_PATTERN` in `MarkdownBlock.tsx`. */
const TYPESET_LANGUAGES = ["latex", "math", "tex"] as const

describe("markdown rendering capability declaration", () => {
	describe.each([
		["standard", capabilities.main],
		["lite", LITE_CAPABILITIES],
	])("%s prompt", (_variant, prompt) => {
		it.each(TYPESET_LANGUAGES)("announces the %s fenced language", (language) => {
			expect(prompt).toContain(`\`${language}\``)
		})

		it.each(ANNOUNCED_TEX_PACKAGES)("announces the %s TeX package", (texPackage) => {
			expect(prompt).toContain(texPackage)
		})

		it("announces mermaid diagram rendering", () => {
			expect(prompt).toContain("`mermaid`")
		})

		it("tells the model that dollar delimiters are not rendered", () => {
			expect(prompt).toContain("`$...$`")
			expect(prompt).toContain("NOT rendered")
		})

		it("does not announce the sandbox package as a usable macro set", () => {
			// `begingroup` is loaded only to isolate macros between formulas.
			expect(prompt).not.toContain("begingroup")
		})
	})

	it("gives the standard prompt a runnable formula example", () => {
		expect(capabilities.main).toContain("```latex")
	})
})
