import { context, type Span, SpanStatusCode, type Tracer, trace } from "@opentelemetry/api"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { BatchSpanProcessor, NodeTracerProvider, type SpanProcessor } from "@opentelemetry/sdk-trace-node"
import { createTelemetryResource } from "../../otel/telemetry-resource"
import type { TelemetrySpanHandle, TelemetrySpanStartOptions, TraceTelemetryCapability } from "../capabilities"
import type { TelemetryProperties } from "../ITelemetryProvider"

const TRACE_SCOPE_NAME = "dline.runtime"

/** Real OTLP trace capability using the v1 tracing island exported by sdk-trace-node. */
export class OpenTelemetryTraceProvider implements TraceTelemetryCapability {
	readonly kind = "trace" as const
	private readonly provider: NodeTracerProvider
	private readonly tracer: Tracer

	constructor(endpoint: string, options: { readonly processor?: SpanProcessor } = {}) {
		const processor = options.processor ?? createBatchProcessor(endpoint)
		this.provider = new NodeTracerProvider({
			resource: createTelemetryResource(),
			spanProcessors: [processor],
		})
		this.tracer = this.provider.getTracer(TRACE_SCOPE_NAME)
	}

	startSpan(options: TelemetrySpanStartOptions): TelemetrySpanHandle {
		const parent = options.parent instanceof OpenTelemetrySpanHandle ? options.parent.span : undefined
		const parentContext = parent ? trace.setSpan(context.active(), parent) : context.active()
		const span = this.tracer.startSpan(
			options.name,
			{ attributes: primitiveAttributes(options.attributes), startTime: options.startTime },
			parentContext,
		)
		return new OpenTelemetrySpanHandle(span)
	}

	async forceFlush(): Promise<void> {
		await this.provider.forceFlush()
	}

	async dispose(): Promise<void> {
		await this.provider.shutdown()
	}
}

class OpenTelemetrySpanHandle implements TelemetrySpanHandle {
	readonly active = true
	private ended = false

	constructor(readonly span: Span) {}

	setAttribute(name: string, value: string | number | boolean): void {
		if (!this.ended) this.span.setAttribute(name, value)
	}

	recordException(error: unknown): void {
		if (this.ended) return
		this.span.recordException(error instanceof Error ? error : new Error(String(error)))
	}

	end(outcome: "success" | "failure" | "cancelled" = "success", endTime?: number): void {
		if (this.ended) return
		this.ended = true
		this.span.setAttribute("outcome", outcome)
		this.span.setStatus({
			code: outcome === "success" ? SpanStatusCode.OK : SpanStatusCode.ERROR,
			message: outcome === "cancelled" ? "cancelled" : undefined,
		})
		this.span.end(endTime)
	}
}

function createBatchProcessor(endpoint: string): SpanProcessor {
	const url = new URL(endpoint)
	const normalized = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname
	if (!normalized.endsWith("/v1/traces")) url.pathname = `${normalized}/v1/traces`
	return new BatchSpanProcessor(new OTLPTraceExporter({ url: url.toString() }))
}

function primitiveAttributes(properties?: TelemetryProperties): Record<string, string | number | boolean> | undefined {
	if (!properties) return undefined
	const attributes: Record<string, string | number | boolean> = {}
	for (const [key, value] of Object.entries(properties)) {
		if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") attributes[key] = value
	}
	return attributes
}
