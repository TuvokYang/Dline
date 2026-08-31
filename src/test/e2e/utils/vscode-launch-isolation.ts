import { mkdirSync, mkdtempSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { E2E_RUN_ID } from "./run-context"

/**
 * Filesystem locations that hold the machine state of a single test VS Code launch.
 *
 * Removing {@link portableRoot} removes every persistent side effect of that launch, so callers
 * clean up the root rather than the individual directories below it.
 */
export interface VSCodeLaunchIsolation {
	/** Value passed as `VSCODE_PORTABLE`; owns user data, `argv.json`, and shared data. */
	readonly portableRoot: string
	/** Real VS Code user data path. The Dline output channel log lives under its `logs` directory. */
	readonly userDataDir: string
}

const EXTENSIONS_ROOT = path.join(os.tmpdir(), "dline-e2e-extensions", E2E_RUN_ID)

/**
 * Create the per-launch portable layout for one VS Code instance.
 *
 * Portable mode is what keeps a test launch out of machine-global state. On Windows and Linux VS
 * Code re-registers itself as the `vscode://` protocol handler on every startup unless it detects
 * portable mode, which would otherwise point the developer's protocol handler at the downloaded
 * test build. Detection requires the portable directory to already exist when the process starts,
 * so the layout is created eagerly here.
 *
 * The `tmp` subdirectory is deliberately not created: VS Code redirects `TMP`/`TEMP` to it when
 * present, which would move temporary files that tests and mocked tooling rely on.
 */
export function createLaunchIsolation(prefix: string): VSCodeLaunchIsolation {
	const portableRoot = mkdtempSync(path.join(os.tmpdir(), prefix))
	const userDataDir = path.join(portableRoot, "user-data")
	mkdirSync(userDataDir, { recursive: true })
	return { portableRoot, userDataDir }
}

/**
 * Create the extension host storage shared by every launch of one worker.
 *
 * The extension under test is installed once per worker and reused by later launches. Sharing at
 * worker scope keeps concurrent workers off a single directory, which is what makes parallel and
 * multi-instance runs safe: installing into the developer's real extensions directory would let
 * concurrent installs interleave while unpacking the same VSIX and rewriting `extensions.json`.
 */
export function createWorkerExtensionsDir(workerIndex: number): string {
	const extensionsDir = path.join(EXTENSIONS_ROOT, `worker-${workerIndex}`)
	mkdirSync(extensionsDir, { recursive: true })
	return extensionsDir
}

/** Environment entries that activate portable mode for one launch. */
export function portableEnvironment(isolation: VSCodeLaunchIsolation): Record<string, string> {
	return { VSCODE_PORTABLE: isolation.portableRoot }
}
