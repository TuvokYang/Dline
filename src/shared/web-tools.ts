export type WebToolPresentationStatus = "running" | "completed" | "failed"

export interface WebToolSourcePresentation {
	id: string
	label: string
	execution: "hosted" | "dline"
	provider?: string
}

export interface WebSearchItemPresentation {
	url: string
	title?: string
	snippet?: string
}

export interface WebSearchPresentationV1 {
	schemaVersion: 1
	status: WebToolPresentationStatus
	source?: WebToolSourcePresentation
	query?: string
	items?: WebSearchItemPresentation[]
	error?: string
}

export interface WebFetchPresentationV1 {
	schemaVersion: 1
	status: WebToolPresentationStatus
	source?: WebToolSourcePresentation
	url: string
	prompt?: string
	content?: string
	error?: string
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function normalizeSearchItem(value: unknown): WebSearchItemPresentation | undefined {
	const record = asRecord(value)
	if (!record) return undefined

	const url = nonEmptyString(record.url)
	if (!url) return undefined

	const title = nonEmptyString(record.title)
	const snippet = nonEmptyString(record.snippet) ?? nonEmptyString(record.content)
	return {
		url,
		...(title ? { title } : {}),
		...(snippet ? { snippet } : {}),
	}
}

/** Normalize provider-native and local Web Search payloads before they cross the UI message boundary. */
export function normalizeWebSearchItems(result: unknown): WebSearchItemPresentation[] {
	const record = asRecord(result)
	const action = asRecord(record?.action)
	const candidates = Array.isArray(result)
		? result
		: Array.isArray(record?.items)
			? record.items
			: Array.isArray(record?.results)
				? record.results
				: Array.isArray(record?.sources)
					? record.sources
					: Array.isArray(action?.sources)
						? action.sources
						: []

	const items: WebSearchItemPresentation[] = []
	const seenUrls = new Set<string>()
	for (const candidate of candidates) {
		const item = normalizeSearchItem(candidate)
		if (!item || seenUrls.has(item.url)) continue
		seenUrls.add(item.url)
		items.push(item)
	}
	return items
}
