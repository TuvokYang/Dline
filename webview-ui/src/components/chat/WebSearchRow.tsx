import type { ClineSayTool } from "@shared/ExtensionMessage"
import { ChevronDownIcon, ChevronRightIcon, SearchIcon, TriangleAlertIcon } from "lucide-react"
import { useState } from "react"

interface WebSearchRowProps {
	messageType: "ask" | "say"
	query?: string
	webSearch?: ClineSayTool["webSearch"]
}

function resultTitle(title: string | undefined, url: string): string {
	if (title) return title
	try {
		return new URL(url).hostname || url
	} catch {
		return url
	}
}

const WebSearchRow = ({ messageType, query, webSearch }: WebSearchRowProps) => {
	const source = webSearch?.source
	const sourceSuffix = source?.execution === "hosted" ? "Hosted" : source?.execution === "dline" ? "Dline" : undefined
	const sourceLabel = source ? `${source.label}${sourceSuffix ? ` (${sourceSuffix})` : ""}` : undefined
	const resolvedQuery = webSearch?.query || query
	const items = webSearch?.items ?? []
	const [detailsExpanded, setDetailsExpanded] = useState(false)

	return (
		<div className="max-h-[40vh] overflow-y-auto pr-1" data-testid="web-search-card">
			<div className="mb-3 flex items-center gap-2.5">
				<SearchIcon className="size-2 rotate-90" />
				<span className="font-bold">
					{messageType === "ask" ? "Dline wants to search the web for:" : "Dline searched the web for:"}
				</span>
			</div>
			<div className="space-y-2 overflow-hidden rounded-xs border border-editor-group-border bg-code px-2.5 py-[9px] select-text">
				{sourceLabel && <div className="text-xs font-semibold text-description">{sourceLabel}</div>}
				<div className="ph-no-capture break-words">{resolvedQuery}</div>
				{webSearch?.error && (
					<div className="flex items-start gap-2 rounded border border-error/40 bg-error/10 p-2 text-error">
						<TriangleAlertIcon className="mt-0.5 size-3 shrink-0" />
						<span className="ph-no-capture break-words text-xs">{webSearch.error}</span>
					</div>
				)}
				{items.length > 0 && (
					<>
						<button
							aria-expanded={detailsExpanded}
							aria-label={detailsExpanded ? "Collapse web search results" : "Expand web search results"}
							className="flex w-full cursor-pointer items-center gap-1 border-0 border-t border-editor-widget-border/50 bg-transparent pt-2 text-left text-xs text-description"
							data-testid="web-search-details-toggle"
							onClick={() => setDetailsExpanded((expanded) => !expanded)}
							type="button">
							{detailsExpanded ? (
								<ChevronDownIcon aria-hidden="true" className="size-3 shrink-0" />
							) : (
								<ChevronRightIcon aria-hidden="true" className="size-3 shrink-0" />
							)}
							<span>{detailsExpanded ? "Hide results" : `Show results (${items.length})`}</span>
						</button>
						{detailsExpanded && (
							<div
								className="space-y-2 border-t border-editor-widget-border/50 pt-2"
								data-testid="web-search-results">
								{items.map((item) => (
									<div className="space-y-0.5" key={item.url}>
										<div className="font-medium ph-no-capture break-words">
											{resultTitle(item.title, item.url)}
										</div>
										<div className="text-link ph-no-capture break-all text-xs">{item.url}</div>
										{item.snippet && (
											<div className="text-description ph-no-capture break-words text-xs">
												{item.snippet}
											</div>
										)}
									</div>
								))}
							</div>
						)}
					</>
				)}
			</div>
		</div>
	)
}

export default WebSearchRow
