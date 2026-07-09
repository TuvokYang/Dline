/**
 * Build child process spawn settings for a local executable.
 *
 * @param {{ platform?: NodeJS.Platform, executable: string }} options Spawn command options.
 * @returns {{ file: string, options: { shell: boolean } }} Spawn file and options.
 */
export function createSpawnCommand(options) {
	const platform = options.platform || process.platform
	return {
		file: options.executable,
		options: {
			shell: platform === "win32",
		},
	}
}
