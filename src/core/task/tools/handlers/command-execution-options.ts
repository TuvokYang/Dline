export interface CommandToolExecutionOptions {
	background: boolean
	synchronous: boolean
	timeoutSeconds: number | undefined
}

export function resolveCommandTimeoutSeconds(timeoutParam: string | undefined): number | undefined {
	if (timeoutParam && /^\d+$/.test(timeoutParam)) {
		const parsed = Number(timeoutParam)
		if (Number.isSafeInteger(parsed) && parsed > 0) {
			return parsed
		}
	}

	return undefined
}

export function parseCommandExecutionOptions(
	_command: string,
	backgroundParam: string | undefined,
	timeoutParam: string | undefined,
	synchronousParam?: string | undefined,
): CommandToolExecutionOptions {
	const background = backgroundParam === "true"
	return {
		background,
		synchronous: !background && synchronousParam === "true",
		timeoutSeconds: resolveCommandTimeoutSeconds(timeoutParam),
	}
}
