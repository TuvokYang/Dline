import { ClineDefaultTool } from "@shared/tools"
import { describe, expect, it } from "vitest"
import { ExplicitInstructionRegistry } from "../ExplicitInstructionRegistry"
import { ExplicitInstructionRequestScope } from "../ExplicitInstructionRequestScope"
import { renderRegisteredExplicitInstruction } from "../explicit-instruction-renderer"

const FIRST_ATTEMPT = { requestId: "request-1", attemptId: "attempt-1" } as const

function registerSummary(scope: ExplicitInstructionRequestScope) {
	return scope.register({
		type: "summarize_task",
		source: "auto_compaction",
		targetTool: ClineDefaultTool.SUMMARIZE_TASK,
	})
}

describe("ExplicitInstructionRequestScope", () => {
	it("binds registrations and consumption to one request attempt snapshot", () => {
		const registry = new ExplicitInstructionRegistry()
		const scope = new ExplicitInstructionRequestScope(registry, FIRST_ATTEMPT)
		const authorization = registerSummary(scope)
		const port = scope.createConsumePort()

		expect(authorization).toMatchObject(FIRST_ATTEMPT)
		expect(port.identity).toEqual(FIRST_ATTEMPT)
		expect(port.consumeTool(ClineDefaultTool.SUMMARIZE_TASK)).toEqual({
			ok: true,
			authorization: expect.objectContaining({
				instructionId: authorization.instructionId,
				state: "consumed",
			}),
		})
		expect(port.consumeTool(ClineDefaultTool.SUMMARIZE_TASK)).toEqual({
			ok: false,
			code: "explicit_instruction_already_consumed",
		})
	})

	it("keeps an old attempt port invalid after retry rollover", () => {
		const registry = new ExplicitInstructionRegistry()
		const scope = new ExplicitInstructionRequestScope(registry, FIRST_ATTEMPT)
		const first = registerSummary(scope)
		const oldPort = scope.createConsumePort()
		const replacements = scope.beginRetryAttempt("attempt-2")
		const current = scope.getCurrentAuthorization(first.instructionId)
		const currentPort = scope.createConsumePort()

		expect(replacements.get(first.instructionId)).toBe(current?.instructionId)
		expect(current).toMatchObject({ requestId: "request-1", attemptId: "attempt-2", state: "pending" })
		expect(oldPort.consumeTool(ClineDefaultTool.SUMMARIZE_TASK)).toEqual({
			ok: false,
			code: "explicit_instruction_expired",
		})
		expect(currentPort.consumeTool(ClineDefaultTool.SUMMARIZE_TASK).ok).toBe(true)
	})

	it("rewrites registered instruction IDs for the active retry attempt", () => {
		const registry = new ExplicitInstructionRegistry()
		const scope = new ExplicitInstructionRequestScope(registry, FIRST_ATTEMPT)
		const first = registerSummary(scope)
		const rendered = renderRegisteredExplicitInstruction(
			'<explicit_instructions type="summarize_task">Call summarize_task.</explicit_instructions>',
			first,
		)

		scope.beginRetryAttempt("attempt-2")
		const current = scope.getCurrentAuthorization(first.instructionId)
		const rewritten = scope.rewriteInstructionIds(rendered)

		expect(rewritten).toContain(`instruction_id="${current?.instructionId}"`)
		expect(rewritten).not.toContain(`instruction_id="${first.instructionId}"`)
	})

	it("expires pending authority when the request closes", () => {
		const registry = new ExplicitInstructionRegistry()
		const scope = new ExplicitInstructionRequestScope(registry, FIRST_ATTEMPT)
		registerSummary(scope)
		const port = scope.createConsumePort()

		scope.close()

		expect(port.consumeTool(ClineDefaultTool.SUMMARIZE_TASK)).toEqual({
			ok: false,
			code: "explicit_instruction_expired",
		})
		expect(() => registerSummary(scope)).toThrow("Explicit instruction request scope is closed")
	})

	it("consumes request-bound behavior instructions without granting a tool", () => {
		const registry = new ExplicitInstructionRegistry()
		const scope = new ExplicitInstructionRequestScope(registry, FIRST_ATTEMPT)
		const skill = scope.register({
			type: "skill",
			source: "skill_injection",
			metadata: { name: "reviewer" },
		})

		expect(scope.consumeBehaviorInstructions()).toEqual([
			expect.objectContaining({ instructionId: skill.instructionId, state: "consumed" }),
		])
		expect(scope.createConsumePort().consumeTool(ClineDefaultTool.SUMMARIZE_TASK)).toEqual({
			ok: false,
			code: "explicit_instruction_missing",
		})
	})
})
