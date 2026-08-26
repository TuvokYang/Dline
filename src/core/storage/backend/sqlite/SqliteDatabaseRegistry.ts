import { mkdir } from "node:fs/promises"
import path from "node:path"
import type { DatabaseSync } from "node:sqlite"
import Mutex from "p-mutex"
import { type SqliteMigration, SqliteMigrationRegistry } from "./SqliteMigrationRegistry"
import { openSqliteDatabase, type SqliteDatabaseHandle } from "./SqliteRuntime"
import { SqliteApplicationMismatchError } from "./SqliteStoreErrors"

interface ApplicationIdRow {
	application_id: number
}

export interface SqliteDatabaseOptions {
	applicationId: number
	migrations: readonly SqliteMigration[]
}

interface RegistryEntry {
	handle: SqliteDatabaseHandle
	mutex: Mutex
	references: number
	applicationId: number
	latestVersion: number | undefined
}

export class SqliteDatabaseLease {
	private closed = false

	constructor(
		readonly database: DatabaseSync,
		private readonly mutex: Mutex,
		private readonly release: () => void,
	) {}

	withLock<TResult>(operation: () => TResult | Promise<TResult>): Promise<TResult> {
		if (this.closed) return Promise.reject(new Error("SQLite database lease is closed"))
		return this.mutex.withLock(operation)
	}

	close(): void {
		if (this.closed) return
		this.closed = true
		this.release()
	}
}

export class SqliteDatabaseRegistry {
	private readonly entries = new Map<string, RegistryEntry>()
	private readonly pending = new Map<string, Promise<RegistryEntry>>()

	async acquire(location: string, options: SqliteDatabaseOptions): Promise<SqliteDatabaseLease> {
		const normalizedLocation = this.normalizeLocation(location)
		let entry = this.entries.get(normalizedLocation)
		if (!entry) {
			let pending = this.pending.get(normalizedLocation)
			if (!pending) {
				pending = this.openEntry(normalizedLocation, options)
				this.pending.set(normalizedLocation, pending)
			}
			try {
				entry = await pending
				this.validateCompatibleOptions(entry, options)
			} finally {
				if (this.pending.get(normalizedLocation) === pending) this.pending.delete(normalizedLocation)
			}
		} else {
			this.validateCompatibleOptions(entry, options)
		}

		entry.references += 1
		return new SqliteDatabaseLease(entry.handle.database, entry.mutex, () => this.release(normalizedLocation, entry))
	}

	getReferenceCount(location: string): number {
		return this.entries.get(this.normalizeLocation(location))?.references ?? 0
	}

	closeAll(): void {
		for (const entry of this.entries.values()) entry.handle.close()
		this.entries.clear()
		this.pending.clear()
	}

	private async openEntry(location: string, options: SqliteDatabaseOptions): Promise<RegistryEntry> {
		await mkdir(path.dirname(location), { recursive: true })
		const handle = openSqliteDatabase(location)
		try {
			this.ensureApplicationId(handle.database, options.applicationId)
			const migrations = new SqliteMigrationRegistry(options.migrations)
			migrations.apply(handle.database)
			const entry: RegistryEntry = {
				handle,
				mutex: new Mutex(),
				references: 0,
				applicationId: options.applicationId,
				latestVersion: migrations.latestVersion,
			}
			this.entries.set(location, entry)
			return entry
		} catch (error) {
			handle.close()
			throw error
		}
	}

	private ensureApplicationId(database: DatabaseSync, expected: number): void {
		const row = database.prepare("PRAGMA application_id").get() as unknown as ApplicationIdRow
		if (row.application_id === 0) {
			database.exec(`PRAGMA application_id = ${expected}`)
			return
		}
		if (row.application_id !== expected) throw new SqliteApplicationMismatchError(expected, row.application_id)
	}

	private validateCompatibleOptions(entry: RegistryEntry, options: SqliteDatabaseOptions): void {
		const latestVersion = options.migrations.at(-1)?.version
		if (entry.applicationId !== options.applicationId || entry.latestVersion !== latestVersion) {
			throw new Error("SQLite database is already open with incompatible application or migration options")
		}
	}

	private release(location: string, entry: RegistryEntry): void {
		if (this.entries.get(location) !== entry) return
		entry.references -= 1
		if (entry.references > 0) return
		entry.handle.close()
		this.entries.delete(location)
	}

	private normalizeLocation(location: string): string {
		const resolved = path.resolve(location)
		return process.platform === "win32" ? resolved.toLowerCase() : resolved
	}
}
