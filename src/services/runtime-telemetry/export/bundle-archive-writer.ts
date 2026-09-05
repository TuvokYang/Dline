import { randomBytes } from "node:crypto"
import { createWriteStream } from "node:fs"
import { mkdir, rename, rm } from "node:fs/promises"
import { dirname } from "node:path"
import archiver from "archiver"
import type { BuiltBundle } from "./bundle-builder"

/**
 * Writes a built bundle to a zip file.
 *
 * The write is staged through a temporary path and renamed only after the
 * archive finalizes. A user who cancels or hits a full disk must not be left
 * with a truncated `.zip` that looks like a valid bug report, so a partial
 * write is removed rather than kept.
 */

/** Compression level. Diagnostic JSON compresses well; speed matters more than ratio. */
const COMPRESSION_LEVEL = 6

/** Attempts to commit the staged archive before reporting a failure. */
const RENAME_RETRY_LIMIT = 5
const RENAME_RETRY_DELAY_MS = 20

export interface BundleArchiveResult {
	readonly path: string
	readonly byteLength: number
	readonly entryCount: number
}

export class BundleArchiveError extends Error {
	constructor(message: string, cause?: unknown) {
		// `cause` carries the original failure (disk full, permission denied).
		// It is passed to Error so tooling can walk the chain instead of
		// shadowing the base member with a parameter property.
		super(message, { cause })
		this.name = "BundleArchiveError"
	}
}

/**
 * Write `bundle` to `destinationPath`.
 *
 * The caller supplies the destination because choosing it belongs to the host
 * save dialog, not to this module.
 */
export async function writeBundleArchive(bundle: BuiltBundle, destinationPath: string): Promise<BundleArchiveResult> {
	// A unique staging name keeps two concurrent exports to the same
	// destination from truncating each other's work, and keeps a failed export
	// from clobbering a staging file another attempt is still writing.
	const temporaryPath = `${destinationPath}.${randomBytes(6).toString("hex")}.partial`

	try {
		await mkdir(dirname(destinationPath), { recursive: true })
		const byteLength = await writeArchive(bundle, temporaryPath)
		// Rename is the commit point: until it succeeds, no file with the
		// user-visible name exists.
		await commitStagedArchive(temporaryPath, destinationPath)
		return { path: destinationPath, byteLength, entryCount: bundle.entries.length }
	} catch (error) {
		await discardPartial(temporaryPath)
		throw new BundleArchiveError(`failed to write diagnostic bundle to ${destinationPath}`, error)
	}
}

/**
 * Move the staged archive onto the user-visible name.
 *
 * On Windows a rename onto a path another process has open fails with EPERM or
 * EBUSY. Two concurrent exports of the same session are a normal user action —
 * clicking the button twice — so a brief retry is preferable to reporting a
 * failure for a bundle that was written correctly.
 */
async function commitStagedArchive(temporaryPath: string, destinationPath: string): Promise<void> {
	const retryableCodes = new Set(["EPERM", "EBUSY", "EACCES"])

	for (let attempt = 0; ; attempt++) {
		try {
			await rename(temporaryPath, destinationPath)
			return
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code
			if (attempt >= RENAME_RETRY_LIMIT || !code || !retryableCodes.has(code)) {
				throw error
			}
			await delay(RENAME_RETRY_DELAY_MS)
		}
	}
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function writeArchive(bundle: BuiltBundle, temporaryPath: string): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		const output = createWriteStream(temporaryPath, { flags: "wx" })
		const archive = archiver("zip", { zlib: { level: COMPRESSION_LEVEL } })

		let opened = false
		output.on("open", () => {
			opened = true
		})

		let settled = false
		const fail = (error: unknown) => {
			if (settled) return
			settled = true
			// Stop the archiver and release the file handle before rejecting.
			// On Windows the caller's cleanup cannot delete a file that still
			// has an open descriptor, which would leave the staging file behind.
			try {
				archive.abort()
			} catch {
				// Abort is best effort; the stream teardown below still runs.
			}
			output.destroy()
			// A stream that never opened emits no `close`, so waiting for one
			// would hang. Only an opened descriptor needs to be drained before
			// the caller can unlink the staged file.
			if (!opened || output.closed) {
				reject(error)
				return
			}
			output.once("close", () => reject(error))
			output.once("error", () => reject(error))
		}

		output.on("close", () => {
			if (settled) return
			settled = true
			resolve(archive.pointer())
		})
		output.on("error", fail)
		archive.on("error", fail)
		// Entries are in-memory strings, so a warning here means an entry was
		// dropped: an incomplete bundle, not a recoverable condition.
		archive.on("warning", fail)

		archive.pipe(output)
		for (const entry of bundle.entries) {
			archive.append(entry.content, { name: entry.name })
		}
		archive.finalize().catch(fail)
	})
}

/** Remove the staged file, ignoring the case where it was never created. */
async function discardPartial(temporaryPath: string): Promise<void> {
	try {
		await rm(temporaryPath, { force: true })
	} catch {
		// The staged file is unreachable; the caller is already handling a
		// failure and cannot act on this either.
	}
}
