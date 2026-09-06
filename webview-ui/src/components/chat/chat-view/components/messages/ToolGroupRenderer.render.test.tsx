import type { ClineMessage, ClineSayTool } from "@shared/ExtensionMessage"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ToolGroupRenderer } from "./ToolGroupRenderer"

vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: { openFileRelativePath: vi.fn().mockResolvedValue({}) },
}))

/** A completed tool message carrying the given say payload. */
function toolMessage(ts: number, payload: ClineSayTool): ClineMessage {
	return { ts, type: "say", say: "tool", text: JSON.stringify(payload) }
}

/** Render one completed tool entry outside any active request. */
function renderTool(payload: ClineSayTool) {
	const message = toolMessage(1, payload)
	return render(<ToolGroupRenderer allMessages={[message]} isLastGroup={false} messages={[message]} />)
}

describe("ToolGroupRenderer rows", () => {
	it("labels a reference lookup with its symbol, file and scale", () => {
		renderTool({
			tool: "findReferences",
			path: "src/core/task/ToolExecutor.ts",
			symbolName: "ToolExecutor",
			count: 12,
			files: 3,
		})

		expect(screen.getByText('"ToolExecutor" in …/core/task/ToolExecutor.ts (12 refs · 3 files)')).toBeInTheDocument()
	})

	it("still labels a reference lookup when the symbol could not be resolved", () => {
		renderTool({ tool: "findReferences", path: "src/a.ts", count: 2, files: 1 })

		expect(screen.getByText("references in src/a.ts (2 refs · 1 file)")).toBeInTheDocument()
	})

	it("keeps the search terms and shows the match scale", () => {
		renderTool({
			tool: "searchFiles",
			path: "src/core/prompts",
			regex: "describe|it|expect|vi|beforeEach",
			filePattern: "*.test.ts",
			count: 300,
			files: 42,
			truncated: true,
		})

		expect(
			screen.getByText('"describe | it | expect +2" in src/core/prompts/ (*.test.ts) (300+ matches · 42 files)'),
		).toBeInTheDocument()
	})

	it("shortens a long read path in the row", () => {
		renderTool({
			tool: "readFile",
			path: "src/core/task/tools/handlers/ReadFileToolHandler.ts",
			readLineStart: 125,
			readLineEnd: 416,
		})

		expect(screen.getByText("…/tools/handlers/ReadFileToolHandler.ts · lines 125-416")).toBeInTheDocument()
	})
})
