import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

const taskSourcePath = path.resolve("src/core/task/index.ts")

function extractMethod(source: string, startMarker: string, endMarker: string): string {
	const start = source.indexOf(startMarker)
	const end = source.indexOf(endMarker, start)
	if (start < 0 || end < 0) {
		throw new Error(`Unable to locate Task request boundary: ${startMarker}`)
	}
	return source.slice(start, end)
}

describe("Task request API boundary", () => {
	it("captures the API scope before the first request-local await", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "async recursivelyMakeClineRequests(", "async loadContext(")
		const scopeIndex = method.indexOf("const requestScope = createRequestApiScope(")
		const firstAwaitIndex = method.indexOf("await ")

		expect(scopeIndex).toBeGreaterThanOrEqual(0)
		expect(firstAwaitIndex).toBeGreaterThan(scopeIndex)
	})

	it("does not read the mutable handler after creating the request scope", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "async recursivelyMakeClineRequests(", "async loadContext(")
		const scopeIndex = method.indexOf("const requestScope = createRequestApiScope(")
		const scopeEndIndex = method.indexOf("\n\t\t)\n", scopeIndex)
		const requestBody = method.slice(scopeEndIndex + "\n\t\t)\n".length)

		expect(scopeEndIndex).toBeGreaterThan(scopeIndex)
		expect(requestBody).not.toMatch(/\bthis\.api\b/)
	})

	it("routes provider operations in attemptApiRequest through the frozen scope", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "async *attemptApiRequest(", "// Block identity is now assigned")

		expect(method).toContain("const { api, providerInfo } = requestScope")
		expect(method).toContain("api.createMessage(")
		expect(method).toContain("api.parseError?.(")
		expect(method).not.toMatch(/\bthis\.api\b/)
		expect(method).not.toContain("this.getCurrentProviderInfo()")
	})
})
