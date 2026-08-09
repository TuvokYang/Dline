import type { ClineDefaultTool } from "@shared/tools"
import { renderRegisteredExplicitInstruction } from "./explicit-instruction-renderer"
import { getExplicitInstructionPolicy } from "./policy"
import type { ExplicitInstructionRegistry } from "./ExplicitInstructionRegistry"
import type {
	ConsumeExplicitInstructionResult,
	ExplicitInstructionAuthorization,
	ExplicitInstructionConsumePort,
	ExplicitInstructionDeclaration,
	ExplicitInstructionRequestIdentity,
} from "./types"

const INSTRUCTION_ID_ATTRIBUTE = /\binstruction_id=["']([^"']+)["']/g

/**
 * Owns all explicit instruction authority for one logical API request.
 * Provider retries advance the attempt identity without transferring old authority.
 */
export class ExplicitInstructionRequestScope {
	private identity: ExplicitInstructionRequestIdentity
	private readonly currentInstructionIds = new Set<string>()
	private readonly replacements = new Map<string, string>()
	private closed = false

	constructor(
		private readonly registry: ExplicitInstructionRegistry,
		identity: ExplicitInstructionRequestIdentity,
	) {
		this.identity = Object.freeze({ ...identity })
	}

	register(declaration: ExplicitInstructionDeclaration): ExplicitInstructionAuthorization {
		this.assertOpen()
		const authorization = this.registry.register({
			...this.identity,
			...declaration,
		})
		this.currentInstructionIds.add(authorization.instructionId)
		return authorization
	}

	registerAndRender(
		template: string,
		declaration: ExplicitInstructionDeclaration,
	): { readonly text: string; readonly authorization: ExplicitInstructionAuthorization } {
		const authorization = this.register(declaration)
		return Object.freeze({
			text: renderRegisteredExplicitInstruction(template, authorization),
			authorization,
		})
	}

	createConsumePort(): ExplicitInstructionConsumePort {
		const identity = Object.freeze({ ...this.identity })
		return Object.freeze({
			identity,
			consumeTool: (targetTool: ClineDefaultTool): ConsumeExplicitInstructionResult =>
				this.registry.consumeTool({ ...identity, targetTool }),
		})
	}

	consumeBehaviorInstructions(): readonly ExplicitInstructionAuthorization[] {
		this.assertOpen()
		return this.registry.consumeBehaviorInstructions(this.identity)
	}

	/**
	 * Advance to a fresh provider attempt and re-register only retryable pending authority.
	 * The returned map allows request text to replace stale opaque instruction IDs.
	 */
	beginRetryAttempt(attemptId: string): ReadonlyMap<string, string> {
		this.assertOpen()
		if (!attemptId || attemptId === this.identity.attemptId) {
			throw new Error("Explicit instruction retry attempt must use a fresh identity.")
		}

		const previousIdentity = this.identity
		const nextInstructionIds = new Set<string>()
		const attemptReplacements = new Map<string, string>()

		for (const instructionId of this.currentInstructionIds) {
			const authorization = this.registry.get(instructionId)
			if (!authorization || authorization.state !== "pending") continue
			if (!getExplicitInstructionPolicy(authorization.type).allowRetry) continue

			const retry = this.registry.registerRetry(instructionId, attemptId)
			this.replacements.set(instructionId, retry.instructionId)
			attemptReplacements.set(instructionId, retry.instructionId)
			nextInstructionIds.add(retry.instructionId)
		}

		this.registry.expireAttempt(previousIdentity)
		this.currentInstructionIds.clear()
		for (const instructionId of nextInstructionIds) this.currentInstructionIds.add(instructionId)
		this.identity = Object.freeze({ requestId: previousIdentity.requestId, attemptId })
		return attemptReplacements
	}

	getCurrentAuthorization(instructionId: string): ExplicitInstructionAuthorization | undefined {
		let currentId = instructionId
		const visited = new Set<string>()
		while (!visited.has(currentId)) {
			visited.add(currentId)
			const replacement = this.replacements.get(currentId)
			if (!replacement) break
			currentId = replacement
		}
		return this.registry.get(currentId)
	}

	rewriteInstructionIds(text: string): string {
		return text.replace(INSTRUCTION_ID_ATTRIBUTE, (attribute, instructionId: string) => {
			const current = this.getCurrentAuthorization(instructionId)
			return current && current.instructionId !== instructionId
				? attribute.replace(instructionId, current.instructionId)
				: attribute
		})
	}

	close(): void {
		if (this.closed) return
		this.closed = true
		this.registry.closeRequest(this.identity.requestId)
	}

	cancel(): void {
		if (this.closed) return
		this.closed = true
		this.registry.cancelRequest(this.identity.requestId)
	}

	private assertOpen(): void {
		if (this.closed) throw new Error("Explicit instruction request scope is closed.")
	}
}
