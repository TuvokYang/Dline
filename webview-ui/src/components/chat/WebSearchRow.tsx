import type { ClineSayTool } from "@shared/ExtensionMessage"
import { SearchIcon, TriangleAlertIcon } from "lucide-react"

interface WebSearchResultItem {
	title: string
	url: string
	snippet?: string
}

interface WebSearchRowProps {
	messageType: "ask" | "say"
	query?: string
	webSearch?: ClineSayTool["webSearch"]
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function parseResultItem(value: unknown): WebSearchResultItem | undefined {
	const record = asRecord(value)
	if (!record) return undefined
	const title = nonEmptyString(record.title)
	const url = nonEmptyString(record.url)
	if (!title || !url) return undefined
	const snippet = nonEmptyString(record.snippet) ?? nonEmptyString(record.content)
	return { title, url, ...(snippet ? { snippet } : {}) }
}

function parseResultItems(result: unknown): readonly WebSearchResultItem[] {
	const record = asRecord(result)
	const candidates = Array.isArray(result)
		? result
		: Array.isArray(record?.items)
			? record.items
			: Array.isArray(record?.results)
				? record.results
				: []
	return candidates.flatMap((candidate) => {
		const item = parseResultItem(candidate)
		return item ? [item] : []
	})
}

const WebSearchRow = ({ messageType, query, webSearch }: WebSearchRowProps) => {
	const source = webSearch?.source
	const sourceSuffix = source?.execution === "hosted" ? "Hosted" : source?.execution === "dline" ? "Dline" : undefined
	const sourceLabel = source ? `${source.label}${sourceSuffix ? ` (${sourceSuffix})` : ""}` : undefined
	const items = parseResultItems(webSearch?.result)

	return (
		<div data-testid="web-search-card">
			<div className="mb-3 flex items-center gap-2.5">
				<SearchIcon className="size-2 rotate-90" />
				<span className="font-bold">
					{messageType === "ask" ? "Dline wants to search the web for:" : "Dline searched the web for:"}
				</span>
			</div>
			<div className="space-y-2 overflow-hidden rounded-xs border border-editor-group-border bg-code px-2.5 py-[9px] select-text">
				{sourceLabel && <div className="text-xs font-semibold text-description">{sourceLabel}</div>}
				<div className="ph-no-capture break-words">{query}</div>
				{webSearch?.error && (
					<div className="flex items-start gap-2 rounded border border-error/40 bg-error/10 p-2 text-error">
						<TriangleAlertIcon className="mt-0.5 size-3 shrink-0" />
						<span className="ph-no-capture break-words text-xs">{webSearch.error}</span>
					</div>
				)}
				{items.length > 0 && (
					<div className="space-y-2 border-t border-editor-widget-border/50 pt-2">
						{items.map((item, index) => (
							<div className="space-y-0.5" key={`${item.url}:${index}`}>
								<div className="font-medium ph-no-capture break-words">{item.title}</div>
								<div className="text-link ph-no-capture break-all text-xs">{item.url}</div>
								{item.snippet && (
									<div className="text-description ph-no-capture break-words text-xs">{item.snippet}</div>
								)}
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	)
}

export default WebSearchRow
