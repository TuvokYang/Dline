import { SpanStatusCode } from "@opentelemetry/api"
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node"
import { afterEach, describe, expect, it } from "vitest"
import { OpenTelemetryTraceProvider } from "../OpenTelemetryTraceProvider"

const providers: OpenTelemetryTraceProvider[] = []

afterEach(async () => {
	await Promise.all(providers.splice(0).map((provider) => provider.dispose()))
})

describe("OpenTelemetryTraceProvider", () => {
	it("creates real spans with attributes, status, and exceptions", async () => {
		const exporter = new InMemorySpanExporter()
		const provider = new OpenTelemetryTraceProvider("http://127.0.0.1:4318", {
			processor: new SimpleSpanProcessor(exporter),
		})
		providers.push(provider)

		const span = provider.startSpan({ name: "tool.execution", attributes: { tool: "read_file" } })
		span.recordException(new Error("failed"))
		span.end("failure")
		await provider.forceFlush()

		const [record] = exporter.getFinishedSpans()
		expect(record.name).toBe("tool.execution")
		expect(record.attributes).toMatchObject({ tool: "read_file", outcome: "failure" })
		expect(record.status.code).toBe(SpanStatusCode.ERROR)
		expect(record.events[0]?.name).toBe("exception")
	})

	it("marks cancelled operations without losing the span", async () => {
		const exporter = new InMemorySpanExporter()
		const provider = new OpenTelemetryTraceProvider("http://127.0.0.1:4318", {
			processor: new SimpleSpanProcessor(exporter),
		})
		providers.push(provider)

		provider.startSpan({ name: "tool.wait_for_approval" }).end("cancelled")
		await provider.forceFlush()

		const [record] = exporter.getFinishedSpans()
		expect(record.attributes.outcome).toBe("cancelled")
		expect(record.status).toMatchObject({ code: SpanStatusCode.ERROR, message: "cancelled" })
	})

	it("preserves explicit parent-child relationships", async () => {
		const exporter = new InMemorySpanExporter()
		const provider = new OpenTelemetryTraceProvider("http://127.0.0.1:4318", {
			processor: new SimpleSpanProcessor(exporter),
		})
		providers.push(provider)

		const parent = provider.startSpan({ name: "task.execute" })
		const child = provider.startSpan({ name: "tool.execution", parent })
		child.end("success")
		parent.end("success")
		await provider.forceFlush()

		const records = exporter.getFinishedSpans()
		const parentRecord = records.find((record) => record.name === "task.execute")
		const childRecord = records.find((record) => record.name === "tool.execution")
		expect(childRecord?.parentSpanId).toBe(parentRecord?.spanContext().spanId)
	})

	it.skipIf(process.env.DLINE_LIVE_OTEL_TEST !== "1")(
		"exports a live canary through the production OTLP trace provider",
		async () => {
			const provider = new OpenTelemetryTraceProvider("http://127.0.0.1:4318")
			providers.push(provider)

			provider
				.startSpan({
					name: "ws065.live.trace.canary",
					attributes: { workstream: "WS-065", verification: "live-tempo" },
				})
				.end("success")
			await provider.forceFlush()
		},
	)
})
