import type { ClineMessage, ClineSayTool } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import {
	buildToolsWithReasoning,
	formatScale,
	formatSearchTerms,
	getActivityText,
	getToolDisplayInfo,
	getToolGroupSummaryFromParsedTools,
	truncatePathHead,
} from "./ToolGroupRenderer"

const readToolMessage = (
	ts: number,
	type: "ask" | "say",
	path: string,
	range?: { start: number; end: number },
): ClineMessage => ({
	ts,
	type,
	...(type === "ask" ? { ask: "tool" as const } : { say: "tool" as const }),
	text: JSON.stringify({
		tool: "readFile",
		path,
		...(range ? { readLineStart: range.start, readLineEnd: range.end } : {}),
	}),
})

describe("buildToolsWithReasoning", () => {
	it("replaces an immediately-following read approval ask with the completed read", () => {
		const tools = buildToolsWithReasoning([
			readToolMessage(1, "ask", "src/a.ts"),
			readToolMessage(2, "say", "src/a.ts", { start: 1, end: 20 }),
		])

		expect(tools).toHaveLength(1)
		expect(tools[0].tool.say).toBe("tool")
		expect(tools[0].parsedTool.readLineStart).toBe(1)
		expect(tools[0].parsedTool.readLineEnd).toBe(20)
	})

	it("keeps separate reads of the same file when they are distinct operations", () => {
		const tools = buildToolsWithReasoning([
			readToolMessage(1, "ask", "src/a.ts"),
			readToolMessage(2, "say", "src/a.ts", { start: 1, end: 20 }),
			readToolMessage(3, "ask", "src/a.ts"),
			readToolMessage(4, "say", "src/a.ts", { start: 40, end: 60 }),
		])

		expect(tools).toHaveLength(2)
		expect(tools.map((tool) => [tool.parsedTool.readLineStart, tool.parsedTool.readLineEnd])).toEqual([
			[1, 20],
			[40, 60],
		])
	})
})

describe("getToolGroupSummaryFromParsedTools", () => {
	it("counts rendered read tools once after ask/say collapse", () => {
		const tools = buildToolsWithReasoning([
			readToolMessage(1, "ask", "src/a.ts"),
			readToolMessage(2, "say", "src/a.ts", { start: 1, end: 20 }),
		])

		expect(getToolGroupSummaryFromParsedTools(tools.map((tool) => tool.parsedTool))).toBe("Dline read 1 file")
	})
})

describe("truncatePathHead", () => {
	it("leaves a short path untouched", () => {
		expect(truncatePathHead("src/shared/api.ts")).toBe("src/shared/api.ts")
	})

	it("keeps the trailing segments and marks the dropped head", () => {
		expect(truncatePathHead("src/core/task/tools/handlers/ReadFileToolHandler.ts")).toBe(
			"…/tools/handlers/ReadFileToolHandler.ts",
		)
	})

	it("preserves a trailing slash so directories stay recognizable", () => {
		expect(truncatePathHead("src/core/prompts/i18n/en/")).toBe("…/prompts/i18n/en/")
	})

	it("returns a single-segment path unchanged", () => {
		expect(truncatePathHead("package.json")).toBe("package.json")
	})

	it("returns an empty path unchanged", () => {
		expect(truncatePathHead("")).toBe("")
	})

	it("honors a custom segment budget", () => {
		expect(truncatePathHead("a/b/c/d/e.ts", 2)).toBe("…/d/e.ts")
	})
})

describe("formatSearchTerms", () => {
	it("quotes a single term identically in both forms", () => {
		expect(formatSearchTerms("toolResult")).toEqual({
			displayText: '"toolResult"',
			tooltipText: '"toolResult"',
		})
	})

	it("joins alternation terms with a separator", () => {
		expect(formatSearchTerms("describe|it|expect").displayText).toBe('"describe | it | expect"')
	})

	it("collapses the overflow into a count instead of dropping the terms", () => {
		expect(formatSearchTerms("describe|it|expect|vi|beforeEach")).toEqual({
			displayText: '"describe | it | expect +2"',
			tooltipText: '"describe | it | expect | vi | beforeEach"',
		})
	})

	it("strips word-boundary and optional-space regex syntax", () => {
		expect(formatSearchTerms("\\bfoo\\b|bar\\s?baz").tooltipText).toBe('"foo | bar baz"')
	})

	it("drops empty alternation branches", () => {
		expect(formatSearchTerms("foo||bar").tooltipText).toBe('"foo | bar"')
	})
})

describe("formatScale", () => {
	it("returns nothing when the count is unknown", () => {
		expect(formatScale(undefined, 3, "match")).toBe("")
	})

	it("reports zero matches without a file count", () => {
		expect(formatScale(0, 0, "match")).toBe(" (0 matches)")
	})

	it("uses the singular unit for exactly one hit", () => {
		expect(formatScale(1, 1, "match")).toBe(" (1 match · 1 file)")
	})

	it("pluralizes both the unit and the file count", () => {
		expect(formatScale(14, 5, "match")).toBe(" (14 matches · 5 files)")
	})

	it("uses the reference unit label", () => {
		expect(formatScale(12, 3, "ref")).toBe(" (12 refs · 3 files)")
	})

	it("marks a capped count as a lower bound and keeps the plural unit", () => {
		expect(formatScale(300, 42, "match", true)).toBe(" (300+ matches · 42 files)")
	})

	it("omits the file part when the file count is unknown", () => {
		expect(formatScale(4, undefined, "ref")).toBe(" (4 refs)")
	})
})

describe("getToolDisplayInfo", () => {
	it("names the symbol, its file and the reference scale", () => {
		const tool = {
			tool: "findReferences",
			path: "src/core/task/ToolExecutor.ts",
			symbolName: "ToolExecutor",
			count: 12,
			files: 3,
		} as ClineSayTool

		expect(getToolDisplayInfo(tool)).toMatchObject({
			displayText: '"ToolExecutor" in …/core/task/ToolExecutor.ts (12 refs · 3 files)',
			tooltipText: '"ToolExecutor" in src/core/task/ToolExecutor.ts (12 refs · 3 files)',
		})
	})

	it("falls back to a generic reference target when the symbol is unknown", () => {
		const tool = { tool: "findReferences", path: "src/a.ts" } as ClineSayTool

		expect(getToolDisplayInfo(tool)).toMatchObject({
			displayText: "references in src/a.ts",
			tooltipText: "references in src/a.ts",
		})
	})

	it("keeps search terms and adds the match scale", () => {
		const tool = {
			tool: "searchFiles",
			path: "src/core/prompts",
			regex: "describe|it|expect|vi|beforeEach",
			filePattern: "*.test.ts",
			count: 300,
			files: 42,
			truncated: true,
		} as ClineSayTool

		expect(getToolDisplayInfo(tool)).toMatchObject({
			displayText: '"describe | it | expect +2" in src/core/prompts/ (*.test.ts) (300+ matches · 42 files)',
			tooltipText: '"describe | it | expect | vi | beforeEach" in src/core/prompts/ (*.test.ts) (300+ matches · 42 files)',
		})
	})

	it("omits the file pattern when it matches everything", () => {
		const tool = { tool: "searchFiles", path: "src", regex: "toolResult", filePattern: "*" } as ClineSayTool

		expect(getToolDisplayInfo(tool)?.displayText).toBe('"toolResult" in src/')
	})

	it("shortens a read path but keeps the line range", () => {
		const tool = {
			tool: "readFile",
			path: "src/core/task/tools/handlers/ReadFileToolHandler.ts",
			readLineStart: 125,
			readLineEnd: 416,
		} as ClineSayTool

		expect(getToolDisplayInfo(tool)).toMatchObject({
			displayText: "…/tools/handlers/ReadFileToolHandler.ts · lines 125-416",
			tooltipText: "src/core/task/tools/handlers/ReadFileToolHandler.ts · lines 125-416",
		})
	})

	it("renders a directory listing with its trailing slash", () => {
		const tool = { tool: "listFilesRecursive", path: "src/core/task/tools" } as ClineSayTool

		expect(getToolDisplayInfo(tool)).toMatchObject({
			displayText: "…/core/task/tools/",
			tooltipText: "src/core/task/tools/",
		})
	})

	it("returns null for tools that have no row representation", () => {
		expect(getToolDisplayInfo({ tool: "webFetch" } as ClineSayTool)).toBeNull()
	})
})

describe("getActivityText", () => {
	it("describes an in-flight reference lookup instead of rendering nothing", () => {
		const tool = { tool: "findReferences", path: "src/core/task/ToolExecutor.ts" } as ClineSayTool

		expect(getActivityText(tool)).toEqual({
			displayText: "Finding references in …/core/task/ToolExecutor.ts...",
			tooltipText: "Finding references in src/core/task/ToolExecutor.ts",
		})
	})

	it("presents in-flight search terms the same way as the completed entry", () => {
		const tool = {
			tool: "searchFiles",
			path: "src/core/prompts",
			regex: "describe|it|expect|vi|beforeEach",
			filePattern: "*.test.ts",
		} as ClineSayTool

		const active = getActivityText(tool)
		const completed = getToolDisplayInfo(tool)

		expect(active?.displayText).toBe(`Searching ${completed?.displayText}...`)
		expect(active?.tooltipText).toBe(`Searching ${completed?.tooltipText}`)
	})

	it("has no text for a tool without a path", () => {
		expect(getActivityText({ tool: "readFile" } as ClineSayTool)).toBeNull()
	})
})
