/**
 * Unit tests for parseDiff — the unified diff parser producing ParsedBlock[].
 * Covers: single block, multi block, error blocks, streaming vs final error suppression.
 */

import { expect } from "chai"
import { describe, it } from "vitest"
import type { DiffResult } from "./diff"
import { DiffParser } from "./diff"

function runDiff(diffContent: string, originalContent: string, isPartial = false): DiffResult {
	const parser = new DiffParser(originalContent, isPartial)
	for (const line of diffContent.split("\n")) {
		parser.processLine(line)
	}
	parser.finalize()
	return parser.getResult()
}

describe("parseDiff", () => {
	const originalContent = "line1\nline2\nline3\n"

	it("should parse single block with correct match", async () => {
		const diff = ["------- SEARCH", "line2", "=======", "new line2", "+++++++ REPLACE"].join("\n")

		const result = runDiff(diff, originalContent)

		expect(result.blocks).to.have.lengthOf(1)
		expect(result.blocks[0].hasError).to.be.false
		expect(result.blocks[0].startLine).to.equal(2)
		expect(result.blocks[0].searchText).to.equal("line2")
		expect(result.blocks[0].replaceText).to.equal("new line2")
		expect(result.blocks[0].rawText).to.include("------- SEARCH")
		expect(result.newContent).to.equal("line1\nnew line2\nline3\n")
	})

	it("should parse multi-block diff", async () => {
		const diff = [
			"------- SEARCH",
			"line1",
			"=======",
			"new line1",
			"+++++++ REPLACE",
			"------- SEARCH",
			"line3",
			"=======",
			"new line3",
			"+++++++ REPLACE",
		].join("\n")

		const result = runDiff(diff, originalContent)

		expect(result.blocks).to.have.lengthOf(2)
		expect(result.blocks[0].hasError).to.be.false
		expect(result.blocks[1].hasError).to.be.false
		expect(result.newContent).to.equal("new line1\nline2\nnew line3\n")
	})

	it("should mark SEARCH_NOT_FOUND as error block with rawText", async () => {
		const diff = ["------- SEARCH", "does not exist", "=======", "should not insert", "+++++++ REPLACE"].join("\n")

		const result = await runDiff(diff, originalContent)

		expect(result.blocks).to.have.lengthOf(1)
		expect(result.blocks[0].hasError).to.be.true
		expect(result.blocks[0].startLine).to.equal(0)
		expect(result.blocks[0].rawText).to.include("------- SEARCH")
		expect(result.blocks[0].rawText).to.include("does not exist")
		// newContent should be unchanged
		expect(result.newContent).to.equal(originalContent)
	})

	it("should suppress UNCLOSED error during streaming (isPartial=true)", async () => {
		const diff = [
			"------- SEARCH",
			"line2",
			// Missing ======= and +++++++ REPLACE — unclosed
		].join("\n")

		const result = runDiff(diff, originalContent, true)
		// During streaming, unclosed blocks should NOT produce errors
		expect(result.blocks.some((b) => b.hasError)).to.be.false
	})

	it("should report UNCLOSED error at final (isPartial=false)", async () => {
		const diff = ["------- SEARCH", "line2"].join("\n")

		const result = runDiff(diff, originalContent) // default isPartial=false
		expect(result.blocks.some((b) => b.hasError)).to.be.true
	})

	it("should handle empty diff gracefully", async () => {
		const result = runDiff("", originalContent)
		expect(result.blocks).to.be.empty
		expect(result.newContent).to.equal(originalContent)
	})
})
