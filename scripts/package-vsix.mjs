#!/usr/bin/env node

/**
 * Production VSIX packaging script.
 *
 * Behavior:
 * - On main branch or git tag: packages normally (e.g., dline-5.0.4.vsix)
 * - On feature/development branches:
 *   1. Appends git hash to version (e.g., dline-5.0.4-a1b2c3d.vsix)
 *   2. Applies nightly theme (preview: true, name → dline-nightly,
 *      displayName → Dline (Nightly))
 *
 * This script:
 * 1. Checks if current HEAD is on main branch or a git tag
 * 2. If not, backs up package.json and applies nightly modifications
 * 3. Runs vsce package
 * 4. Restores package.json if modified
 */

import { execSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PROJECT_ROOT = path.join(__dirname, "..")
const PACKAGE_JSON_PATH = path.join(PROJECT_ROOT, "package.json")
const DIST_DIR = path.join(PROJECT_ROOT, "dist")

const NIGHTLY_SUFFIX = "-nightly"
const NIGHTLY_DISPLAY_SUFFIX = " (Nightly)"

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
		return false
	}
}

/**
 * Read and parse package.json.
 * @returns {object}
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

console.log(`[package-vsix] Git hash: ${hash}`)
console.log(`[package-vsix] On tag: ${onTag}`)
console.log(`[package-vsix] On main branch: ${onMain}`)

let modified = false
let originalContent = ""
let originalVersion = ""

if (onTag || onMain) {
	console.log("[package-vsix] On main branch or tag, packaging with original version...")
} else {
	// Save original package.json content for restoration
	originalContent = fs.readFileSync(PACKAGE_JSON_PATH, "utf-8")
	const pkg = JSON.parse(originalContent)
	originalVersion = pkg.version

	// Append git hash to version
	pkg.version = `${pkg.version}-${hash}`

	// Apply nightly theme: preview flag + renamed identity
	const originalName = pkg.name
	const originalDisplayName = pkg.displayName
	pkg.preview = true
	pkg.name = originalName + NIGHTLY_SUFFIX
	pkg.displayName = originalDisplayName + NIGHTLY_DISPLAY_SUFFIX
	if (pkg.contributes?.viewsContainers?.activitybar?.title) {
		pkg.contributes.viewsContainers.activitybar.title = originalDisplayName + NIGHTLY_DISPLAY_SUFFIX
	}

	writePackageJson(pkg)
	modified = true

	console.log(`[package-vsix] Modified version: ${originalVersion} → ${pkg.version}`)
	console.log(`[package-vsix] Applied nightly theme: preview=true, name=${pkg.name}`)
}

try {
	// Ensure dist directory exists
	if (!fs.existsSync(DIST_DIR)) {
		fs.mkdirSync(DIST_DIR, { recursive: true })
	}

	const vsceCmd = "npx vsce package --allow-package-secrets sendgrid"
	console.log(`[package-vsix] Running: ${vsceCmd}`)
	execSync(vsceCmd, {
		cwd: PROJECT_ROOT,
		stdio: "inherit",
		shell: true,
	})
	console.log("[package-vsix] Package completed successfully!")
} finally {
	// Always restore package.json if modified
	if (modified) {
		console.log(`[package-vsix] Restoring original version: ${originalVersion}`)
		fs.writeFileSync(PACKAGE_JSON_PATH, originalContent)
	}
}
