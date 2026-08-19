import { createReadStream } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { performance } from "node:perf_hooks"
import readline from "node:readline"
import { ensureTaskDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { Logger } from "@shared/services/Logger"
import { compactApiRateMetrics } from "./api-rate-metrics-aggregator"
import {
	API_RATE_METRICS_SCHEMA_VERSION,
	type ApiRateMetricsDataRecord,
	ApiRateMetricsFileIntegrityError,
	ApiRateMetricsHardLimitError,
	type ApiRateMetricsMetaRecord,
	type ApiRateMetricsReadResult,
	type ApiRateMetricsRecovery,
	type ApiRateMetricsRepository,
	type ApiRateRollupRecord,
	type ApiRateSecondRecord,
	type ApiRateSignal,
	type ApiRateTokenQuality,
	getApiRateSecondActivitySeconds,
} from "./api-rate-metrics-types"

interface TaskApiRateMetricsRepositoryOptions {
	taskId: string
	filePath?: string
	now?: () => number
	compactionThresholdBytes?: number
	hardLimitBytes?: number
}

interface ParsedMetricsFile extends ApiRateMetricsReadResult {
	meta: ApiRateMetricsMetaRecord
}

const SIGNALS = new Set<ApiRateSignal>(["task_active", "provider_active", "request_start", "stream_tokens", "exact_usage"])
const TOKEN_QUALITIES = new Set<ApiRateTokenQuality>(["estimated", "mixed", "exact"])
const RESOLUTIONS = new Set(["minute", "hour", "day"])
const MAX_RECENT_ACTIVE_SECONDS = 60
const TAIL_READ_CHUNK_BYTES = 64 * 1_024
const DEFAULT_COMPACTION_THRESHOLD_BYTES = 32 * 1_024 * 1_024
const DEFAULT_HARD_LIMIT_BYTES = 64 * 1_024 * 1_024

/** Owns append-only API rate metrics persistence for one Task. */
export class TaskApiRateMetricsRepository implements ApiRateMetricsRepository {
	private readonly now: () => number
	private readonly compactionThresholdBytes: number
	private readonly hardLimitBytes: number
	private resolvedFilePath: string | undefined
	private meta: ApiRateMetricsMetaRecord | undefined
	private initialization: Promise<ApiRateMetricsRecovery> | undefined
	private writeSequence: Promise<void> = Promise.resolve()

	constructor(private readonly options: TaskApiRateMetricsRepositoryOptions) {
		this.now = options.now ?? Date.now
		this.compactionThresholdBytes = options.compactionThresholdBytes ?? DEFAULT_COMPACTION_THRESHOLD_BYTES
		this.hardLimitBytes = options.hardLimitBytes ?? DEFAULT_HARD_LIMIT_BYTES
	}

	initialize(): Promise<ApiRateMetricsRecovery> {
		this.initialization ??= this.initializeInternal()
		return this.initialization
	}

	async append(records: readonly ApiRateMetricsDataRecord[]): Promise<void> {
		if (records.length === 0) return
		await this.initialize()
		const filePath = await this.getFilePath()
		const payload = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`
		const payloadBytes = Buffer.byteLength(payload)
		const queuedAt = performance.now()
		return this.enqueueWrite(async () => {
			const startedAt = performance.now()
			const stat = await fs.stat(filePath)
			this.assertWithinHardLimit(stat.size + payloadBytes, "append")
			await fs.appendFile(filePath, payload, "utf8")
			Logger.debug(
				`[Task ${this.options.taskId}] API rate metrics append: queueWaitMs=${Math.round(startedAt - queuedAt)}, writeMs=${Math.round(performance.now() - startedAt)}, records=${records.length}, bytes=${Buffer.byteLength(payload)}`,
			)
		})
	}

	async readAll(): Promise<ApiRateMetricsReadResult> {
		await this.initialize()
		await this.waitForWrites()
		const startedAt = performance.now()
		const { meta: _meta, ...result } = await this.readFile()
		Logger.debug(
			`[Task ${this.options.taskId}] API rate metrics scan: durationMs=${Math.round(performance.now() - startedAt)}, fileBytes=${result.fileBytes}, lines=${result.lineCount}, records=${result.records.length}, degraded=${result.degraded}`,
		)
		return result
	}

	async replaceAll(records: readonly ApiRateMetricsDataRecord[]): Promise<void> {
		await this.initialize()
		const filePath = await this.getFilePath()
		const meta = this.requireMeta()
		const payload = `${[meta, ...records].map((record) => JSON.stringify(record)).join("\n")}\n`
		const payloadBytes = Buffer.byteLength(payload)
		const queuedAt = performance.now()
		return this.enqueueWrite(async () => {
			const startedAt = performance.now()
			this.assertWithinHardLimit(payloadBytes, "replace")
			const tempPath = `${filePath}.tmp.${this.now()}.${Math.random().toString(36).slice(2)}`
			try {
				await fs.writeFile(tempPath, payload, "utf8")
				await fs.rename(tempPath, filePath)
				Logger.debug(
					`[Task ${this.options.taskId}] API rate metrics replace: queueWaitMs=${Math.round(startedAt - queuedAt)}, writeMs=${Math.round(performance.now() - startedAt)}, records=${records.length}, bytes=${Buffer.byteLength(payload)}`,
				)
			} catch (error) {
				await fs.rm(tempPath, { force: true }).catch(() => undefined)
				throw error
			}
		})
	}

	async compactIfNeeded(nowSecond: number): Promise<boolean> {
		await this.initialize()
		await this.waitForWrites()
		const filePath = await this.getFilePath()
		const stat = await fs.stat(filePath)
		if (stat.size < this.compactionThresholdBytes) return false
		const startedAt = performance.now()
		const read = await this.readAll()
		const compacted = compactApiRateMetrics(read.records, nowSecond)
		await this.replaceAll(compacted)
		Logger.debug(
			`[Task ${this.options.taskId}] API rate metrics compaction: durationMs=${Math.round(performance.now() - startedAt)}, beforeBytes=${stat.size}, beforeRecords=${read.records.length}, afterRecords=${compacted.length}`,
		)
		return true
	}

	async waitForWrites(): Promise<void> {
		await this.writeSequence
	}

	async getFilePath(): Promise<string> {
		if (this.resolvedFilePath) return this.resolvedFilePath
		if (this.options.filePath) {
			this.resolvedFilePath = this.options.filePath
		} else {
			const taskDirectory = await ensureTaskDirectoryExists(this.options.taskId)
			this.resolvedFilePath = path.join(taskDirectory, GlobalFileNames.taskApiRateMetrics)
		}
		return this.resolvedFilePath
	}

	private async initializeInternal(): Promise<ApiRateMetricsRecovery> {
		const startedAt = performance.now()
		const filePath = await this.getFilePath()
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		await this.ensureFileExists(filePath)
		const stat = await fs.stat(filePath)
		this.meta = await this.readMeta(filePath, stat.size)
		const tail = await this.readRecentSecondRecords(filePath, stat.size)
		const recentRecords = tail.records
		const activity = recentRecords.reduce(
			(total, record) => {
				const current = getApiRateSecondActivitySeconds(record.signals)
				return {
					activeSeconds: total.activeSeconds + current.activeSeconds,
					providerActiveSeconds: total.providerActiveSeconds + current.providerActiveSeconds,
				}
			},
			{ activeSeconds: 0, providerActiveSeconds: 0 },
		)
		const activeSeconds = activity.activeSeconds
		const requestCount = recentRecords.reduce((total, record) => total + record.requestCount, 0)
		const tokenCount = recentRecords.reduce((total, record) => total + record.effectiveTokens, 0)
		const lastRecord = recentRecords.at(-1)
		const recovery: ApiRateMetricsRecovery = {
			activeSeconds,
			requestCount,
			tokenCount,
			lastActiveSecond: lastRecord?.second,
			snapshot:
				activeSeconds > 0
					? {
							activeSeconds,
							requestsPerMinute: extrapolatePerMinute(requestCount, activeSeconds),
							tokensPerMinute: extrapolatePerMinute(tokenCount, activity.providerActiveSeconds),
						}
					: {},
			degraded: tail.degraded,
			lastRecord,
			recentRecords,
		}
		Logger.debug(
			`[Task ${this.options.taskId}] API rate metrics initialize: durationMs=${Math.round(performance.now() - startedAt)}, fileBytes=${stat.size}, scannedBytes=${tail.scannedBytes}, scannedLines=${tail.scannedLines}, activeSeconds=${activeSeconds}, degraded=${tail.degraded}`,
		)
		return recovery
	}

	private async ensureFileExists(filePath: string): Promise<void> {
		try {
			const stat = await fs.stat(filePath)
			if (stat.size > 0) return
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
		}
		const meta: ApiRateMetricsMetaRecord = {
			schemaVersion: API_RATE_METRICS_SCHEMA_VERSION,
			kind: "meta",
			taskId: this.options.taskId,
			createdAt: this.now(),
		}
		await fs.writeFile(filePath, `${JSON.stringify(meta)}\n`, "utf8")
	}

	private async readMeta(filePath: string, fileSize: number): Promise<ApiRateMetricsMetaRecord> {
		const handle = await fs.open(filePath, "r")
		try {
			const buffer = Buffer.alloc(Math.min(Math.max(fileSize, 1), TAIL_READ_CHUNK_BYTES))
			const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
			const firstLine = buffer.subarray(0, bytesRead).toString("utf8").split(/\r?\n/, 1)[0]
			let parsed: unknown
			try {
				parsed = JSON.parse(firstLine)
			} catch {
				throw new ApiRateMetricsFileIntegrityError(`Invalid API rate metrics metadata for Task ${this.options.taskId}`)
			}
			const meta = sanitizeMeta(parsed)
			if (!meta) {
				throw new ApiRateMetricsFileIntegrityError(`Invalid API rate metrics metadata for Task ${this.options.taskId}`)
			}
			if (meta.taskId !== this.options.taskId) {
				throw new ApiRateMetricsFileIntegrityError(
					`API rate metrics Task mismatch: expected ${this.options.taskId}, received ${meta.taskId}`,
				)
			}
			return meta
		} finally {
			await handle.close()
		}
	}

	private async readRecentSecondRecords(
		filePath: string,
		fileSize: number,
	): Promise<{ records: ApiRateSecondRecord[]; degraded: boolean; scannedBytes: number; scannedLines: number }> {
		const handle = await fs.open(filePath, "r")
		const canonicalBySecond = new Map<number, ApiRateSecondRecord>()
		let position = fileSize
		let carry = ""
		let degraded = false
		let scannedBytes = 0
		let scannedLines = 0
		let isTailLine = true
		const trailingNewline = await this.hasTrailingNewline(filePath, fileSize)

		const processLine = (line: string): void => {
			if (line.trim().length === 0) return
			scannedLines += 1
			let parsed: unknown
			try {
				parsed = JSON.parse(line)
			} catch {
				if (isTailLine && !trailingNewline) return
				degraded = true
				return
			} finally {
				isTailLine = false
			}
			const record = sanitizeDataRecord(parsed)
			if (!record) {
				if (!sanitizeMeta(parsed)) degraded = true
				return
			}
			if (record.kind === "second" && !canonicalBySecond.has(record.second)) {
				canonicalBySecond.set(record.second, record)
			}
		}

		try {
			while (position > 0 && canonicalBySecond.size < MAX_RECENT_ACTIVE_SECONDS) {
				const readSize = Math.min(TAIL_READ_CHUNK_BYTES, position)
				position -= readSize
				const buffer = Buffer.allocUnsafe(readSize)
				const { bytesRead } = await handle.read(buffer, 0, readSize, position)
				scannedBytes += bytesRead
				const lines = `${buffer.subarray(0, bytesRead).toString("utf8")}${carry}`.split(/\r?\n/)
				carry = lines.shift() ?? ""
				for (let index = lines.length - 1; index >= 0 && canonicalBySecond.size < MAX_RECENT_ACTIVE_SECONDS; index -= 1) {
					processLine(lines[index])
				}
			}
			if (position === 0 && canonicalBySecond.size < MAX_RECENT_ACTIVE_SECONDS) processLine(carry)
		} finally {
			await handle.close()
		}

		return {
			records: [...canonicalBySecond.values()].sort((left, right) => left.second - right.second),
			degraded,
			scannedBytes,
			scannedLines,
		}
	}

	private async readFile(): Promise<ParsedMetricsFile> {
		const filePath = await this.getFilePath()
		const stat = await fs.stat(filePath)
		const trailingNewline = await this.hasTrailingNewline(filePath, stat.size)
		const input = createReadStream(filePath, { encoding: "utf8" })
		const lines = readline.createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY })
		let pendingLine: string | undefined
		let lineCount = 0
		let degraded = false
		let meta: ApiRateMetricsMetaRecord | undefined
		const records: ApiRateMetricsDataRecord[] = []

		const processLine = (line: string, isLast: boolean): void => {
			if (line.trim().length === 0) return
			lineCount += 1
			let parsed: unknown
			try {
				parsed = JSON.parse(line)
			} catch {
				if (isLast && !trailingNewline) return
				degraded = true
				return
			}
			if (!meta) {
				const candidate = sanitizeMeta(parsed)
				if (!candidate) {
					throw new ApiRateMetricsFileIntegrityError(
						`Invalid API rate metrics metadata for Task ${this.options.taskId}`,
					)
				}
				if (candidate.taskId !== this.options.taskId) {
					throw new ApiRateMetricsFileIntegrityError(
						`API rate metrics Task mismatch: expected ${this.options.taskId}, received ${candidate.taskId}`,
					)
				}
				meta = candidate
				return
			}
			const record = sanitizeDataRecord(parsed)
			if (record) records.push(record)
			else degraded = true
		}

		for await (const line of lines) {
			if (pendingLine !== undefined) processLine(pendingLine, false)
			pendingLine = line
		}
		if (pendingLine !== undefined) processLine(pendingLine, true)
		if (!meta) throw new ApiRateMetricsFileIntegrityError(`Missing API rate metrics metadata for Task ${this.options.taskId}`)
		return { meta, records, degraded, fileBytes: stat.size, lineCount }
	}

	private async hasTrailingNewline(filePath: string, size: number): Promise<boolean> {
		if (size === 0) return false
		const handle = await fs.open(filePath, "r")
		try {
			const byte = Buffer.allocUnsafe(1)
			await handle.read(byte, 0, 1, size - 1)
			return byte[0] === 10
		} finally {
			await handle.close()
		}
	}

	private enqueueWrite(operation: () => Promise<void>): Promise<void> {
		const queued = this.writeSequence.then(operation)
		this.writeSequence = queued.catch(() => undefined)
		return queued
	}

	private assertWithinHardLimit(projectedBytes: number, operation: "append" | "replace"): void {
		if (projectedBytes <= this.hardLimitBytes) return
		throw new ApiRateMetricsHardLimitError(
			`API rate metrics hard limit exceeded for Task ${this.options.taskId}: operation=${operation}, projectedBytes=${projectedBytes}, hardLimitBytes=${this.hardLimitBytes}`,
		)
	}

	private requireMeta(): ApiRateMetricsMetaRecord {
		if (!this.meta) throw new Error(`API rate metrics repository is not initialized for Task ${this.options.taskId}`)
		return this.meta
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value)
}

function isNonNegativeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0
}

function sanitizeMeta(value: unknown): ApiRateMetricsMetaRecord | undefined {
	if (!isRecord(value)) return undefined
	if (value.schemaVersion !== API_RATE_METRICS_SCHEMA_VERSION || value.kind !== "meta") return undefined
	if (typeof value.taskId !== "string" || !isFiniteNumber(value.createdAt)) return undefined
	return value as unknown as ApiRateMetricsMetaRecord
}

function sanitizeDataRecord(value: unknown): ApiRateMetricsDataRecord | undefined {
	if (!isRecord(value) || value.schemaVersion !== API_RATE_METRICS_SCHEMA_VERSION) return undefined
	if (value.kind === "second") return sanitizeSecondRecord(value)
	if (value.kind === "rollup") return sanitizeRollupRecord(value)
	return undefined
}

function sanitizeSecondRecord(value: Record<string, unknown>): ApiRateSecondRecord | undefined {
	if (!isNonNegativeInteger(value.second) || !isNonNegativeInteger(value.revision)) return undefined
	if (!Array.isArray(value.signals) || !value.signals.every((signal) => SIGNALS.has(signal as ApiRateSignal))) return undefined
	if (
		!isNonNegativeInteger(value.requestCount) ||
		!isNonNegativeInteger(value.estimatedTokens) ||
		!isNonNegativeInteger(value.effectiveTokens) ||
		!TOKEN_QUALITIES.has(value.tokenQuality as ApiRateTokenQuality) ||
		!isNonNegativeInteger(value.runningActiveSeconds) ||
		(value.runningProviderActiveSeconds !== undefined && !isNonNegativeInteger(value.runningProviderActiveSeconds)) ||
		!isNonNegativeInteger(value.runningRequestCount) ||
		!isNonNegativeInteger(value.runningTokenCount) ||
		!isNonNegativeInteger(value.requestsPerMinute) ||
		!isNonNegativeInteger(value.tokensPerMinute)
	) {
		return undefined
	}
	return value as unknown as ApiRateSecondRecord
}

function extrapolatePerMinute(value: number, activeSeconds: number): number {
	return activeSeconds > 0 ? Math.round((value * 60) / activeSeconds) : 0
}

function sanitizeRollupRecord(value: Record<string, unknown>): ApiRateRollupRecord | undefined {
	if (!RESOLUTIONS.has(value.resolution as string)) return undefined
	if (
		!isNonNegativeInteger(value.bucketStartSecond) ||
		!isNonNegativeInteger(value.bucketSeconds) ||
		!isNonNegativeInteger(value.activeSeconds) ||
		(value.providerActiveSeconds !== undefined && !isNonNegativeInteger(value.providerActiveSeconds)) ||
		!isNonNegativeInteger(value.requestCount) ||
		!isNonNegativeInteger(value.tokenCount) ||
		!isNonNegativeInteger(value.requestsPerMinute) ||
		!isNonNegativeInteger(value.tokensPerMinute) ||
		!TOKEN_QUALITIES.has(value.tokenQuality as ApiRateTokenQuality)
	) {
		return undefined
	}
	return value as unknown as ApiRateRollupRecord
}
