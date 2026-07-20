const DEFAULT_COMMAND_TIMEOUT_SECONDS = 30
const LONG_RUNNING_COMMAND_TIMEOUT_SECONDS = 300

const LONG_RUNNING_COMMAND_PATTERNS: readonly RegExp[] = [
	/\b(npm|pnpm|yarn|bun)\s+(install|ci|build|test)\b/i,
	/\b(npm|pnpm|yarn|bun)\s+run\s+(build|test|lint|typecheck|check)\b/i,
	/\b(pip|pip3|uv)\s+install\b/i,
	/\b(poetry|pipenv)\s+install\b/i,
	/\b(cargo|go|mvn|gradle|gradlew)\s+(build|test|check|install)\b/i,
	/\b(make|cmake|ctest)\b/i,
	/\b(pytest|tox|nox|jest|vitest|mocha)\b/i,
	/\b(docker|podman)\s+build\b/i,
	/\b(torchrun|deepspeed|accelerate\s+launch)\b/i,
	/\bffmpeg\b/i,
	/\bpython(?:\d+(?:\.\d+)?)?\s+.*\b(train|finetune)\b/i,
]

export interface CommandToolExecutionOptions {
	background: boolean
	timeoutSeconds: number
}

export function isLikelyLongRunningCommand(command: string): boolean {
	const normalized = command.trim().replace(/\s+/g, " ")
	return LONG_RUNNING_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function resolveCommandTimeoutSeconds(command: string, timeoutParam: string | undefined): number {
	if (timeoutParam && /^\d+$/.test(timeoutParam)) {
		const parsed = Number(timeoutParam)
		if (Number.isSafeInteger(parsed) && parsed > 0) {
			return parsed
		}
	}

	return isLikelyLongRunningCommand(command) ? LONG_RUNNING_COMMAND_TIMEOUT_SECONDS : DEFAULT_COMMAND_TIMEOUT_SECONDS
}

export function parseCommandExecutionOptions(
	command: string,
	backgroundParam: string | undefined,
	timeoutParam: string | undefined,
): CommandToolExecutionOptions {
	return {
		background: backgroundParam === "true",
		timeoutSeconds: resolveCommandTimeoutSeconds(command, timeoutParam),
	}
}
