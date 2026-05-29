/**
 * Simple Logger utility for the extension's backend code.
 */
export class Logger {
	private static isVerbose = process.env.IS_DEV === "true"

	private static subscribers: Set<(msg: string) => void> = new Set()

	private static output(msg: string): void {
		for (const subscriber of Logger.subscribers) {
			try {
				subscriber(msg)
			} catch {
				// ignore errors from subscribers
			}
		}
	}

	/**
	 * Register a callback to receive log output messages.
	 */
	static subscribe(outputFn: (msg: string) => void) {
		Logger.subscribers.add(outputFn)
	}

	static error(message: string, ...args: any[]) {
		Logger.#output("ERROR", message, undefined, args)
	}

	static warn(message: string, ...args: any[]) {
		Logger.#output("WARN", message, undefined, args)
	}

	static log(message: string, ...args: any[]) {
		Logger.#output("LOG", message, undefined, args)
	}

	static debug(message: string, ...args: any[]) {
		if (!Logger.isVerbose) return
		Logger.#output("DEBUG", message, undefined, args)
	}

	static info(message: string, ...args: any[]) {
		Logger.#output("INFO", message, undefined, args)
	}

	static trace(message: string, ...args: any[]) {
		if (!Logger.isVerbose) return
		Logger.#output("TRACE", message, undefined, args)
	}

	static #output(level: string, message: string, error: Error | undefined, args: any[]) {
		try {
			const now = new Date()
			const pad = (value: number, length = 2) => value.toString().padStart(length, "0")
			const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`
			let fullMessage = `${timestamp} [${level.toLowerCase()}] ${message}`
			if (Logger.isVerbose && args.length > 0) {
				fullMessage += ` ${args.map((arg) => JSON.stringify(arg)).join(" ")}`
			}
			const errorSuffix = error?.message ? ` ${error.message}` : ""
			Logger.output(`${fullMessage}${errorSuffix}`.trimEnd())
		} catch {
			// do nothing if Logger fails
		}
	}
}
