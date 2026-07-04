import { envFlagEnabled } from "../env"

/**
 * Simple Logger utility for the extension's backend code.
 *
 * Log level can be controlled via CLINE_LOG_LEVEL environment variable:
 *   - "error": only errors
 *   - "warn": errors + warnings
 *   - "info": errors + warnings + info + log (default)
 *   - "debug": all above + debug
 *   - "trace": all above + trace
 *
 * Migration can be skipped via DLINE_SKIP_MIGRATION=1.
 */
export class Logger {
	/** Runtime log level, read once at module load. Defaults to "info". */
	private static readonly logLevel = Logger.readLogLevel()

	/** Whether migration should be skipped. Read from SKIP_MIGRATION or DLINE_SKIP_MIGRATION. */
	static readonly skipMigration = process.env.DLINE_SKIP_MIGRATION === "1"

	private static subscribers: Set<(msg: string) => void> = new Set()

	private static readLogLevel(): "error" | "warn" | "info" | "debug" | "trace" {
		const raw = process.env.CLINE_LOG_LEVEL?.toLowerCase()
		if (raw === "debug" || raw === "trace") {
			return raw
		}
		// Backward compatibility: IS_DEV=true enables debug level
		if (envFlagEnabled(process.env.IS_DEV)) {
			return "debug"
		}
		return "info"
	}

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
		Logger.#output("ERROR", message, args)
	}

	static warn(message: string, ...args: any[]) {
		Logger.#output("WARN", message, args)
	}

	static log(message: string, ...args: any[]) {
		Logger.#output("LOG", message, args)
	}

	static debug(message: string, ...args: any[]) {
		if (Logger.logLevel !== "debug" && Logger.logLevel !== "trace") return
		Logger.#output("DEBUG", message, args)
	}

	static info(message: string, ...args: any[]) {
		Logger.#output("INFO", message, args)
	}

	static trace(message: string, ...args: any[]) {
		if (Logger.logLevel !== "trace") return
		Logger.#output("TRACE", message, args)
	}

	static #output(level: string, message: string, args: any[]) {
		try {
			const now = new Date()
			const pad = (value: number, length = 2) => value.toString().padStart(length, "0")
			const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`
			let fullMessage = `${timestamp} [${level.toLowerCase()}] ${message}`
			if (args.length > 0) {
				fullMessage += ` ${args
					.map((arg) => {
						try {
							return JSON.stringify(arg)
						} catch {
							return String(arg)
						}
					})
					.join(" ")}`
			}
			Logger.output(fullMessage)
		} catch {
			// do nothing if Logger fails
		}
	}
}
