import { Logger } from "@/shared/services/Logger"

type TimeoutLogger = Pick<typeof Logger, "error" | "warn">

/**
 * Bound best-effort cleanup work during task termination.
 *
 * The timeout timer is cleared when the cleanup promise settles first; otherwise
 * fast cleanups still log a stale timeout warning a few seconds later.
 */
export async function withTerminateTimeout<T>(
	promise: Promise<T>,
	ms: number,
	label: string,
	logger: TimeoutLogger = Logger,
): Promise<T | undefined> {
	let timeoutHandle: ReturnType<typeof setTimeout> | undefined

	try {
		return await Promise.race([
			promise,
			new Promise<undefined>((resolve) => {
				timeoutHandle = setTimeout(() => {
					timeoutHandle = undefined
					logger.warn(`[Terminate] ${label} timed out after ${ms}ms`)
					resolve(undefined)
				}, ms)
			}),
		])
	} catch (error) {
		logger.error(`[Terminate] ${label} failed:`, error)
		return undefined
	} finally {
		if (timeoutHandle) {
			clearTimeout(timeoutHandle)
		}
	}
}
