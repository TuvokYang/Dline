import { readFileSync } from "node:fs"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { interpretBuildId, readBuildIdentity, UNKNOWN_BUILD_ID } from "../build-identity"

describe("interpretBuildId", () => {
	it("reports the id stamped by the build", () => {
		expect(interpretBuildId("a1b2c3d")).toEqual({
			buildId: "a1b2c3d",
			symbolicatable: true,
		})
	})

	it("reports unknown when the build did not stamp an id", () => {
		// Guessing an id would let a maintainer decode a stack trace with the
		// wrong map and get confidently wrong file names.
		expect(interpretBuildId(undefined)).toEqual({
			buildId: UNKNOWN_BUILD_ID,
			symbolicatable: false,
		})
	})

	it("treats a blank id as unknown", () => {
		expect(interpretBuildId("   ").symbolicatable).toBe(false)
	})

	it("does not claim a dev build is symbolicatable", () => {
		// A dev build is readable because it is not minified, but no archived
		// map corresponds to it.
		expect(interpretBuildId("dev")).toEqual({
			buildId: "dev",
			symbolicatable: false,
		})
	})
})

describe("readBuildIdentity", () => {
	const original = process.env.DLINE_BUILD_ID

	afterEach(() => {
		if (original === undefined) delete process.env.DLINE_BUILD_ID
		else process.env.DLINE_BUILD_ID = original
	})

	it("reads the value at the substitution site", () => {
		process.env.DLINE_BUILD_ID = "stamped-id"
		expect(readBuildIdentity()).toEqual({ buildId: "stamped-id", symbolicatable: true })
	})

	it("reads the exact expression esbuild substitutes", () => {
		// esbuild `define` replaces the literal expression
		// `process.env.DLINE_BUILD_ID`. Capturing `process.env` into a
		// variable first would compile to a real lookup in the shipped bundle
		// and every released build would report `unknown`.
		const source = readFileSync(path.join(__dirname, "..", "build-identity.ts"), "utf8")
		const runtimeRead = source.slice(source.indexOf("export function readBuildIdentity"))

		expect(runtimeRead).toContain("process.env.DLINE_BUILD_ID")
		expect(runtimeRead).not.toMatch(/=\s*process\.env\b/)
	})
})
