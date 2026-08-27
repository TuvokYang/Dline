import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

const continuationRoot = path.resolve("src/core/task/continuation")
const taskSourcePath = path.resolve("src/core/task/index.ts")
const resumeAdapterPath = path.resolve("src/core/task/resume/ResumeToolResult.ts")

async function source(name: string): Promise<string> {
	return readFile(path.join(continuationRoot, name), "utf8")
}

describe("tool turn continuation architecture", () => {
	it("keeps the generic assembler independent from Task, runtime, interaction, and resume layers", async () => {
		const assembler = await source("ToolTurnContentAssembler.ts")

		expect(assembler).not.toMatch(/from ["']\.\.\/(?:index|Task)/)
		expect(assembler).not.toMatch(/from ["']\.\.\/(?:runtime|interaction|resume)\//)
	})

	it("keeps mistake-limit policy above the generic assembler without reverse runtime dependencies", async () => {
		const continuation = await source("MistakeLimitContinuation.ts")

		expect(continuation).toContain('from "./ToolTurnContentAssembler"')
		expect(continuation).not.toMatch(/from ["']\.\.\/(?:index|Task)/)
		expect(continuation).not.toMatch(/from ["']\.\.\/(?:runtime|interaction|resume)\//)
	})

	it("keeps Task and Resume as thin consumers of the continuation boundary", async () => {
		const [taskSource, resumeAdapter] = await Promise.all([
			readFile(taskSourcePath, "utf8"),
			readFile(resumeAdapterPath, "utf8"),
		])

		expect(taskSource).toContain('from "./continuation/MistakeLimitContinuation"')
		expect(taskSource).toContain("buildMistakeLimitContinuationContent({")
		expect(taskSource).not.toContain("function buildMistakeLimitFeedbackContent(")
		expect(resumeAdapter).toContain('from "../continuation/ToolTurnContentAssembler"')
		expect(resumeAdapter).toContain("collectResumeTurnContent = assembleToolTurnContent")
	})
})
