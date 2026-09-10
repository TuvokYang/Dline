import { Logger, type StructuredLogRecord } from "@/shared/services/Logger"
import { TELEMETRY_MASK_VALUE } from "../../service/pipeline-port"
import { type ErrorEventRecorder, errorEventRecorder } from "./ErrorEventRecorder"

/** Connect Logger warn/error records to the standard error Event recorder without recursion. */
export function installLoggerTelemetryBridge(recorder: ErrorEventRecorder = errorEventRecorder): () => void {
	let publishing = false
	return Logger.subscribeStructured((record: StructuredLogRecord) => {
		if (publishing) return
		publishing = true
		try {
			const metadata = {
				logger_message: TELEMETRY_MASK_VALUE,
				logger_level: record.level,
				logger_metadata: record.metadata,
			}
			if (record.error) recorder.exception(record.error, metadata)
			else recorder.message(record.message, record.level === "warn" ? "warning" : "error", metadata)
		} finally {
			publishing = false
		}
	})
}
