import type { OpenAiCodexRateLimitResetOutcome, OpenAiCodexUsageWindow } from "@shared/proto/dline/account"
import { TriangleAlertIcon } from "lucide-react"
import { useState } from "react"
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/common/AlertDialog"
import type { OpenAiCodexUsageState } from "./useOpenAiCodexUsage"

const RESET_OUTCOME = {
	reset: 1,
	nothingToReset: 2,
	noCredit: 3,
	alreadyRedeemed: 4,
} as const satisfies Record<string, OpenAiCodexRateLimitResetOutcome>

export type CodexUsageProgressTone = "success" | "warning" | "danger"

export function selectEffectiveCodexUsageWindow(windows: readonly OpenAiCodexUsageWindow[]): OpenAiCodexUsageWindow | undefined {
	return [...windows].sort((left, right) => {
		const remainingDifference = left.remainingPercent - right.remainingPercent
		if (remainingDifference !== 0) return remainingDifference
		if (left.type === "5hour") return -1
		if (right.type === "5hour") return 1
		return 0
	})[0]
}

export function codexUsageProgressTone(usedPercent: number): CodexUsageProgressTone {
	if (usedPercent >= 100) return "danger"
	if (usedPercent >= 80) return "warning"
	return "success"
}

export function remainingLabel(window: OpenAiCodexUsageWindow): string {
	return `${window.label} ${Math.max(0, Math.min(100, window.remainingPercent)).toFixed(0)}%`
}

export function compactUsageLabel(window: OpenAiCodexUsageWindow): string {
	const label = window.type === "5hour" ? "5h" : window.type === "weekly" ? "7d" : window.label
	return `${label} ${Math.max(0, Math.min(100, window.usedPercent)).toFixed(0)}%`
}

function clampPercent(value: number): number {
	return Math.max(0, Math.min(100, value))
}

function progressColor(tone: CodexUsageProgressTone): string {
	switch (tone) {
		case "danger":
			return "var(--vscode-charts-red, #ef4444)"
		case "warning":
			return "var(--vscode-charts-orange, #f59e0b)"
		default:
			return "var(--vscode-charts-green, #22c55e)"
	}
}

export function OpenAiCodexUsageProgressBar({ window }: { window: OpenAiCodexUsageWindow }) {
	const usedPercent = clampPercent(window.usedPercent)
	const tone = codexUsageProgressTone(usedPercent)
	return (
		<div
			aria-label={`${window.label} usage`}
			aria-valuemax={100}
			aria-valuemin={0}
			aria-valuenow={usedPercent}
			className="h-1.5 overflow-hidden rounded-full bg-editor-widget-border/60"
			data-usage-tone={tone}
			role="progressbar">
			<div
				className="h-full rounded-full transition-[width]"
				style={{ backgroundColor: progressColor(tone), width: `${usedPercent}%` }}
			/>
		</div>
	)
}

function formatResetTime(resetAtMs: number | undefined): string | undefined {
	if (resetAtMs === undefined) return undefined
	const date = new Date(resetAtMs)
	return Number.isNaN(date.getTime()) ? undefined : date.toLocaleString()
}

function resetResultMessage(outcome: OpenAiCodexRateLimitResetOutcome, windowsReset: readonly string[]): string {
	switch (outcome) {
		case RESET_OUTCOME.reset:
			return windowsReset.length > 0
				? `Reset completed for ${windowsReset.join(" and ")}.`
				: "Eligible rate limits were reset."
		case RESET_OUTCOME.nothingToReset:
			return "No rate limit currently needs to be reset."
		case RESET_OUTCOME.noCredit:
			return "No reset card is available."
		case RESET_OUTCOME.alreadyRedeemed:
			return "This reset request was already redeemed."
		default:
			return "The reset request returned an unknown result."
	}
}

export function OpenAiCodexUsageDetails({ state }: { state: OpenAiCodexUsageState }) {
	const [selectedCreditId, setSelectedCreditId] = useState<string>()
	const [resultMessage, setResultMessage] = useState<string>()
	const usage = state.usage
	if (!usage) return null
	const selectedCredit = usage.resetCredits.find((credit) => credit.id === selectedCreditId)

	const consumeReset = async () => {
		if (!selectedCreditId) return
		const result = await state.consumeResetCredit(selectedCreditId)
		if (!result) return
		setResultMessage(resetResultMessage(result.outcome, result.windowsReset))
		setSelectedCreditId(undefined)
	}

	return (
		<>
			<div className="flex flex-col gap-2 text-xs">
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
							<OpenAiCodexUsageProgressBar window={window} />
							{resetAt ? <span className="text-description">Resets {resetAt}</span> : null}
						</div>
					)
				})}
				<div className="mt-1 flex flex-col gap-1.5 border-t border-editor-widget-border/50 pt-2">
					<span className="font-medium text-foreground">
						Reset cards: {usage.resetCreditsAvailableCount > 0 ? usage.resetCreditsAvailableCount : "none"}
					</span>
					{usage.resetCredits.length > 0 ? (
						<ul className="m-0 flex list-none flex-col gap-1 p-0">
							{usage.resetCredits.map((credit, index) => {
								const expiresAt = formatResetTime(credit.expiresAtMs)
								return (
									<li
										className="flex min-w-0 items-center justify-between gap-2 rounded-xs bg-toolbar-hover/30 px-2 py-1.5"
										key={credit.id}>
										<span className="min-w-0">
											<span className="block font-medium text-foreground">Reset card {index + 1}</span>
											<span className="block truncate text-description">
												{expiresAt ? `Expires ${expiresAt}` : "Expiry unavailable"}
											</span>
										</span>
										<button
											aria-label={`Use reset card ${index + 1}`}
											className="inline-flex min-h-7 shrink-0 items-center rounded-xs border border-error/70 bg-error/15 px-2 font-medium text-error hover:bg-error/25 disabled:opacity-50"
											disabled={state.resetting}
											onClick={() => {
												setResultMessage(undefined)
												setSelectedCreditId(credit.id)
											}}
											type="button">
											Use card
										</button>
									</li>
								)
							})}
						</ul>
					) : (
						<span className="text-description">No available reset cards.</span>
					)}
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
			<AlertDialog
				onOpenChange={(open) => !open && !state.resetting && setSelectedCreditId(undefined)}
				open={selectedCreditId !== undefined}>
				<AlertDialogContent aria-label="Use a rate-limit reset card?">
					<AlertDialogHeader>
						<AlertDialogTitle>
							<TriangleAlertIcon className="size-5 text-editor-warning-foreground" />
							Use a rate-limit reset card?
						</AlertDialogTitle>
						<AlertDialogDescription>
							This consumes the selected reset card and resets eligible ChatGPT Codex limits. The card cannot be
							restored after use.
							{selectedCredit?.expiresAtMs ? ` It expires ${formatResetTime(selectedCredit.expiresAtMs)}.` : ""}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<button
							className="min-h-7 rounded-xs bg-button-secondary-background px-3 text-sm text-button-secondary-foreground hover:bg-button-secondary-background-hover disabled:opacity-50"
							disabled={state.resetting}
							onClick={() => setSelectedCreditId(undefined)}
							type="button">
							Cancel
						</button>
						<button
							className="min-h-7 rounded-xs border border-error/70 bg-error/15 px-3 text-sm font-medium text-error hover:bg-error/25 disabled:opacity-50"
							disabled={state.resetting}
							onClick={() => void consumeReset()}
							type="button">
							{state.resetting ? "Resetting…" : "Use reset card"}
						</button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}
