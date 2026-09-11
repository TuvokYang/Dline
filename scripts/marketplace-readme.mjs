#!/usr/bin/env node

// Swap README.md with README.marketplace.md so the VS Code Marketplace listing
// (which is generated from the README baked into the .vsix at package time)
// keeps the extension-focused content even after the repo's README.md is
// repurposed as a multi-product landing page.
//
// The README files diverge in two directions:
//   - README.md is what GitHub renders on the repo home page. We want this to
//     cover the SDK, JetBrains plugin, CLI, and VS Code extension together.
//   - README.marketplace.md is what users see on the VS Code Marketplace and
//     inside the extension after install. It stays focused on the VS Code UX.
//
// vsce reads README.md from the extension root at `vsce package` / `vsce publish`
// time. Its `--readme-path` flag only selects among files that survive
// .vscodeignore, and README.marketplace.md is deliberately excluded from the
// .vsix, so we copy README.marketplace.md over README.md just before packaging
// and put the original back afterwards.
//
// swapIn is idempotent: if README.md already matches README.marketplace.md
// (e.g., an outer wrapper has already swapped), it no-ops instead of erroring
// on the backup file. This lets nested callers (publish.yml wrapping the whole
// step, plus the individual npm scripts swapping internally) coexist safely.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { withSignalSafeCleanup } from "./signal-safe-cleanup.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.join(__dirname, "..")

const README_PATH = path.join(projectRoot, "README.md")
const MARKETPLACE_PATH = path.join(projectRoot, "README.marketplace.md")
const BACKUP_PATH = path.join(projectRoot, ".README.github.bak")

function readFile(p) {
	return fs.readFileSync(p, "utf-8")
}

export function swapIn() {
	if (!fs.existsSync(MARKETPLACE_PATH)) {
		throw new Error(`Missing ${MARKETPLACE_PATH}. The marketplace README must exist before publishing.`)
	}
	if (!fs.existsSync(README_PATH)) {
		throw new Error(`Missing ${README_PATH}. Cannot swap in marketplace README.`)
	}

	if (readFile(README_PATH) === readFile(MARKETPLACE_PATH)) {
		return { skipped: true }
	}

	if (fs.existsSync(BACKUP_PATH)) {
		throw new Error(
			`Stale backup at ${BACKUP_PATH}. A previous publish may have aborted before restoring README.md. ` +
				`Move it back to README.md manually before retrying.`,
		)
	}

	fs.copyFileSync(README_PATH, BACKUP_PATH)
	fs.copyFileSync(MARKETPLACE_PATH, README_PATH)
	return { skipped: false }
}

export function restore() {
	if (!fs.existsSync(BACKUP_PATH)) {
		return { skipped: true }
	}
	fs.copyFileSync(BACKUP_PATH, README_PATH)
	fs.unlinkSync(BACKUP_PATH)
	return { skipped: false }
}

/**
 * Run `work` while README.marketplace.md is swapped into README.md.
 *
 * The cleanup stack is shared with callers so every temporary packaging file
 * is restored by the same normal, error, SIGINT, and SIGTERM lifecycle. When
 * `swapIn` skips because an outer wrapper already swapped, this call does not
 * register a README restore and remains safe to nest.
 *
 * @template T
 * @param {(cleanups: import("./signal-safe-cleanup.mjs").SynchronousCleanupStack) => T | Promise<T>} work
 * @param {Parameters<typeof withSignalSafeCleanup>[1]} [options]
 * @returns {Promise<T>}
 */
export async function withMarketplaceReadme(work, options) {
	return withSignalSafeCleanup(async (cleanups) => {
		const swapped = !swapIn().skipped
		if (swapped) {
			cleanups.defer(() => restore())
		}
		return work(cleanups)
	}, options)
}

const invokedAsCli = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)
if (invokedAsCli) {
	const cmd = process.argv[2]
	try {
		if (cmd === "swap-in") {
			const result = swapIn()
			console.log(result.skipped ? "marketplace-readme: already swapped, skipping" : "marketplace-readme: swapped in")
		} else if (cmd === "restore") {
			const result = restore()
			console.log(result.skipped ? "marketplace-readme: no backup, skipping" : "marketplace-readme: restored")
		} else {
			console.error("Usage: marketplace-readme.mjs <swap-in|restore>")
			process.exit(2)
		}
	} catch (err) {
		console.error(`marketplace-readme: ${err.message}`)
		process.exit(1)
	}
}
