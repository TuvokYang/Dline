#!/usr/bin/env node

/**
 * Dev package script for VS Code extension.
 * Packages the extension with a git hash suffix when not on main branch or tag.
 *
 * Behavior:
 * - On main branch or git tag: packages normally (e.g., dline-5.0.4.vsix)
 * - On feature/development branches: appends git hash (e.g., dline-5.0.4-a1b2c3d.vsix)
 *
 * This script:
 * 1. Checks if current HEAD is on main branch or a git tag
 * 2. If not, backs up package.json and temporarily modifies version to include hash
 * 3. Runs vsce package
 * 4. Restores package.json if modified
 */

import { execSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(import.meta.url)

const PROJECT_ROOT = path.join(__dirname, "..")
const PACKAGE_JSON_PATH = path.join(PROJECT_ROOT, "package.json")
const _DIST_DIR = path.join(PROJECT_ROOT, "dist")
const { pack: packVSIX } = require(path.join(PROJECT_ROOT, "node_modules", "@vscode", "vsce", "out", "package.js"))

const _NIGHTLY_SUFFIX = "-nightly"
const _NIGHTLY_DISPLAY_SUFFIX = " (Nightly)"

/**
 * Get short git hash of current HEAD.
 * @returns {string} 7-character git hash
 */
function getGitHash() {
	return execSync("git rev-parse --short HEAD", {
		cwd: PROJECT_ROOT,
		encoding: "utf-8",
	}).trim()
}

/**
 * Check if current HEAD is on a git tag.
 * @returns {boolean}
 */
function isOnTag() {
	try {
		execSync("git describe --tags --exact-match", {
			cwd: PROJECT_ROOT,
			stdio: "ignore",
		})
		return true
	} catch {
		return false
	}
}

/**
 * Check if current branch is main (or master).
 * @returns {boolean}
 */
function isOnMainBranch() {
	try {
		const branch = execSync("git branch --show-current", {
			cwd: PROJECT_ROOT,
			encoding: "utf-8",
		}).trim()
		return branch === "main" || branch === "master"
	} catch {
		// If detached HEAD or error, treat as non-main
		return false
	}
}

/**
 * Read and parse package.json.
 * @returns {{ version: string, [key: string]: any }}
 */
function _readPackageJson() {
	return JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf-8"))
}

/**
 * Write package.json back to disk.
 * @param {object} pkg
 */
function writePackageJson(pkg) {
	fs.writeFileSync(PACKAGE_JSON_PATH, `${JSON.stringify(pkg, null, "\t")}\n`)
}

// --- Main ---

const onTag = isOnTag()
const onMain = isOnMainBranch()
const hash = getGitHash()

console.log(`[package-dev] Git hash: ${hash}`)
console.log(`[package-dev] On tag: ${onTag}`)
console.log(`[package-dev] On main branch: ${onMain}`)

let modified = false
let originalVersion = ""
let originalContent = ""

if (onTag || onMain) {
	console.log("[package-dev] On main branch or tag, packaging with original version...")
} else {
	// Save original package.json content for restoration
	originalContent = fs.readFileSync(PACKAGE_JSON_PATH, "utf-8")
	const pkg = JSON.parse(originalContent)
	originalVersion = pkg.version

	// Append git hash to version
	pkg.version = `${pkg.version}-${hash}`
	writePackageJson(pkg)
	modified = true

	console.log(`[package-dev] Modified version: ${originalVersion} → ${pkg.version}`)
}

/**
 * Verify the built bundle is a dev build right before packing.
 *
 * dist/extension.js is shared with other build entry points (e.g. the E2E
 * prepublish writes a production bundle to the same path). If one of those
 * runs between our build step and vsce packing, we would silently ship a
 * production bundle in a dev VSIX. The DLINE_BUILD_TYPE banner written by
 * esbuild.mjs makes the bundle variant verifiable.
 */
function assertDevBundle() {
	const bundlePath = path.join(PROJECT_ROOT, "dist", "extension.js")
	const header = fs.readFileSync(bundlePath, "utf-8").slice(0, 512)
	const marker = header.match(/DLINE_BUILD_TYPE:(\w+)/)
	if (!marker || marker[1] !== "dev") {
		throw new Error(
			`[package-dev] dist/extension.js is not a dev bundle (marker: ${marker ? marker[1] : "missing"}). ` +
				"Another build (e.g. test:e2e prepublish) overwrote it. Re-run vsix:dev without concurrent builds.",
		)
	}
	console.log("[package-dev] Verified dist/extension.js is a dev bundle.")
}

try {
	// 1. Run the same validation and Webview build as vscode:prepublish,
	// then produce a dev extension bundle with IS_DEV=true and source maps.
	console.log("[package-dev] Building extension in dev mode...")
	for (const command of ["npm run check-types", "npm run build:webview", "npm run lint", "node esbuild.mjs"]) {
		execSync(command, {
			cwd: PROJECT_ROOT,
			stdio: "inherit",
			shell: true,
		})
	}

	// 2. Pack the already-built files. createVSIX() cannot be used here because
	// it always runs vscode:prepublish and would overwrite dist with a production build.
	assertDevBundle()
	console.log("[package-dev] Creating VSIX...")
	const { packagePath } = await packVSIX({
		cwd: PROJECT_ROOT,
		// The extension and Webview are bundled; dependency scanning only re-adds duplicate package files.
		dependencies: false,
	})
	const packageSizeMb = fs.statSync(packagePath).size / 1_000_000
	console.log(`[package-dev] Package completed: ${packagePath} (${packageSizeMb.toFixed(2)} MB)`)
} finally {
	// Always restore package.json if modified
	if (modified) {
		console.log(`[package-dev] Restoring original version: ${originalVersion}`)
		fs.writeFileSync(PACKAGE_JSON_PATH, originalContent)
	}
}
