import { expect } from "chai"
import { describe, it } from "vitest"
import { constructNewFileContent as cnfc, DIFF_ERROR_CODE, DiffError, type DiffErrorCode, DiffParser } from "./diff"

/** Construct new content with the V2 implementation. */
async function cnfc2(diffContent: string, originalContent: string, isFinal: boolean): Promise<string> {
	const result = await cnfc(diffContent, originalContent, isFinal, "v2")
	return result.newContent
}

/** Assert that an async diff operation fails with the expected diff error code. */
async function expectDiffError(action: () => Promise<unknown>, code: DiffErrorCode): Promise<void> {
	let thrown: unknown
	try {
		await action()
	} catch (err) {
		thrown = err
	}
	expect(thrown).to.be.instanceOf(DiffError)
	expect((thrown as DiffError).code).to.equal(code)
}

/** Parse diff text through the production DiffParser path. */
function parseWithDiffParser(diffContent: string, originalContent: string): ReturnType<DiffParser["getResult"]> {
	const parser = new DiffParser(originalContent)
	for (const line of diffContent.split("\n")) {
		parser.processLine(line)
	}
	parser.finalize()
	return parser.getResult()
}

/** Assert that the production DiffParser returns an error block with the expected code. */
function expectParserError(diffContent: string, originalContent: string, code: DiffErrorCode): void {
	const result = parseWithDiffParser(diffContent, originalContent)
	const errorBlock = result.blocks.find((block) => block.hasError)
	expect(errorBlock?.errorCode).to.equal(code)
}

describe("Diff Format Edge Cases", () => {
	it("should reject SEARCH with less than 7 delimiters at block start", async () => {
		const isFinal = true
		const original = "before\ncontent\nafter"
		const diff = `----- SEARCH
content
=======
new content
+++++++ REPLACE`
		await expectDiffError(() => cnfc(diff, original, isFinal), DIFF_ERROR_CODE.DELIMITER_TOO_SHORT)
		await expectDiffError(() => cnfc2(diff, original, isFinal), DIFF_ERROR_CODE.DELIMITER_TOO_SHORT)
		expectParserError(diff, original, DIFF_ERROR_CODE.DELIMITER_TOO_SHORT)
	})

	it("should reject SEARCH with more than 7 and mismatched REPLACE delimiter", async () => {
		const isFinal = true
		const original = "before\ncontent\nafter"
		const diff = `----------- SEARCH
content
=======
new content
+++++++ REPLACE`
		try {
			await cnfc(diff, original, isFinal)
			expect.fail("Expected DELIMITER_MISMATCH error")
		} catch (err) {
			expect(err).to.be.an("error")
		}
	})

	it("should reject SEARCH <7 and REPLACE <7", async () => {
		const isFinal = true
		const original = "before\ncontent\nafter"
		const diff = `----- SEARCH
content
=====
new content
+++++++ REPLACE`
		await expectDiffError(() => cnfc(diff, original, isFinal), DIFF_ERROR_CODE.DELIMITER_TOO_SHORT)
		await expectDiffError(() => cnfc2(diff, original, isFinal), DIFF_ERROR_CODE.DELIMITER_TOO_SHORT)
		expectParserError(diff, original, DIFF_ERROR_CODE.DELIMITER_TOO_SHORT)
	})

	it("should reject SEARCH <7 and REPLACE >7", async () => {
		const isFinal = true
		const original = "before\ncontent\nafter"
		const diff = `----- SEARCH
content
========
new content
+++++++ REPLACE`
		await expectDiffError(() => cnfc(diff, original, isFinal), DIFF_ERROR_CODE.DELIMITER_TOO_SHORT)
		await expectDiffError(() => cnfc2(diff, original, isFinal), DIFF_ERROR_CODE.DELIMITER_TOO_SHORT)
		expectParserError(diff, original, DIFF_ERROR_CODE.DELIMITER_TOO_SHORT)
	})

	it("should reject SEARCH >7 with mismatched REPLACE delimiter", async () => {
		const isFinal = true
		const original = "before\ncontent\nafter"
		const diff = `----------- SEARCH
content
==========
new content
+++++++ REPLACE`
		try {
			await cnfc(diff, original, isFinal)
			expect.fail("Expected DELIMITER_MISMATCH error")
		} catch (err) {
			expect(err).to.be.an("error")
		}
	})

	it("should reject SEARCH >7 with less REPLACE delimiters", async () => {
		const isFinal = true
		const original = "before\ncontent\nafter"
		const diff = `----------- SEARCH
content
=====
new content
+++++++ REPLACE`
		try {
			await cnfc(diff, original, isFinal)
			expect.fail("Expected DELIMITER_MISMATCH error")
		} catch (err) {
			expect(err).to.be.an("error")
		}
	})

	it("should reject second block when second SEARCH has less than 7", async () => {
		const isFinal = true
		const original = "before\nfirst content\nafter\nsecond content\nend"
		const diff = `------- SEARCH
first content
=======
first new content
+++++++ REPLACE
----- SEARCH
second content
=======
second new content
+++++++ REPLACE`
		await expectDiffError(() => cnfc(diff, original, isFinal), DIFF_ERROR_CODE.DELIMITER_TOO_SHORT)
		await expectDiffError(() => cnfc2(diff, original, isFinal), DIFF_ERROR_CODE.DELIMITER_TOO_SHORT)

		const parserResult = parseWithDiffParser(diff, original)
		expect(parserResult.newContent).to.equal("before\nfirst new content\nafter\nsecond content\nend")
		expect(parserResult.blocks[1]?.errorCode).to.equal(DIFF_ERROR_CODE.DELIMITER_TOO_SHORT)
	})

	it("should reject second block when second SEARCH and REPLACE both <7", async () => {
		const isFinal = true
		const original = "before\nfirst content\nafter\nsecond content\nend"
		const diff = `------- SEARCH
first content
=======
first new content
+++++++ REPLACE
----- SEARCH
second content
=====
second new content
+++++++ REPLACE`
		await expectDiffError(() => cnfc(diff, original, isFinal), DIFF_ERROR_CODE.DELIMITER_TOO_SHORT)
		await expectDiffError(() => cnfc2(diff, original, isFinal), DIFF_ERROR_CODE.DELIMITER_TOO_SHORT)

		const parserResult = parseWithDiffParser(diff, original)
		expect(parserResult.newContent).to.equal("before\nfirst new content\nafter\nsecond content\nend")
		expect(parserResult.blocks[1]?.errorCode).to.equal(DIFF_ERROR_CODE.DELIMITER_TOO_SHORT)
	})

	it("should treat short SEARCH marker inside content as normal text", async () => {
		const isFinal = true
		const original = "before\nalpha\n----- SEARCH\nomega\nafter"
		const diff = `------- SEARCH
alpha
----- SEARCH
omega
=======
alpha
----- SEARCH
changed
+++++++ REPLACE`
		const expected = "before\nalpha\n----- SEARCH\nchanged\nafter"

		const result1 = await cnfc(diff, original, isFinal)
		expect(result1.newContent).to.equal(expected)

		const result2 = await cnfc2(diff, original, isFinal)
		expect(result2).to.equal(expected)

		const parserResult = parseWithDiffParser(diff, original)
		expect(parserResult.newContent).to.equal(expected)
		expect(parserResult.blocks.some((block) => block.errorCode === DIFF_ERROR_CODE.DELIMITER_TOO_SHORT)).to.equal(false)
	})
})
