import fs from "node:fs/promises"
import path from "node:path"
import { column, defineEntity, type EntitySchema, type StoredEntityClass } from "../api/EntitySchema"
import type {
	BufferedUnifyStore as BufferedUnifyStoreContract,
	UnifyStore,
	UnifyStoreBackend,
	UnifyStoreDatabase,
	UnifyStoreResult,
	UnifyStoreStats,
} from "../api/UnifyStore"
import { BufferedUnifyStore, type BufferedUnifyStoreOptions } from "../core/BufferedUnifyStore"
import { UnifyStoreCore, type UnifyStoreDriver, type UnifyStoreDriverTransaction } from "../core/UnifyStoreCore"
import { evaluateUnifyStoreQuery, type NormalizedUnifyStoreQuery } from "../core/UnifyStoreQueryEvaluator"
import { FileLock } from "./FileLock"
import { createSchemaJsonlRecordCodec, type JsonlRecordCodec } from "./JsonlRecordCodec"
import { appendJsonl, readJsonl, truncateJsonlTail, writeJsonl } from "./jsonl-utils"

interface JsonlSchemaMetadata {
	readonly schemaId: string
	readonly version: number
	readonly fingerprint: string
}

export class JsonlUnifyStoreBackend implements UnifyStoreBackend {
	async open(location: string): Promise<UnifyStoreDatabase> {
		await fs.mkdir(location, { recursive: true })
		return new JsonlUnifyStoreDatabase(location)
	}
}

interface BufferedJsonlRow {
	readonly ordinal: number
	readonly timestamp: number
	readonly payload: object
}

export interface OpenBufferedJsonlStoreOptions<TItem extends { ts: number }>
	extends Omit<BufferedUnifyStoreOptions<TItem>, "subscriptionKey"> {
	readonly schemaId: string
}

// biome-ignore lint/complexity/noStaticOnlyClass: Preserve the existing JsonlUnifyStore.openRaw namespace API.
export class JsonlUnifyStore {
	static async openRaw<TEntity extends object, TPersisted>(options: {
		filePath: string
		entity: StoredEntityClass<TEntity>
		codec: JsonlRecordCodec<TEntity, TPersisted>
		appendOnlyInsert?: boolean
		fileLock?: FileLock
	}): Promise<UnifyStore<TEntity>> {
		await fs.mkdir(path.dirname(options.filePath), { recursive: true })
		await fs.appendFile(options.filePath, "", "utf8")
		return createJsonlStore(
			options.entity.storage,
			options.filePath,
			options.codec,
			options.fileLock ?? new FileLock(),
			options.appendOnlyInsert,
		)
	}
}

export async function openBufferedJsonlStore<TItem extends { ts: number }>(
	filePath: string,
	options: OpenBufferedJsonlStoreOptions<TItem>,
): Promise<BufferedUnifyStoreContract<TItem>> {
	const RowEntity = createBufferedJsonlRowEntity(options.schemaId)
	const fileLock = new FileLock()
	const durableStore = await JsonlUnifyStore.openRaw({
		filePath,
		entity: RowEntity,
		appendOnlyInsert: true,
		fileLock,
		codec: {
			decode: (value, ordinal) => {
				if (!isTimestampedItem<TItem>(value)) throw new Error(`Invalid buffered JSONL item for ${options.schemaId}`)
				return new RowEntity(ordinal, value.ts, value)
			},
			encode: (row) => row.payload,
		},
	})
	return await BufferedUnifyStore.open({
		store: durableStore,
		mapping: {
			ordinal: RowEntity.storage.fields.ordinal,
			timestamp: RowEntity.storage.fields.timestamp,
			toItem: (row) => {
				if (!isTimestampedItem<TItem>(row.payload)) throw new Error(`Invalid buffered JSONL item for ${options.schemaId}`)
				return row.payload
			},
			toEntity: (item, ordinal) => new RowEntity(ordinal, item.ts, item),
		},
		bufferOptions: {
			...options,
			subscriptionKey: normalizeSubscriptionKey(filePath),
			truncateTail: (keepCount, expectedCount) =>
				fileLock.withLock(filePath, () => truncateJsonlTail(filePath, keepCount, expectedCount)),
		},
	})
}

class JsonlUnifyStoreDatabase implements UnifyStoreDatabase {
	private closed = false
	private closePromise: Promise<void> | undefined
	private readonly fileLock = new FileLock()

	constructor(private readonly directory: string) {}

	async hasStore<TEntity extends object>(entity: StoredEntityClass<TEntity>): Promise<boolean> {
		this.assertOpen()
		const paths = collectionPaths(this.directory, entity.storage.schemaId)
		return await this.fileLock.withLock(paths.data, async () => {
			this.assertOpen()
			const [hasData, hasMetadata] = await Promise.all([pathExists(paths.data), pathExists(paths.metadata)])
			if (!hasData && !hasMetadata) return false
			if (!hasData || !hasMetadata) throw new Error(`Incomplete JSONL entity store for ${entity.storage.schemaId}`)
			await validateSchemaMetadata(paths.metadata, entity.storage)
			return true
		})
	}

	async openStore<TEntity extends object>(entity: StoredEntityClass<TEntity>): Promise<UnifyStore<TEntity>> {
		this.assertOpen()
		const paths = collectionPaths(this.directory, entity.storage.schemaId)
		await this.fileLock.withLock(paths.data, async () => {
			this.assertOpen()
			await ensureSchemaMetadata(paths.metadata, entity.storage)
			await fs.appendFile(paths.data, "", "utf8")
		})
		return createJsonlStore(entity.storage, paths.data, createSchemaJsonlRecordCodec(entity.storage), this.fileLock)
	}

	close(): Promise<void> {
		this.closePromise ??= Promise.resolve().then(() => {
			this.closed = true
		})
		return this.closePromise
	}

	private assertOpen(): void {
		if (this.closed) throw new Error("JSONL UnifyStore database is closed")
	}
}

function createJsonlStore<TEntity extends object, TPersisted>(
	schema: EntitySchema<TEntity>,
	dataPath: string,
	codec: JsonlRecordCodec<TEntity, TPersisted>,
	fileLock = new FileLock(),
	appendOnlyInsert = false,
): UnifyStore<TEntity> {
	return new UnifyStoreCore(schema, new JsonlUnifyStoreDriver(schema, dataPath, codec, fileLock, appendOnlyInsert))
}

class JsonlUnifyStoreDriver<TEntity extends object, TPersisted> implements UnifyStoreDriver<TEntity> {
	private closed = false
	private closePromise: Promise<void> | undefined

	constructor(
		private readonly schema: EntitySchema<TEntity>,
		private readonly dataPath: string,
		private readonly codec: JsonlRecordCodec<TEntity, TPersisted>,
		private readonly fileLock: FileLock,
		private readonly appendOnlyInsert = false,
	) {}

	async query(query: NormalizedUnifyStoreQuery<TEntity>): Promise<UnifyStoreResult<TEntity>> {
		this.assertOpen()
		return await this.fileLock.withLock(this.dataPath, async () => {
			this.assertOpen()
			const records = await this.readRecords()
			return {
				records: evaluateUnifyStoreQuery(this.schema, records, query),
				stats: await createStats(this.dataPath, records.length),
			}
		})
	}

	async insert(records: readonly TEntity[]): Promise<void> {
		this.assertOpen()
		await this.fileLock.withLock(this.dataPath, async () => {
			this.assertOpen()
			if (this.appendOnlyInsert) {
				assertNoPrimaryConflicts(this.schema, [], records)
				await appendJsonl(
					this.dataPath,
					records.map((record) => this.codec.encode(record)),
				)
				return
			}
			const current = await this.readRecords()
			assertNoPrimaryConflicts(this.schema, current, records)
			await this.writeRecords([...current, ...records])
		})
	}

	async replaceAll(records: readonly TEntity[]): Promise<void> {
		this.assertOpen()
		await this.fileLock.withLock(this.dataPath, async () => {
			this.assertOpen()
			assertNoPrimaryConflicts(this.schema, [], records)
			await this.writeRecords(records)
		})
	}

	async transaction<TResult>(
		operation: (transaction: UnifyStoreDriverTransaction<TEntity>) => TResult | Promise<TResult>,
	): Promise<TResult> {
		this.assertOpen()
		return await this.fileLock.withLock(this.dataPath, async () => {
			this.assertOpen()
			let working = await this.readRecords()
			const transaction: UnifyStoreDriverTransaction<TEntity> = {
				query: async (query) => evaluateUnifyStoreQuery(this.schema, working, query),
				insert: async (records) => {
					assertNoPrimaryConflicts(this.schema, working, records)
					working = [...working, ...records]
				},
				replaceAll: async (records) => {
					assertNoPrimaryConflicts(this.schema, [], records)
					working = [...records]
				},
			}
			const result = await operation(transaction)
			await this.writeRecords(working)
			return result
		})
	}

	async stats(): Promise<UnifyStoreStats> {
		this.assertOpen()
		return await this.fileLock.withLock(this.dataPath, async () => {
			this.assertOpen()
			return await createStats(this.dataPath, (await this.readRecords()).length)
		})
	}

	close(): Promise<void> {
		this.closePromise ??= Promise.resolve().then(() => {
			this.closed = true
		})
		return this.closePromise
	}

	private async readRecords(): Promise<TEntity[]> {
		return (await readJsonl<unknown>(this.dataPath)).map((value, ordinal) => this.codec.decode(value, ordinal))
	}

	private async writeRecords(records: readonly TEntity[]): Promise<void> {
		await writeJsonl(
			this.dataPath,
			records.map((record) => this.codec.encode(record)),
		)
	}

	private assertOpen(): void {
		if (this.closed) throw new Error("JSONL UnifyStore driver is closed")
	}
}

async function ensureSchemaMetadata<TEntity extends object>(metadataPath: string, schema: EntitySchema<TEntity>): Promise<void> {
	try {
		await validateSchemaMetadata(metadataPath, schema)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
		await fs.writeFile(metadataPath, JSON.stringify(expectedSchemaMetadata(schema)), { encoding: "utf8", flag: "wx" })
	}
}

async function validateSchemaMetadata<TEntity extends object>(
	metadataPath: string,
	schema: EntitySchema<TEntity>,
): Promise<void> {
	const expected = expectedSchemaMetadata(schema)
	const actual = JSON.parse(await fs.readFile(metadataPath, "utf8")) as Partial<JsonlSchemaMetadata>
	if (typeof actual.version === "number" && actual.version > schema.version) {
		throw new Error(`Future entity schema version for ${schema.schemaId}`)
	}
	if (
		actual.schemaId !== expected.schemaId ||
		actual.version !== expected.version ||
		actual.fingerprint !== expected.fingerprint
	) {
		throw new Error(`Entity schema conflict for ${schema.schemaId}`)
	}
}

function expectedSchemaMetadata<TEntity extends object>(schema: EntitySchema<TEntity>): JsonlSchemaMetadata {
	return {
		schemaId: schema.schemaId,
		version: schema.version,
		fingerprint: schema.fingerprint,
	}
}

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath)
		return true
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
		throw error
	}
}

function assertNoPrimaryConflicts<TEntity extends object>(
	schema: EntitySchema<TEntity>,
	current: readonly TEntity[],
	incoming: readonly TEntity[],
): void {
	const keys = new Set(current.map((record) => primaryKey(schema, record)))
	for (const record of incoming) {
		const key = primaryKey(schema, record)
		if (keys.has(key)) throw new Error(`UnifyStore conflict for ${schema.schemaId}`)
		keys.add(key)
	}
}

function primaryKey<TEntity extends object>(schema: EntitySchema<TEntity>, record: TEntity): string {
	const values = schema.dehydrate(record)
	return schema.primaryFields.map((field) => serializeKey(values[field.name])).join("|")
}

function serializeKey(value: unknown): string {
	if (typeof value === "bigint") return `bigint:${value}`
	if (value instanceof Uint8Array) return `blob:${Buffer.from(value).toString("base64")}`
	return `${typeof value}:${JSON.stringify(value)}`
}

function createBufferedJsonlRowEntity(schemaId: string) {
	class BufferedJsonlRowEntity implements BufferedJsonlRow {
		static readonly storage = defineEntity<BufferedJsonlRow>()({
			schemaId,
			version: 1,
			columns: {
				ordinal: column.integer({ primary: true }),
				timestamp: column.real({ indexed: true }),
				payload: column.json<object>({ validate: isObjectRecord }),
			},
			defaultOrder: [{ field: "ordinal", direction: "asc" }],
			hydrate: (values) => new BufferedJsonlRowEntity(values.ordinal, values.timestamp, values.payload),
		})

		constructor(
			readonly ordinal: number,
			readonly timestamp: number,
			readonly payload: object,
		) {}
	}
	return BufferedJsonlRowEntity
}

function isObjectRecord(value: unknown): value is object {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isTimestampedItem<TItem extends { ts: number }>(value: unknown): value is TItem {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		typeof (value as { ts?: unknown }).ts === "number" &&
		Number.isFinite((value as { ts: number }).ts)
	)
}

function normalizeSubscriptionKey(filePath: string): string {
	const resolved = path.resolve(filePath)
	return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

function collectionPaths(directory: string, schemaId: string): { data: string; metadata: string } {
	const base = `${sanitizeName(schemaId)}-${fnv1a(schemaId)}`
	return {
		data: path.join(directory, `${base}.jsonl`),
		metadata: path.join(directory, `${base}.schema.json`),
	}
}

function sanitizeName(value: string): string {
	return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 72)
}

function fnv1a(value: string): string {
	let hash = 0x811c9dc5
	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index)
		hash = Math.imul(hash, 0x01000193)
	}
	return (hash >>> 0).toString(16).padStart(8, "0")
}

async function createStats(dataPath: string, count: number): Promise<UnifyStoreStats> {
	const stat = await fs.stat(dataPath)
	return { storageBytes: stat.size, storedRecordCount: count, degraded: false }
}
