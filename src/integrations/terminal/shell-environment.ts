import { createHash } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { load as parseYaml } from "js-yaml"

const CONFIG_RELATIVE_PATH = path.join(".agents", "bashrc.yml")
const PLATFORM_NAMES = ["win32", "linux", "darwin"] as const

type EnvironmentMap = Record<string, string | null>

interface ProfileConfiguration {
	environment: EnvironmentMap
	commands: string[]
}

interface PlatformConfiguration {
	environment: EnvironmentMap
	profiles: Record<string, ProfileConfiguration>
}

interface ShellEnvironmentConfiguration {
	environment: EnvironmentMap
	platforms: Partial<Record<(typeof PLATFORM_NAMES)[number], PlatformConfiguration>>
}

export interface ResolvedShellEnvironment {
	readonly configPath: string
	readonly configurationId: string
	readonly environment: Readonly<EnvironmentMap>
	readonly initializationCommands: readonly string[]
}

interface ShellEnvironmentConfigLoaderOptions {
	readonly workspaceRoots: readonly string[]
	readonly platform?: NodeJS.Platform
	readonly environment?: NodeJS.ProcessEnv
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function assertKnownKeys(value: Record<string, unknown>, allowed: readonly string[], context: string): void {
	const unknown = Object.keys(value).find((key) => !allowed.includes(key))
	if (unknown) throw new Error(`${context} contains unsupported field: ${unknown}`)
}

function parseEnvironment(value: unknown, context: string): EnvironmentMap {
	if (value === undefined) return {}
	if (!isRecord(value)) throw new Error(`${context} must be a mapping`)
	const environment: EnvironmentMap = {}
	for (const [name, entry] of Object.entries(value)) {
		if (entry === null) {
			environment[name] = null
		} else if (["string", "number", "boolean"].includes(typeof entry)) {
			environment[name] = String(entry)
		} else {
			throw new Error(`${context}.${name} must be a scalar or null`)
		}
	}
	return environment
}

function parseProfile(value: unknown, context: string): ProfileConfiguration {
	if (!isRecord(value)) throw new Error(`${context} must be a mapping`)
	assertKnownKeys(value, ["environment", "commands"], context)
	if (
		value.commands !== undefined &&
		(!Array.isArray(value.commands) || value.commands.some((entry) => typeof entry !== "string"))
	) {
		throw new Error(`${context}.commands must be a list of strings`)
	}
	return {
		environment: parseEnvironment(value.environment, `${context}.environment`),
		commands: (value.commands as string[] | undefined) ?? [],
	}
}

function parsePlatform(value: unknown, context: string): PlatformConfiguration {
	if (!isRecord(value)) throw new Error(`${context} must be a mapping`)
	assertKnownKeys(value, ["environment", "profiles"], context)
	if (value.profiles !== undefined && !isRecord(value.profiles)) throw new Error(`${context}.profiles must be a mapping`)
	const profiles: Record<string, ProfileConfiguration> = {}
	for (const [profile, profileValue] of Object.entries(value.profiles ?? {})) {
		profiles[profile] = parseProfile(profileValue, `${context}.profiles.${profile}`)
	}
	return {
		environment: parseEnvironment(value.environment, `${context}.environment`),
		profiles,
	}
}

function parseConfiguration(value: unknown): ShellEnvironmentConfiguration {
	if (!isRecord(value)) throw new Error("configuration must be a mapping")
	assertKnownKeys(value, ["version", "environment", "platforms"], "configuration")
	if (value.version !== 1) throw new Error("configuration.version must be 1")
	if (value.platforms !== undefined && !isRecord(value.platforms)) throw new Error("configuration.platforms must be a mapping")
	const platforms: ShellEnvironmentConfiguration["platforms"] = {}
	for (const [platform, platformValue] of Object.entries(value.platforms ?? {})) {
		if (!PLATFORM_NAMES.includes(platform as (typeof PLATFORM_NAMES)[number])) {
			throw new Error(`configuration.platforms contains unsupported platform: ${platform}`)
		}
		platforms[platform as (typeof PLATFORM_NAMES)[number]] = parsePlatform(
			platformValue,
			`configuration.platforms.${platform}`,
		)
	}
	return {
		environment: parseEnvironment(value.environment, "configuration.environment"),
		platforms,
	}
}

function isPathWithin(root: string, target: string): boolean {
	const relative = path.relative(root, target)
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function expandEnvironment(environment: EnvironmentMap, base: NodeJS.ProcessEnv): EnvironmentMap {
	return Object.fromEntries(
		Object.entries(environment).map(([name, value]) => [
			name,
			value?.replace(/\$\{env:([^}]+)\}/g, (_match, variable: string) => base[variable] ?? "") ?? null,
		]),
	)
}

export class ShellEnvironmentConfigLoader {
	private readonly workspaceRoots: string[]
	private readonly platform: NodeJS.Platform
	private readonly environment: NodeJS.ProcessEnv

	constructor(options: ShellEnvironmentConfigLoaderOptions) {
		this.workspaceRoots = [...options.workspaceRoots].map((root) => path.resolve(root)).sort((a, b) => b.length - a.length)
		this.platform = options.platform ?? process.platform
		this.environment = options.environment ?? process.env
	}

	async resolve(workdirectory: string, profile: string): Promise<ResolvedShellEnvironment | undefined> {
		const absoluteWorkdirectory = path.resolve(workdirectory)
		const workspaceRoot = this.workspaceRoots.find((root) => isPathWithin(root, absoluteWorkdirectory))
		if (!workspaceRoot) return undefined

		const configPath = path.join(workspaceRoot, CONFIG_RELATIVE_PATH)
		try {
			await stat(configPath)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
			throw error
		}

		try {
			const raw = await readFile(configPath, "utf8")
			const configuration = parseConfiguration(parseYaml(raw))
			const platform = configuration.platforms[this.platform as (typeof PLATFORM_NAMES)[number]]
			const profileConfiguration = platform?.profiles[profile]
			const environment = expandEnvironment(
				{
					...configuration.environment,
					...platform?.environment,
					...profileConfiguration?.environment,
				},
				this.environment,
			)
			const initializationCommands = profileConfiguration?.commands ?? []
			const configurationId = createHash("sha256")
				.update(JSON.stringify({ configPath, environment, initializationCommands, profile }))
				.digest("hex")
				.slice(0, 16)
			return { configPath, configurationId, environment, initializationCommands }
		} catch (error) {
			throw new Error(`Invalid ${CONFIG_RELATIVE_PATH} at ${configPath}: ${error instanceof Error ? error.message : error}`)
		}
	}
}

export function buildPreloadedCommand(
	command: string,
	initializationCommands: readonly string[],
	profile: string,
	platform: NodeJS.Platform = process.platform,
): string {
	if (initializationCommands.length === 0) return command
	if (platform === "win32" && (profile === "default" || profile.includes("powershell"))) {
		const guarded = initializationCommands.map((entry) => `${entry}; if (-not $?) { exit 1 }`).join("; ")
		return `& { ${guarded}; ${command} }`
	}
	if (platform === "win32" && profile === "cmd") {
		return [...initializationCommands.map((entry) => `(${entry})`), `(${command})`].join(" && ")
	}
	return [...initializationCommands, command].join(" && ")
}
