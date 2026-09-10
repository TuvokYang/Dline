import { afterEach, describe, expect, it, vi } from "vitest"
import { Logger } from "@/shared/services/Logger"
import { TELEMETRY_MASK_VALUE } from "../../runtime/content-policy"
import type { RuntimeEventRecorderPort } from "../runtime"
import { ErrorEventRecorder } from "./ErrorEventRecorder"
import { installLoggerTelemetryBridge } from "./LoggerTelemetryBridge"

function harness() {
	const record = vi.fn<RuntimeEventRecorderPort["record"]>()
	return { record, recorder: new ErrorEventRecorder({ record }) }
}

describe("ErrorEventRecorder", () => {
	afterEach(() => vi.restoreAllMocks())

	it("uses one normalized runtime event contract for exceptions and messages", () => {
		const { record, recorder } = harness()
		const error = new Error("provider failed")

		recorder.exception(error, { modelId: "gpt-test", nested: { secret: true } })
		recorder.message("request failed", "warning", { status: 503 })

		expect(record).toHaveBeenNthCalledWith(1, {
			name: "extension.error",
			level: "error",
			error,
			attributes: {
				exception_message: TELEMETRY_MASK_VALUE,
				modelId: "gpt-test",
				nested: { secret: true },
			},
		})
		expect(record).toHaveBeenNthCalledWith(2, {
			name: "extension.message",
			level: "error",
			attributes: { message: TELEMETRY_MASK_VALUE, message_level: "warning", status: 503 },
		})
	})

	it("bridges only structured warn/error records and ignores internal diagnostics", () => {
		const { record, recorder } = harness()
		const dispose = installLoggerTelemetryBridge(recorder)
		vi.spyOn(Logger as unknown as { output: (message: string) => void }, "output").mockImplementation(() => undefined)

		Logger.warn("collector unavailable", {
			status: 503,
			provider: "openai-codex",
			modelId: "gpt-5.3-codex",
			snapshot: { status: "failed", count: 2 },
		})
		Logger.error("provider failed", new Error("private failure prose"), {
			provider: "openai-codex",
			apiFormat: "openai-responses",
		})
		Logger.internalError("exporter feedback", new Error("failed again"))
		Logger.info("ordinary output")
		dispose()

		expect(record).toHaveBeenCalledTimes(2)
		expect(record).toHaveBeenNthCalledWith(1, {
			name: "extension.message",
			level: "error",
			attributes: expect.objectContaining({
				message: TELEMETRY_MASK_VALUE,
				message_level: "warning",
				logger_message: TELEMETRY_MASK_VALUE,
				logger_metadata: [
					{
						status: 503,
						provider: "openai-codex",
						modelId: "gpt-5.3-codex",
						snapshot: { status: "failed", count: 2 },
					},
				],
			}),
		})
		expect(record).toHaveBeenNthCalledWith(2, {
			name: "extension.error",
			level: "error",
			error: expect.any(Error),
			attributes: expect.objectContaining({
				exception_message: TELEMETRY_MASK_VALUE,
				logger_message: TELEMETRY_MASK_VALUE,
				logger_metadata: [{ provider: "openai-codex", apiFormat: "openai-responses" }],
			}),
		})
	})
})
