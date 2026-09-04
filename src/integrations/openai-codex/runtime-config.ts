export const OPENAI_CODEX_PRODUCTION_RUNTIME_CONFIG = {
	apiBaseUrl: "https://chatgpt.com/backend-api/codex",
	responsesWebsocketUrl: "wss://chatgpt.com/backend-api/codex/responses",
	usageUrl: "https://chatgpt.com/backend-api/wham/usage",
} as const

export type OpenAiCodexE2EOAuthMode = "automatic" | "manual"

export interface OpenAiCodexRuntimeConfig {
	apiBaseUrl: string
	responsesWebsocketUrl: string
	usageUrl: string
	e2eOAuth?: {
		authorizationEndpoint: string
		tokenEndpoint: string
		mode: OpenAiCodexE2EOAuthMode
	}
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"])

function loopbackHttpUrl(name: string, value: string): URL {
	let parsed: URL
	try {
		parsed = new URL(value)
	} catch {
		throw new Error(`${name} must be a loopback HTTP URL.`)
	}
	if (parsed.protocol !== "http:" || !LOOPBACK_HOSTS.has(parsed.hostname) || parsed.username || parsed.password) {
		throw new Error(`${name} must be a loopback HTTP URL.`)
	}
	parsed.hash = ""
	return parsed
}

function normalizedUrl(url: URL): string {
	return url.toString().replace(/\/$/, "")
}

function appendPath(base: URL, segment: string): string {
	const url = new URL(base)
	url.pathname = `${url.pathname.replace(/\/$/, "")}/${segment}`
	url.search = ""
	return normalizedUrl(url)
}

function oauthMode(value: string | undefined): OpenAiCodexE2EOAuthMode {
	if (value === undefined || value === "automatic") return "automatic"
	if (value === "manual") return value
	throw new Error("DLINE_E2E_OPENAI_CODEX_OAUTH_MODE must be automatic or manual.")
}

export function resolveOpenAiCodexRuntimeConfig(env: NodeJS.ProcessEnv = process.env): OpenAiCodexRuntimeConfig {
	if (env.E2E_TEST !== "true") return OPENAI_CODEX_PRODUCTION_RUNTIME_CONFIG

	const apiBaseUrl = env.DLINE_E2E_OPENAI_CODEX_API_BASE_URL
		? normalizedUrl(loopbackHttpUrl("DLINE_E2E_OPENAI_CODEX_API_BASE_URL", env.DLINE_E2E_OPENAI_CODEX_API_BASE_URL))
		: OPENAI_CODEX_PRODUCTION_RUNTIME_CONFIG.apiBaseUrl
	const usageUrl = env.DLINE_E2E_OPENAI_CODEX_USAGE_URL
		? normalizedUrl(loopbackHttpUrl("DLINE_E2E_OPENAI_CODEX_USAGE_URL", env.DLINE_E2E_OPENAI_CODEX_USAGE_URL))
		: OPENAI_CODEX_PRODUCTION_RUNTIME_CONFIG.usageUrl
	const oauthBase = env.DLINE_E2E_OPENAI_CODEX_OAUTH_BASE_URL

	return {
		apiBaseUrl,
		responsesWebsocketUrl: OPENAI_CODEX_PRODUCTION_RUNTIME_CONFIG.responsesWebsocketUrl,
		usageUrl,
		...(oauthBase
			? {
					e2eOAuth: {
						authorizationEndpoint: appendPath(
							loopbackHttpUrl("DLINE_E2E_OPENAI_CODEX_OAUTH_BASE_URL", oauthBase),
							`authorize/${oauthMode(env.DLINE_E2E_OPENAI_CODEX_OAUTH_MODE)}`,
						),
						tokenEndpoint: appendPath(loopbackHttpUrl("DLINE_E2E_OPENAI_CODEX_OAUTH_BASE_URL", oauthBase), "token"),
						mode: oauthMode(env.DLINE_E2E_OPENAI_CODEX_OAUTH_MODE),
					},
				}
			: {}),
	}
}
