export const DEFERRED_PROVIDER_IDS: ReadonlySet<string> = new Set(["openrouter", "vercel-ai-gateway"])

export function isDeferredProvider(providerId: string): boolean {
	return DEFERRED_PROVIDER_IDS.has(providerId)
}
