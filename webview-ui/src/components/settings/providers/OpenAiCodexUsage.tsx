import { OpenAiCodexRateLimitResetOutcome, type OpenAiCodexUsageWindow } from "@shared/proto/dline/account"
import { ChevronDownIcon, ChevronRightIcon, LoaderIcon, RefreshCwIcon, RotateCcwIcon, TriangleAlertIcon } from "lucide-react"
import { useState } from "react"
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/common/AlertDialog"
import { cn } from "@/lib/utils"
import { useOpenAiCodexUsage } from "./useOpenAiCodexUsage"

export function selectEffectiveCodexUsageWindow(windows: readonly OpenAiCodexUsageWindow[]): OpenAiCodexUsageWindow | undefined {
	return [...windows].sort((left, right) => {
		const remainingDifference = left.remainingPercent - right.remainingPercent
		if (remainingDifference !== 0) return remainingDifference
		if (left.type === "5hour") return -1
		if (right.type === "5hour") return 1
		return 0
	})[0]
}

function formatResetTime(resetAtMs: number | undefined): string | undefined {
	if (resetAtMs === undefined) return undefined
	const date = new Date(resetAtMs)
	return Number.isNaN(date.getTime()) ? undefined : date.toLocaleString()
}

function remainingLabel(window: OpenAiCodexUsageWindow): string {
	return `${window.label} ${Math.max(0, Math.min(100, window.remainingPercent)).toFixed(0)}%`
}

function resetResultMessage(outcome: OpenAiCodexRateLimitResetOutcome, windowsReset: readonly string[]): string {
	switch (outcome) {
		case OpenAiCodexRateLimitResetOutcome.OPEN_AI_CODEX_RATE_LIMIT_RESET_OUTCOME_RESET:
			return windowsReset.length > 0
				? `Reset completed for ${windowsReset.join(" and ")}.`
				: "Eligible rate limits were reset."
		case OpenAiCodexRateLimitResetOutcome.OPEN_AI_CODEX_RATE_LIMIT_RESET_OUTCOME_NOTHING_TO_RESET:
			return "No rate limit currently needs to be reset."
		case OpenAiCodexRateLimitResetOutcome.OPEN_AI_CODEX_RATE_LIMIT_RESET_OUTCOME_NO_CREDIT:
			return "No reset card is available."
		case OpenAiCodexRateLimitResetOutcome.OPEN_AI_CODEX_RATE_LIMIT_RESET_OUTCOME_ALREADY_REDEEMED:
			return "This reset request was already redeemed."
		default:
			return "The reset request returned an unknown result."
	}
}

export function OpenAiCodexUsage({ profileId, enabled }: { profileId: string; enabled: boolean }) {
	const state = useOpenAiCodexUsage(profileId, enabled)
	const [expanded, setExpanded] = useState(false)
	const [confirmReset, setConfirmReset] = useState(false)
	const [resultMessage, setResultMessage] = useState<string>()
	const usage = state.usage
	const effectiveWindow = selectEffectiveCodexUsageWindow(usage?.windows ?? [])
	const canExpand = usage?.isAvailable === true
	const summary = state.loading
		? "Loading usage…"
		: state.error
			? "Usage unavailable"
			: effectiveWindow
				? remainingLabel(effectiveWindow)
				: usage?.creditsBalance !== undefined
					? `$${usage.creditsBalance.toFixed(2)}`
					: "No usage data"

	const consumeReset = async () => {
		const result = await state.consumeResetCredit()
		if (!result) return
		setResultMessage(resetResultMessage(result.outcome, result.windowsReset))
		setConfirmReset(false)
	}

	return (
		<div aria-label="ChatGPT usage" className="flex min-w-0 flex-col gap-2" style={{ marginBottom: 10, marginTop: 10 }}>
			<div className="flex min-w-0 items-center justify-between gap-2">
				<span className="text-xs font-medium">Usage</span>
				<button
					aria-label="Refresh ChatGPT usage"
					className="flex size-6 items-center justify-center rounded-xs border-0 bg-transparent text-description hover:bg-toolbar-hover hover:text-foreground disabled:opacity-50"
					disabled={!enabled || state.loading || state.refreshing}
					onClick={() => void state.refresh()}
					type="button">
					<RefreshCwIcon className={cn("size-3.5", state.refreshing && "animate-spin")} />
				</button>
			</div>
			<button
				aria-expanded={expanded}
				className="flex min-h-8 w-full items-center justify-between gap-2 rounded-xs border border-dropdown-border bg-dropdown-background px-2 text-left text-sm text-dropdown-foreground hover:border-focus-border disabled:cursor-default disabled:opacity-60"
				disabled={!canExpand}
				onClick={() => setExpanded((value) => !value)}
				type="button">
				<span className="flex min-w-0 items-center gap-1.5">
					{state.loading ? <LoaderIcon className="size-3.5 shrink-0 animate-spin" /> : null}
					<span className="truncate">{summary}</span>
				</span>
				{canExpand ? expanded ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" /> : null}
			</button>
			{expanded && usage ? (
				<div className="flex flex-col gap-2 rounded-xs border border-editor-widget-border/60 bg-toolbar-hover/20 p-2 text-xs">
					{usage.windows.map((window) => {
						const resetAt = formatResetTime(window.resetAtMs)
						return (
							<div className="flex flex-col gap-1" key={`${window.type}:${window.limitWindowSeconds}`}>
								<div className="flex items-center justify-between gap-2">
									<span>{window.label}</span>
									<span className="font-medium text-foreground">
										{window.remainingPercent.toFixed(0)}% remaining
									</span>
								</div>
								<div className="h-1.5 overflow-hidden rounded-full bg-editor-widget-border/50">
									<div
										className="h-full rounded-full bg-focus-border transition-[width]"
										style={{ width: `${Math.max(0, Math.min(100, window.remainingPercent))}%` }}
									/>
								</div>
								{resetAt ? <span className="text-description">Resets {resetAt}</span> : null}
							</div>
						)
					})}
					<div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-editor-widget-border/50 pt-2">
						<span className="text-description">
							Reset cards: {usage.resetCreditsAvailableCount > 0 ? usage.resetCreditsAvailableCount : "none"}
						</span>
						{usage.resetCreditsAvailableCount > 0 ? (
							<button
								className="inline-flex min-h-7 items-center gap-1 rounded-xs bg-button-secondary-background px-2 text-button-secondary-foreground hover:bg-button-secondary-background-hover disabled:opacity-50"
								disabled={state.resetting}
								onClick={() => {
									setResultMessage(undefined)
									setConfirmReset(true)
								}}
								type="button">
								<RotateCcwIcon className="size-3.5" />
								Reset limits
							</button>
						) : null}
					</div>
					{state.resetError ? (
						<div className="text-error" role="alert">
							{state.resetError}
						</div>
					) : null}
					{resultMessage ? (
						<div className="text-description" role="status">
							{resultMessage}
						</div>
					) : null}
				</div>
			) : null}
			{state.error ? (
				<div className="text-xs text-error" role="alert">
					{state.error}
				</div>
			) : null}
			<AlertDialog onOpenChange={(open) => !state.resetting && setConfirmReset(open)} open={confirmReset}>
				<AlertDialogContent aria-label="Use a rate-limit reset card?">
					<AlertDialogHeader>
						<AlertDialogTitle>
							<TriangleAlertIcon className="size-5 text-editor-warning-foreground" />
							Use a rate-limit reset card?
						</AlertDialogTitle>
						<AlertDialogDescription>
							This consumes one reset card and resets eligible ChatGPT Codex limits. The card cannot be restored
							after use.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<button
							className="min-h-7 rounded-xs bg-button-secondary-background px-3 text-sm text-button-secondary-foreground hover:bg-button-secondary-background-hover disabled:opacity-50"
							disabled={state.resetting}
							onClick={() => setConfirmReset(false)}
							type="button">
							Cancel
						</button>
						<button
							className="min-h-7 rounded-xs bg-button-background px-3 text-sm text-button-foreground hover:bg-button-background-hover disabled:opacity-50"
							disabled={state.resetting}
							onClick={() => void consumeReset()}
							type="button">
							{state.resetting ? "Resetting…" : "Use reset card"}
						</button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	)
}
