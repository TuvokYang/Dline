import {
	codexUsageProgressTone,
	OpenAiCodexUsageDetails,
	selectEffectiveCodexUsageWindow,
} from "@components/settings/providers/OpenAiCodexUsageDetails"
import { useOpenAiCodexUsage } from "@components/settings/providers/useOpenAiCodexUsage"
import { Popover, PopoverContent, PopoverTrigger } from "@components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@components/ui/tooltip"
import { GaugeIcon, LoaderIcon, RefreshCwIcon } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"

function formatTime(value: number | undefined): string | undefined {
	if (value === undefined) return undefined
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? undefined : date.toLocaleString()
}

function tooltipContent(state: ReturnType<typeof useOpenAiCodexUsage>) {
	if (state.loading && !state.usage) return <span>Loading ChatGPT Codex usage…</span>
	if (state.error && !state.usage) return <span>ChatGPT Codex usage unavailable</span>
	const usage = state.usage
	if (!usage) return <span>No ChatGPT Codex usage data</span>
	const nextCardExpiry = usage.resetCredits
		.map((credit) => credit.expiresAtMs)
		.filter((value): value is number => value !== undefined)
		.sort((left, right) => left - right)[0]
	return (
		<div className="flex max-w-72 flex-col gap-1">
			{usage.windows.map((window) => (
				<span key={`${window.type}:${window.limitWindowSeconds}`}>
					{window.label}: {window.usedPercent.toFixed(0)}% used
					{window.resetAtMs ? ` · resets ${formatTime(window.resetAtMs)}` : ""}
				</span>
			))}
			<span>Reset cards: {usage.resetCreditsAvailableCount}</span>
			{nextCardExpiry ? <span>Next card expires {formatTime(nextCardExpiry)}</span> : null}
		</div>
	)
}

/** Profile-scoped ChatGPT Codex usage control for the chat input toolbar. */
export function TaskOpenAiCodexUsageControl({ profileId }: { profileId: string }) {
	const [open, setOpen] = useState(false)
	const state = useOpenAiCodexUsage(profileId, true)
	const effectiveWindow = selectEffectiveCodexUsageWindow(state.usage?.windows ?? [])
	const tone = effectiveWindow ? codexUsageProgressTone(effectiveWindow.usedPercent) : undefined

	return (
		<Popover onOpenChange={setOpen} open={open}>
			<Tooltip>
				{!open ? <TooltipContent side="top">{tooltipContent(state)}</TooltipContent> : null}
				<TooltipTrigger asChild>
					<div className="flex size-[18.5px] shrink-0 items-center justify-center" data-chat-input-slot="codex-usage">
						<PopoverTrigger asChild>
							<button
								aria-label="OpenAI Codex usage"
								className={cn(
									"inline-flex size-[18.5px] shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-description shadow-none outline-none transition-colors duration-150 hover:bg-toolbar-hover hover:text-foreground focus-visible:bg-toolbar-hover",
									tone === "success" && "text-success",
									tone === "warning" && "text-editor-warning-foreground",
									tone === "danger" && "text-error",
								)}
								data-usage-tone={tone}
								type="button">
								{state.loading && !state.usage ? (
									<LoaderIcon aria-hidden="true" className="size-3 animate-spin" />
								) : (
									<GaugeIcon aria-hidden="true" className="size-3" />
								)}
							</button>
						</PopoverTrigger>
					</div>
				</TooltipTrigger>
			</Tooltip>
			<PopoverContent
				align="start"
				aria-label="OpenAI Codex usage details"
				className="w-72 overflow-hidden p-0 text-xs"
				side="top"
				sideOffset={4}
				style={{
					background: "var(--vscode-dropdown-background)",
					borderColor: "var(--vscode-dropdown-border)",
					color: "var(--vscode-foreground)",
				}}>
				<div className="flex items-center justify-between gap-2 border-b border-dropdown-border px-3 py-2">
					<span className="font-medium">ChatGPT Codex usage</span>
					<button
						aria-label="Refresh ChatGPT usage"
						className="flex size-6 items-center justify-center rounded-xs border-0 bg-transparent text-description hover:bg-toolbar-hover hover:text-foreground disabled:opacity-50"
						disabled={state.loading || state.refreshing}
						onClick={() => void state.refresh()}
						type="button">
						<RefreshCwIcon className={cn("size-3.5", state.refreshing && "animate-spin")} />
					</button>
				</div>
				<div className="p-3">
					{state.loading && !state.usage ? (
						<div className="flex items-center gap-2 text-description">
							<LoaderIcon className="size-3.5 animate-spin" />
							Loading usage…
						</div>
					) : state.usage ? (
						<OpenAiCodexUsageDetails state={state} />
					) : (
						<div className="text-error" role="alert">
							{state.error ?? "No ChatGPT Codex usage data."}
						</div>
					)}
				</div>
			</PopoverContent>
		</Popover>
	)
}
