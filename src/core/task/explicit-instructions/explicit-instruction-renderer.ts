import type { ExplicitInstructionAuthorization } from "./types"

const OPENING_TAG = /<explicit_instructions\b([^>]*)>/

export function renderRegisteredExplicitInstruction(
	template: string,
	authorization: Pick<ExplicitInstructionAuthorization, "instructionId" | "type">,
): string {
	const match = OPENING_TAG.exec(template)
	if (!match) throw new Error("Explicit instruction template is missing an opening tag.")
	const typePattern = new RegExp(`\\btype=["']${escapeRegExp(authorization.type)}["']`)
	if (!typePattern.test(match[0])) {
		throw new Error(`Explicit instruction template type does not match '${authorization.type}'.`)
	}
	if (/\binstruction_id=/.test(match[0])) {
		throw new Error("Explicit instruction template already contains an instruction ID.")
	}
	const replacement = `<explicit_instructions${match[1]} instruction_id="${authorization.instructionId}">`
	return template.slice(0, match.index) + replacement + template.slice(match.index + match[0].length)
}

export function extractRegisteredInstructionId(template: string): string | undefined {
	const match = OPENING_TAG.exec(template)
	if (!match) return undefined
	return /\binstruction_id=["']([^"']+)["']/.exec(match[0])?.[1]
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
