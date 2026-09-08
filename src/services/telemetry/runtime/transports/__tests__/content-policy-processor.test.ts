import { InMemoryLogRecordExporter, LoggerProvider, SimpleLogRecordProcessor } from "@opentelemetry/sdk-logs"
import { describe, expect, it } from "vitest"
import { runtimeContentPolicyLimits } from "../../content-policy"
import { ContentPolicyProcessor } from "../content-policy-processor"

/**
 * The privacy contract must survive the move to the official SDK. Moving export
 * to a standard exporter is only safe if redaction still happens before a
 * record can leave the process, so these tests drive the processor through a
 * real logger pipeline rather than calling it directly.
 */

function emitWith(attributes: Record<string, unknown>): InMemoryLogRecordExporter {
	const exporter = new InMemoryLogRecordExporter()
	const provider = new LoggerProvider()
	// Registration order mirrors production: redact, then export.
	provider.addLogRecordProcessor(new ContentPolicyProcessor())
	provider.addLogRecordProcessor(new SimpleLogRecordProcessor(exporter))

	provider.getLogger("test").emit({
		body: "task.phase",
		attributes: attributes as never,
	})
	return exporter
}

describe("ContentPolicyProcessor", () => {
	it("drops attributes whose names always denote user or tool content", () => {
		const exporter = emitWith({
			command: "rm -rf /",
			prompt: "my secret prompt",
			stdout: "sensitive output",
			durationMs: 12,
		})

		const { attributes } = exporter.getFinishedLogRecords()[0]
		expect(attributes).not.toHaveProperty("command")
		expect(attributes).not.toHaveProperty("prompt")
		expect(attributes).not.toHaveProperty("stdout")
		expect(attributes.durationMs).toBe(12)
	})

	it("rejects rather than truncates an over-long value", () => {
		// A truncated command line is still a command line.
		const exporter = emitWith({ note: "x".repeat(runtimeContentPolicyLimits.MAX_ATTRIBUTE_LENGTH + 1) })

		expect(exporter.getFinishedLogRecords()[0].attributes).not.toHaveProperty("note")
	})

	it("keeps a value that sits exactly on the length limit", () => {
		const value = "x".repeat(runtimeContentPolicyLimits.MAX_ATTRIBUTE_LENGTH)
		const exporter = emitWith({ note: value })

		expect(exporter.getFinishedLogRecords()[0].attributes.note).toBe(value)
	})

	it("caps how many attributes one record may carry", () => {
		const attributes: Record<string, unknown> = {}
		for (let index = 0; index < runtimeContentPolicyLimits.MAX_ATTRIBUTE_COUNT + 10; index++) {
			attributes[`key${index}`] = index
		}

		const record = emitWith(attributes).getFinishedLogRecords()[0]
		expect(Object.keys(record.attributes)).toHaveLength(runtimeContentPolicyLimits.MAX_ATTRIBUTE_COUNT)
	})

	it("rejects nested objects that could smuggle a request body through", () => {
		const exporter = emitWith({ payload: { nested: "value" }, component: "terminal" })

		const { attributes } = exporter.getFinishedLogRecords()[0]
		expect(attributes).not.toHaveProperty("payload")
		expect(attributes.component).toBe("terminal")
	})

	it("leaves a record with no attributes untouched", () => {
		const exporter = emitWith({})

		expect(exporter.getFinishedLogRecords()[0].attributes).toEqual({})
	})
})
