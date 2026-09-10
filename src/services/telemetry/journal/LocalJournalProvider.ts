import { randomBytes } from "node:crypto"
import type {
	JournalTelemetryCapability,
	JournalTelemetrySignal,
	TelemetryChannel,
	TelemetryProviderRegistration,
	TelemetrySpanHandle,
	TelemetrySpanStartOptions,
	TraceTelemetryCapability,
} from "../providers/capabilities"
import type { TelemetryProperties, TelemetrySettings } from "../providers/ITelemetryProvider"
import { RuntimeContentPolicy } from "../runtime/content-policy"
import { type CanonicalTelemetryProperties, canonicalizeTelemetryProperties } from "../service/canonicalization"
import { type JournalRecoveryFact, JsonlJournalWriter, type JsonlJournalWriterStats } from "./jsonl-journal-writer"
import { projectEvent, projectMetric, projectTrace } from "./otlp-json-projectors"

export interface LocalJournalProviderOptions {
	readonly directory: string
	readonly sessionId: string
	readonly maxBytes?: number
	readonly flushIntervalMs?: number
	readonly fingerprintKey?: Buffer
}

/** Local-first owner for canonical usage events, metrics and trace projections. */
export class LocalJournalProvider {
	readonly name = "LocalJournalProvider"
	private readonly writer: JsonlJournalWriter
	private readonly policy: RuntimeContentPolicy
	private readonly sessionId: string
	private readonly sequence = { usage: 0, metrics: 0, traces: 0 }
	private recoveryFacts: readonly JournalRecoveryFact[] = []
	private disposed = false

	private constructor(options: LocalJournalProviderOptions) {
		this.sessionId = options.sessionId
		this.writer = new JsonlJournalWriter(options)
		this.policy = new RuntimeContentPolicy(options.fingerprintKey)
	}

	static async create(options: LocalJournalProviderOptions): Promise<LocalJournalProvider> {
		const provider = new LocalJournalProvider(options)
		const recovered = await provider.writer.recover()
		provider.recoveryFacts = recovered.facts
		Object.assign(provider.sequence, recovered.lastSequences)
		return provider
	}

	get paths(): JsonlJournalWriter["paths"] {
		return this.writer.paths
	}

	get stats(): JsonlJournalWriterStats {
		return this.writer.stats
	}

	isEnabled(): boolean {
		return !this.disposed
	}

	getSettings(): TelemetrySettings {
		return { hostEnabled: !this.disposed, level: this.disposed ? "off" : "all" }
	}

	append(signal: JournalTelemetrySignal): void {
		if (this.disposed) return
		this.flushRecoveryFacts(signal.channel)
		const source = signal.kind === "event" ? signal.properties : signal.attributes
		const canonical = canonicalizeTelemetryProperties(source, this.policy)
		if (signal.kind === "event") {
			const sequence = ++this.sequence.usage
			this.writer.append(
				"usage",
				projectEvent(signal, canonical, {
					sessionId: this.sessionId,
					sequence,
					channel: signal.channel,
					signalKind: "event",
					contentPolicy: canonical.contentPolicy,
				}),
			)
			return
		}
		const sequence = ++this.sequence.metrics
		this.writer.append(
			"metrics",
			projectMetric(signal, canonical, {
				sessionId: this.sessionId,
				sequence,
				channel: signal.channel,
				signalKind: "metric",
				contentPolicy: canonical.contentPolicy,
			}),
		)
	}

	startSpan(options: TelemetrySpanStartOptions): TelemetrySpanHandle {
		if (this.disposed) return INERT_SPAN
		return new LocalJournalSpanHandle(this, options)
	}

	writeSpan(span: LocalJournalSpanRecord): void {
		if (this.disposed) return
		this.flushRecoveryFacts("runtime")
		const canonical = canonicalizeTelemetryProperties(span.attributes, this.policy)
		const sequence = ++this.sequence.traces
		this.writer.append(
			"traces",
			projectTrace(
				{
					...span,
					attributes: canonical.attributes,
					errorFingerprint: span.errorType ? this.policy.fingerprint(span.errorType) : undefined,
				},
				{
					sessionId: this.sessionId,
					sequence,
					channel: "runtime",
					signalKind: "trace",
					contentPolicy: canonical.contentPolicy,
				},
			),
		)
	}

	async forceFlush(): Promise<void> {
		await this.writer.flush()
	}

	async dispose(): Promise<void> {
		if (this.disposed) return
		await this.writer.dispose()
		this.disposed = true
		this.policy.reset()
	}

	private flushRecoveryFacts(channel: TelemetryChannel): void {
		const facts = this.recoveryFacts
		this.recoveryFacts = []
		for (const fact of facts) this.appendRecoveryFact(fact, channel)
	}

	private appendRecoveryFact(fact: JournalRecoveryFact, channel: TelemetryChannel): void {
		const canonical: CanonicalTelemetryProperties = {
			attributes: {
				file: fact.file,
				...(fact.expected === undefined ? {} : { expected: fact.expected }),
				...(fact.observed === undefined ? {} : { observed: fact.observed }),
			},
			contentPolicy: { rejectedCount: 0, rejections: {} },
		}
		const sequence = ++this.sequence.usage
		this.writer.append(
			"usage",
			projectEvent({ kind: "event", channel, severity: "warn", name: fact.kind, required: false }, canonical, {
				sessionId: this.sessionId,
				sequence,
				channel,
				signalKind: "event",
				contentPolicy: canonical.contentPolicy,
			}),
		)
	}
}

export function createLocalJournalRegistration(provider: LocalJournalProvider): TelemetryProviderRegistration {
	const journal: JournalTelemetryCapability = { kind: "journal", append: (signal) => provider.append(signal) }
	const trace: TraceTelemetryCapability = { kind: "trace", startSpan: (options) => provider.startSpan(options) }
	return {
		kind: "registration",
		base: provider,
		sink: { kind: "journal", origin: "default", channels: ["usage", "error", "runtime"] },
		capabilities: [journal, trace],
	}
}

interface LocalJournalSpanRecord {
	readonly name: string
	readonly traceId: string
	readonly spanId: string
	readonly parentSpanId?: string
	readonly startTime: number
	readonly endTime: number
	readonly outcome: "success" | "failure" | "cancelled"
	readonly attributes: TelemetryProperties
	readonly errorType?: string
}

class LocalJournalSpanHandle implements TelemetrySpanHandle {
	readonly active = true
	readonly traceId: string
	readonly spanId = randomBytes(8).toString("hex")
	private readonly attributes: TelemetryProperties
	private readonly startedAt: number
	private errorType: string | undefined
	private ended = false

	constructor(
		private readonly owner: LocalJournalProvider,
		private readonly options: TelemetrySpanStartOptions,
	) {
		const parent = options.parent instanceof LocalJournalSpanHandle ? options.parent : undefined
		this.traceId = parent?.traceId ?? randomBytes(16).toString("hex")
		this.attributes = { ...options.attributes }
		this.startedAt = epochMilliseconds(options.startTime)
	}

	setAttribute(name: string, value: string | number | boolean): void {
		if (!this.ended) this.attributes[name] = value
	}

	recordException(error: unknown): void {
		if (this.ended) return
		this.errorType = error instanceof Error ? error.name : typeof error
	}

	end(outcome: "success" | "failure" | "cancelled" = "success", endTime?: number): void {
		if (this.ended) return
		this.ended = true
		const parent = this.options.parent instanceof LocalJournalSpanHandle ? this.options.parent : undefined
		this.owner.writeSpan({
			name: this.options.name,
			traceId: this.traceId,
			spanId: this.spanId,
			parentSpanId: parent?.spanId,
			startTime: this.startedAt,
			endTime: epochMilliseconds(endTime),
			outcome,
			attributes: this.attributes,
			errorType: this.errorType,
		})
	}
}

function epochMilliseconds(value?: number): number {
	if (value === undefined) return Date.now()
	return value >= 1_000_000_000_000 ? value : Date.now() - performance.now() + value
}

const INERT_SPAN: TelemetrySpanHandle = Object.freeze({
	active: false,
	setAttribute(): void {},
	recordException(): void {},
	end(): void {},
})
