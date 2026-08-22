import { envFlagEnabled } from "../env"

/**
 * Simple Logger utility for the extension's backend code.
 *
 * Log level can be controlled via DLINE_LOG_LEVEL environment variable:
 *   - "error": only errors
 *   - "warn": errors + warnings
 *   - "info": errors + warnings + info + log (default)
 *   - "debug": all above + debug
 *   - "trace": all above + trace
 *
 * Migration can be skipped via DLINE_SKIP_MIGRATION=1.
 */
const SENSITIVE_LOG_KEYS = new Set([
	"authorization",
	"proxyauthorization",
	"apikey",
	"xapikey",
	"accesstoken",
	"refreshtoken",
	"idtoken",
	"clientsecret",
	"password",
	"cookie",
	"setcookie",
	"secret",
	"token",
])

const AUTHORIZATION_VALUE_PATTERN = /\b(?:Bearer|Basic)\s+[^\s"'}]+/gi

function redactLogString(value: string): string {
	return value.replace(AUTHORIZATION_VALUE_PATTERN, (match) => `${match.slice(0, match.indexOf(" ") + 1)}[REDACTED]`)
}

function isSensitiveLogKey(key: string): boolean {
	return SENSITIVE_LOG_KEYS.has(key.toLowerCase().replaceAll("-", "").replaceAll("_", ""))
}

function redactLogValue(value: unknown, seen = new WeakSet<object>()): unknown {
	if (typeof value === "string") return redactLogString(value)
	if (value === null || typeof value !== "object") return value
	if (seen.has(value)) return "[Circular]"
	seen.add(value)

	if (Array.isArray(value)) return value.map((item) => redactLogValue(item, seen))

	const result: Record<string, unknown> = {}
	if (value instanceof Error) {
		result.name = redactLogString(value.name)
		result.message = redactLogString(value.message)
		if (value.stack) result.stack = redactLogString(value.stack)
	}
	for (const key of Object.keys(value)) {
		result[key] = isSensitiveLogKey(key) ? "[REDACTED]" : redactLogValue(value[key as keyof typeof value], seen)
	}
	return result
}

export class Logger {
	/** Runtime log level, read once at module load. Defaults to "info". */
	private static readonly logLevel = Logger.readLogLevel()

	/** Whether migration should be skipped. Read from SKIP_MIGRATION or DLINE_SKIP_MIGRATION. */
	static readonly skipMigration = process.env.DLINE_SKIP_MIGRATION === "1"

	private static subscribers: Set<(msg: string) => void> = new Set()

	private static readLogLevel(): "error" | "warn" | "info" | "debug" | "trace" {
		const raw = process.env.DLINE_LOG_LEVEL?.toLowerCase()
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

	static isDebugEnabled(): boolean {
		return Logger.logLevel === "debug" || Logger.logLevel === "trace"
	}

	static debug(message: string, ...args: any[]) {
		if (!Logger.isDebugEnabled()) return
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
			let fullMessage = `${timestamp} [${level.toLowerCase()}] ${redactLogString(message)}`
			if (args.length > 0) {
				fullMessage += ` ${args
					.map((arg) => {
						try {
							return JSON.stringify(redactLogValue(arg))
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
