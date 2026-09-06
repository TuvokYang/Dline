import { Logger } from "@shared/services/Logger"
import chokidar, { type ChokidarOptions, type FSWatcher } from "chokidar"
import * as path from "path"

/**
 * One tracker's handle on a shared workspace file watch.
 *
 * Disposing a subscription only detaches that tracker; the underlying watcher
 * stays alive until the last subscriber of the same absolute path releases it.
 */
export interface WorkspaceFileSubscription {
	dispose(): Promise<void>
}

export interface WorkspaceFileContextRegistryDeps {
	readonly watch?: (paths: string, options: ChokidarOptions) => FSWatcher
}

/** Reported to every subscriber watching the changed path. */
export interface WorkspaceFileChange {
	/** Workspace-relative path as originally requested by the subscriber. */
	readonly filePath: string
	/** Monotonic registry revision assigned to this change. */
	readonly revision: number
	/**
	 * True for exactly one subscriber per change. That subscriber records the
	 * external edit in task metadata so a single edit is not written N times.
	 */
	readonly isMetadataAuthor: boolean
}

interface FileSubscriber {
	readonly filePath: string
	readonly onExternalChange: (change: WorkspaceFileChange) => void
}

interface WatchEntry {
	readonly watcher: FSWatcher
	readonly subscribers: Set<FileSubscriber>
}

const WATCH_OPTIONS: ChokidarOptions = {
	persistent: true, // Keep process alive while watching
	ignoreInitial: true, // Don't emit events for existing files on startup
	atomic: true, // Handle atomic writes (editors that use temp files)
	awaitWriteFinish: {
		// Wait for writes to finish before emitting events
		stabilityThreshold: 100, // Wait 100ms for file size to stabilize
		pollInterval: 100, // Check every 100ms while waiting
	},
}

/**
 * Share one file watcher per absolute path across every tracker of a workspace.
 *
 * The registry owns watcher lifetime, the monotonic revision of "this file
 * changed outside Dline", and the pending marker for changes Dline authored
 * itself. Acknowledgement cursors stay with each subscriber so one task
 * consuming a change never hides it from another.
 */
export class WorkspaceFileContextRegistry {
	private readonly watch: (paths: string, options: ChokidarOptions) => FSWatcher
	private readonly entries = new Map<string, WatchEntry>()
	private readonly revisions = new Map<string, number>()
	private readonly pendingSelfEdits = new Set<string>()
	private revisionCounter = 0

	constructor(deps: WorkspaceFileContextRegistryDeps = {}) {
		this.watch = deps.watch ?? ((paths, options) => chokidar.watch(paths, options))
	}

	/**
	 * Subscribe to a workspace-relative path.
	 *
	 * `cwd` and `filePath` are resolved to one absolute key so trackers that
	 * spell the same file differently still share a single watcher.
	 */
	subscribe(cwd: string, filePath: string, onExternalChange: (change: WorkspaceFileChange) => void): WorkspaceFileSubscription {
		const absolutePath = path.resolve(cwd, filePath)
		const subscriber: FileSubscriber = { filePath, onExternalChange }
		const entry = this.entries.get(absolutePath) ?? this.createEntry(absolutePath)
		entry.subscribers.add(subscriber)

		let released = false
		return {
			dispose: async () => {
				if (released) return
				released = true
				await this.releaseSubscriber(absolutePath, entry, subscriber)
			},
		}
	}

	/**
	 * Suppress the next observed change for a path because Dline authored it.
	 *
	 * The marker is workspace-wide: whichever task performed the write, no
	 * tracker should report that write back as an external edit. Paths without
	 * a live watcher are ignored: no change event can be reported for them, and
	 * a stored marker would instead swallow a later real user edit.
	 */
	markSelfEdit(cwd: string, filePath: string): void {
		const absolutePath = path.resolve(cwd, filePath)
		if (!this.entries.has(absolutePath)) return
		this.pendingSelfEdits.add(absolutePath)
	}

	/** Current revision of a path, or 0 when no external change was observed. */
	getRevision(cwd: string, filePath: string): number {
		return this.revisions.get(path.resolve(cwd, filePath)) ?? 0
	}

	/**
	 * Record an external edit that a caller observed outside the shared watcher,
	 * so it becomes visible to every task tracking the same path.
	 */
	recordExternalEdit(cwd: string, filePath: string): number {
		const absolutePath = path.resolve(cwd, filePath)
		this.revisionCounter += 1
		this.revisions.set(absolutePath, this.revisionCounter)
		return this.revisionCounter
	}

	/**
	 * Record an externally supplied revision so restored task snapshots stay
	 * visible and keep the registry counter monotonic.
	 */
	adoptRevision(cwd: string, filePath: string, revision: number): void {
		if (!Number.isSafeInteger(revision) || revision <= 0) return
		const absolutePath = path.resolve(cwd, filePath)
		const current = this.revisions.get(absolutePath) ?? 0
		if (revision > current) {
			this.revisions.set(absolutePath, revision)
		}
		this.revisionCounter = Math.max(this.revisionCounter, revision)
	}

	/** Close every shared watcher. Intended for host shutdown and test isolation. */
	async disposeAll(): Promise<void> {
		const entries = [...this.entries.values()]
		this.entries.clear()
		this.revisions.clear()
		this.pendingSelfEdits.clear()
		for (const entry of entries) {
			entry.subscribers.clear()
			await entry.watcher.close().catch((error) => {
				Logger.error("[WorkspaceFileContextRegistry] Failed to dispose shared watcher:", error)
			})
		}
	}

	private createEntry(absolutePath: string): WatchEntry {
		const subscribers = new Set<FileSubscriber>()
		const watcher = this.watch(absolutePath, WATCH_OPTIONS)
		watcher.on("change", () => this.handleChange(absolutePath, subscribers))
		watcher.on("error", (error) => {
			Logger.error("[WorkspaceFileContextRegistry] Watch error:", error)
		})
		const entry: WatchEntry = { watcher, subscribers }
		this.entries.set(absolutePath, entry)
		return entry
	}

	private handleChange(absolutePath: string, subscribers: ReadonlySet<FileSubscriber>): void {
		if (this.pendingSelfEdits.delete(absolutePath)) {
			return // Dline authored this write; no tracker should treat it as external.
		}
		this.revisionCounter += 1
		const revision = this.revisionCounter
		this.revisions.set(absolutePath, revision)
		let isMetadataAuthor = true
		for (const subscriber of [...subscribers]) {
			try {
				subscriber.onExternalChange({ filePath: subscriber.filePath, revision, isMetadataAuthor })
				isMetadataAuthor = false
			} catch (error) {
				Logger.error("[WorkspaceFileContextRegistry] Subscriber notification failed:", error)
			}
		}
	}

	private async releaseSubscriber(absolutePath: string, entry: WatchEntry, subscriber: FileSubscriber): Promise<void> {
		entry.subscribers.delete(subscriber)
		if (entry.subscribers.size > 0) return
		if (this.entries.get(absolutePath) === entry) this.entries.delete(absolutePath)
		// No watcher remains to consume a pending marker; keeping it would swallow
		// the first real edit observed after the path is watched again.
		this.pendingSelfEdits.delete(absolutePath)
		await entry.watcher.close().catch((error) => {
			Logger.error("[WorkspaceFileContextRegistry] Failed to dispose shared watcher:", error)
		})
	}
}

let sharedRegistry: WorkspaceFileContextRegistry | undefined

/** Process-wide registry used by trackers; tests should construct their own instance. */
export function getWorkspaceFileContextRegistry(): WorkspaceFileContextRegistry {
	sharedRegistry ??= new WorkspaceFileContextRegistry()
	return sharedRegistry
}
