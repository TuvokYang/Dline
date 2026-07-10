import { setTimeout as setTimeoutPromise } from "node:timers/promises"

export const MAX_AUTO_RETRY_ATTEMPTS = 3

export interface StreamRetryInput {
	isSpendLimitError: boolean
	autoRetryAttempts: number
}

export interface StreamRetryDecision {
	shouldRetry: boolean
	shouldPrompt: boolean
}

export interface DelayedStreamRetryInput {
	delay: number
	isAborted: () => boolean
	isCurrentTask: () => boolean
	resume: () => Promise<void>
}

/**
 * Calculate the exponential auto-retry delay in milliseconds.
 * @param attempt One-based retry attempt count.
 * @returns Delay duration in milliseconds.
 */
export function getRetryDelay(attempt: number): number {
	return 2000 * 2 ** (attempt - 1)
}

/**
 * Wait for the auto-retry backoff and report whether retry may continue.
 * @param delay Delay duration in milliseconds.
 * @param isAborted Callback that reports whether the task was aborted.
 * @returns True when retry may continue, false when cancellation won.
 */
export async function waitRetryDelay(delay: number, isAborted: () => boolean): Promise<boolean> {
	await setTimeoutPromise(delay)
	return !isAborted()
}

/**
 * Run delayed stream retry only when cancellation and task identity still allow it.
 * @param input Delayed retry callbacks and delay configuration.
 * @returns True when resume ran, false when retry was suppressed.
 */
export async function runDelayedStreamRetry(input: DelayedStreamRetryInput): Promise<boolean> {
	const shouldRetry = await waitRetryDelay(input.delay, input.isAborted)
	if (!shouldRetry || !input.isCurrentTask()) {
		return false
	}

	await input.resume()
	return true
}

/**
 * Decide whether a streaming failure should retry or prompt the user.
 * @param input Streaming retry state and error classification.
 * @returns Retry decision for streaming failure recovery.
 */
export function getStreamRetryDecision(input: StreamRetryInput): StreamRetryDecision {
	if (input.isSpendLimitError) {
		return { shouldRetry: false, shouldPrompt: false }
	}

	if (input.autoRetryAttempts < MAX_AUTO_RETRY_ATTEMPTS) {
		return { shouldRetry: true, shouldPrompt: false }
	}

	return { shouldRetry: false, shouldPrompt: true }
}
