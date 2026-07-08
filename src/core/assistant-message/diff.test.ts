import { expect } from "chai"
import { describe, it } from "vitest"
import { constructNewFileContent as cnfc } from "./diff"

async function cnfc2(diffContent: string, originalContent: string, isFinal: boolean): Promise<string> {
	const result = await cnfc(diffContent, originalContent, isFinal, "v2")
	return result.newContent
}

describe("constructNewFileContent", () => {
	const testCases = [
		{
			name: "empty file",
			original: "",
			diff: `------- SEARCH
=======
new content
+++++++ REPLACE`,
			expected: "new content\n",
			isFinal: true,
		},
		{
			name: "malformed search - mixed symbols",
			original: "line1\nline2\nline3",
			diff: `<<-- SEARCH
line2
=======
replaced
+++++++ REPLACE`,
			expected: "line1\nline2\nline3",
			isFinal: true,
			v1Only: true,
		},
		{
			name: "malformed search - insufficient dashes",
			original: "line1\nline2\nline3",
			diff: `-- SEARCH
line2
=======
replaced
+++++++ REPLACE`,
			shouldThrow: true,
		},
		{
			name: "malformed search - missing space",
			original: "line1\nline2\nline3",
			diff: `-------SEARCH
line2
=======
replaced
+++++++ REPLACE`,
			expected: "line1\nline2\nline3",
			isFinal: true,
			v1Only: true,
		},
		{
			name: "exact match replacement",
			original: "line1\nline2\nline3",
			diff: `------- SEARCH
line2
=======
replaced
+++++++ REPLACE`,
			expected: "line1\nreplaced\nline3",
			isFinal: true,
		},
		{
			name: "line-trimmed match replacement",
			original: "line1\n line2 \nline3",
			diff: `------- SEARCH
line2
=======
replaced
+++++++ REPLACE`,
			expected: "line1\nreplaced\nline3",
			isFinal: true,
		},
		{
			name: "block anchor match replacement",
			original: "line1\nstart\nmiddle\nend\nline5",
			diff: `------- SEARCH
start
middle
end
=======
replaced
+++++++ REPLACE`,
			expected: "line1\nreplaced\nline5",
			isFinal: true,
		},
		{
			name: "incremental processing",
			original: "line1\nline2\nline3",
			diff: [
				`------- SEARCH
line2
=======`,
				"replaced\n",
				"+++++++ REPLACE",
			].join("\n"),
			expected: "line1\nreplaced\n\nline3",
			isFinal: true,
		},
		{
			name: "final chunk with remaining content",
			original: "line1\nline2\nline3",
			diff: `------- SEARCH
line2
=======
replaced
+++++++ REPLACE`,
			expected: "line1\nreplaced\nline3",
			isFinal: true,
		},
		{
			name: "multiple ordered replacements",
			original: "First\nSecond\nThird\nFourth",
			diff: `------- SEARCH
First
=======
1st
+++++++ REPLACE

------- SEARCH
Third
=======
3rd
+++++++ REPLACE`,
			expected: "1st\nSecond\n3rd\nFourth",
			isFinal: true,
		},
		{
			name: "replace then delete",
			original: "line1\nline2\nline3\nline4",
			diff: `------- SEARCH
line2
=======
replaced
+++++++ REPLACE

------- SEARCH
line4
=======
+++++++ REPLACE`,
			expected: "line1\nreplaced\nline3\n",
			isFinal: true,
		},
		{
			name: "delete then replace",
			original: "line1\nline2\nline3\nline4",
			diff: `------- SEARCH
line1
=======
+++++++ REPLACE

------- SEARCH
line3
=======
replaced
+++++++ REPLACE`,
			expected: "line2\nreplaced\nline4",
			isFinal: true,
		},
		{
			name: "malformed diff - missing separator",
			original: "line1\nline2\nline3",
			diff: `------- SEARCH
line2
+++++++ REPLACE
replaced`,
			shouldThrow: true,
		},
		{
			name: "malformed diff - trailing space on separator",
			original: "line1\nline2\nline3",
			diff: `------- SEARCH
line2
======= 
replaced
+++++++ REPLACE`,
			shouldThrow: true,
		},
		{
			name: "malformed diff - double replace markers",
			original: "line1\nline2\nline3",
			diff: `------- SEARCH
line2
+++++++ REPLACE
first replacement
+++++++ REPLACE`,
			shouldThrow: true,
		},
		{
			name: "malformed diff - malformed separator with dashes",
			original: "line1\nline2\nline3",
			diff: `------- SEARCH
line2
------- =======
replaced
+++++++ REPLACE`,
			shouldThrow: true,
		},
	]
	//.filter(({name}) => name === "multiple ordered replacements")
	//.filter(({name}) => name === "delete then replace")
	testCases.forEach(({ name, original, diff, expected, isFinal, shouldThrow, v1Only }) => {
		it(`should handle ${name} case correctly`, async () => {
			if (shouldThrow) {
				try {
					await cnfc(diff, original, isFinal ?? true)
					expect.fail("Expected an error to be thrown")
				} catch (err) {
					expect(err).to.be.an("error")
				}

				try {
					await cnfc2(diff, original, isFinal ?? true)
					expect.fail("Expected an error to be thrown")
				} catch (err) {
					expect(err).to.be.an("error")
				}
			} else {
				const result1 = await cnfc(diff, original, isFinal ?? true)

				// Verify result matches expected
				expect(result1.newContent).to.equal(expected)

				if (!v1Only) {
					const result2 = await cnfc2(diff, original, isFinal ?? true)
					// Verify both implementations produce same result
					expect(result1.newContent).to.equal(result2)
				}
			}
		})
	})

	it("should reject empty search conflict in v1 while v2 replaces the whole file", async () => {
		const original = "any content"
		const diff = `------- SEARCH
=======
inserted
+++++++ REPLACE`

		try {
			await cnfc(diff, original, true)
			expect.fail("Expected an error to be thrown")
		} catch (err) {
			expect(err).to.be.an("error")
		}

		const result2 = await cnfc2(diff, original, true)
		expect(result2).to.equal("inserted\n")
	})

	it("should handle mixed line endings", async () => {
		const original = "line1\r\nline2"
		const diff = `------- SEARCH
line1\r
=======
line1
+++++++ REPLACE`

		const result1 = await cnfc(diff, original, true)
		const result2 = await cnfc2(diff, original, true)

		expect(result1.newContent).to.equal("line1\nline2")
		expect(result2).to.equal("line1\nline2")
	})

	it("should handle special characters in search content", async () => {
		const original = "text with $^.*\nend"
		const diff = `------- SEARCH
$^.*
=======
replaced
+++++++ REPLACE`

		const result1 = await cnfc(diff, original, true)
		const result2 = await cnfc2(diff, original, true)

		expect(result1.newContent).to.equal("text with replaced\nend")
		expect(result2).to.equal("text with replaced\nend")
	})

	it("should handle nested marker text inside search content", async () => {
		const original = `text with $^.*\n--- SEARCH\nend`
		const diff = `------- SEARCH
$^.*
=======
replaced
+++++++ REPLACE

------- SEARCH
--- SEARCH
=======
before
+++++++ REPLACE`

		const result1 = await cnfc(diff, original, true)
		const result2 = await cnfc2(diff, original, true)

		expect(result1.newContent).to.equal("text with replaced\nbefore\nend")
		expect(result2).to.equal("text with replaced\nbefore\nend")
	})

	it("should handle long text with multiple search-replace blocks", async () => {
		const original = `This is a long text with multiple sections.
Section 1: Lorem ipsum dolor sit amet
Section 2: consectetur adipiscing elit
Section 3: sed do eiusmod tempor
Section 4: incididunt ut labore
Section 5: et dolore magna aliqua`
		const diff = `------- SEARCH
Section 1: Lorem ipsum dolor sit amet
=======
Section 1: Replaced text
+++++++ REPLACE

------- SEARCH
Section 3: sed do eiusmod tempor
=======
Section 3: Modified content
+++++++ REPLACE

------- SEARCH
Section 5: et dolore magna aliqua
=======
Section 5: Final replacement
+++++++ REPLACE`
		const expected = `This is a long text with multiple sections.
Section 1: Replaced text
Section 2: consectetur adipiscing elit
Section 3: Modified content
Section 4: incididunt ut labore
Section 5: Final replacement
`

		const result1 = await cnfc(diff, original, true)
		const result2 = await cnfc2(diff, original, true)

		expect(result1.newContent).to.equal(expected)
		expect(result2).to.equal(expected)
	})

	it("should reject short search markers", async () => {
		const original = "text with $^.*\n--- SEARCH\nend"
		const diff = `--- SEARCH
$^.*
=======
replaced
+++++++ REPLACE`

		try {
			await cnfc(diff, original, true)
			expect.fail("Expected an error to be thrown")
		} catch (err) {
			expect(err).to.be.an("error")
		}

		try {
			await cnfc2(diff, original, true)
			expect.fail("Expected an error to be thrown")
		} catch (err) {
			expect(err).to.be.an("error")
		}
	})

	it("should throw error when no match found", async () => {
		const original = "line1\nline2\nline3"
		const diff = `------- SEARCH
non-existent
=======
replaced
+++++++ REPLACE`

		try {
			await cnfc(diff, original, true)
			expect.fail("Expected an error to be thrown")
		} catch (err) {
			expect(err).to.be.an("error")
		}

		try {
			await cnfc2(diff, original, true)
			expect.fail("Expected an error to be thrown")
		} catch (err) {
			expect(err).to.be.an("error")
		}
	})

	it("should throw error when missing final REPLACE marker and isFinal is true", async () => {
		const original = "line1\nline2\nline3"
		const diff = `------- SEARCH
line2
=======
replaced`
		// Note: missing +++++++ REPLACE marker — must throw UNCLOSED_REPLACE

		try {
			await cnfc(diff, original, true)
			expect.fail("Expected an error to be thrown")
		} catch (err) {
			expect(err).to.be.an("error")
		}
	})

	it("should throw error when missing final REPLACE marker with multiple lines", async () => {
		const original = "function test() {\n\tconst a = 1;\n\treturn a;\n}"
		const diff = `------- SEARCH
	const a = 1;
	return a;
=======
	const a = 42;
	console.log('updated');
	return a;`
		// Note: missing +++++++ REPLACE marker — must throw UNCLOSED_REPLACE

		try {
			await cnfc(diff, original, true)
			expect.fail("Expected an error to be thrown")
		} catch (err) {
			expect(err).to.be.an("error")
		}
	})

	// 	it("should NOT process incomplete replacement when isFinal is false", async () => {
	// 		const original = "line1\nline2\nline3"
	// 		const diff = `------- SEARCH
	// line2
	// =======
	// replaced`
	// 		// Note: missing +++++++ REPLACE marker AND isFinal = false

	// 		const result1 = await cnfc(diff, original, false) // isFinal = false

	// 		// Should not make any changes since the block is incomplete
	// 		const expected = "line1\nline2\nline3"

	// 		expect(result1).to.equal(expected)
	// 	})
})

// Test cases for out-of-order search/replace blocks

describe("Diff Format Out of Order Cases", () => {
	it("should reject out-of-order replacements with different positions", async () => {
		const isFinal = true
		const original = "first\nsecond\nthird\nfourth\n"
		const diff = `------- SEARCH
fourth
=======
new fourth
+++++++ REPLACE
------- SEARCH
second
=======
new second
+++++++ REPLACE`
		try {
			await cnfc(diff, original, isFinal)
			expect.fail("Expected an error to be thrown for out-of-order blocks")
		} catch (err) {
			expect(err).to.be.an("error")
		}
	})

	it("should reject multiple out-of-order replacements", async () => {
		const isFinal = true
		const original = "one\ntwo\nthree\nfour\nfive\n"
		const diff = `------- SEARCH
four
=======
fourth
+++++++ REPLACE
------- SEARCH
two
=======
second
+++++++ REPLACE
------- SEARCH
five
=======
fifth
+++++++ REPLACE`
		try {
			await cnfc(diff, original, isFinal)
			expect.fail("Expected an error to be thrown for out-of-order blocks")
		} catch (err) {
			expect(err).to.be.an("error")
		}
	})

	it("should reject out-of-order replacements with indentation", async () => {
		const isFinal = true
		const original = "function test() {\n\tconst a = 1;\n\tconst b = 2;\n\tconst c = 3;\n\n}"
		const diff = `------- SEARCH
	const c = 3;
=======
	const c = 30;
+++++++ REPLACE
------- SEARCH
	const a = 1;
=======
	const a = 10;
+++++++ REPLACE`
		try {
			await cnfc(diff, original, isFinal)
			expect.fail("Expected an error to be thrown for out-of-order blocks")
		} catch (err) {
			expect(err).to.be.an("error")
		}
	})

	it("should reject out-of-order replacements with empty lines", async () => {
		const isFinal = true
		const original = "header\n\nbody\n\nfooter\n"
		const diff = `------- SEARCH
footer
=======
new footer
+++++++ REPLACE
------- SEARCH

body

=======
new body content
+++++++ REPLACE`
		try {
			await cnfc(diff, original, isFinal)
			expect.fail("Expected an error to be thrown for out-of-order blocks")
		} catch (err) {
			expect(err).to.be.an("error")
		}
	})
})
