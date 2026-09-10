import { TELEMETRY_MASK_VALUE } from "../../service/pipeline-port"
import { type RuntimeEventRecorderPort, runtimeEventRecorder } from "../runtime"

export type ErrorMessageLevel = "error" | "warning" | "log" | "debug" | "info"

/** Standard error Event recorder shared by ErrorService and the Logger bridge. */
export class ErrorEventRecorder {
	constructor(private readonly runtime: RuntimeEventRecorderPort = runtimeEventRecorder) {}

	exception(error: unknown, properties?: Readonly<Record<string, unknown>>): void {
		this.runtime.record({
			name: "extension.error",
			level: "error",
			error,
			attributes: {
				exception_message: TELEMETRY_MASK_VALUE,
				...properties,
			},
		})
	}

	message(message: string, level: ErrorMessageLevel = "log", properties?: Readonly<Record<string, unknown>>): void {
		this.runtime.record({
			name: "extension.message",
			level: level === "error" || level === "warning" ? "error" : level === "debug" ? "debug" : "info",
			attributes: {
				message: TELEMETRY_MASK_VALUE,
				message_level: level,
				...properties,
			},
		})
	}
}

export const errorEventRecorder = new ErrorEventRecorder()
