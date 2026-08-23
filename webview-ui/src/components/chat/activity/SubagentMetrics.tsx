import { formatTokenMetric } from "../task-header/util"

interface SubagentMetricsProps {
	toolCalls: number | undefined
	startedAt: number | undefined
	finishedAt: number | undefined
	inputTokens: number | undefined
	outputTokens: number | undefined
	cacheHitRate?: number
	totalCost: number | undefined
	currency: string | undefined
	className?: string
}

function normalizeCount(value: number | undefined): number {
	return Number.isFinite(value) ? Math.max(0, Math.round(value ?? 0)) : 0
}

export function formatSubagentDuration(startedAt: number | undefined, finishedAt: number | undefined): string {
	if (!Number.isFinite(startedAt)) return "0s"

	const normalizedStart = startedAt as number
	const normalizedEnd = Number.isFinite(finishedAt) ? (finishedAt as number) : Date.now()
	const seconds = Math.max(0, Math.floor((normalizedEnd - normalizedStart) / 1000))
	const minutes = Math.floor(seconds / 60)
	return minutes > 0 ? `${minutes}:${String(seconds % 60).padStart(2, "0")}` : `${seconds}s`
}

function formatSubagentCost(totalCost: number | undefined, currency: string | undefined): string {
	const normalizedCost = Number.isFinite(totalCost) ? Math.max(0, totalCost ?? 0) : 0
	const currencyCode = currency?.trim().toUpperCase() || "USD"
	const maximumFractionDigits = normalizedCost >= 0.01 ? 2 : 4
	const currencySymbols: Record<string, string> = { CNH: "¥", CNY: "¥", RMB: "¥", JPY: "¥", USD: "$", EUR: "€", GBP: "£" }
	const symbol = currencySymbols[currencyCode] ?? currencyCode
	return `${symbol}${normalizedCost.toFixed(maximumFractionDigits)}`
}

export function SubagentMetrics({
	toolCalls,
	startedAt,
	finishedAt,
	inputTokens,
	outputTokens,
	cacheHitRate,
	totalCost,
	currency,
	className,
}: SubagentMetricsProps) {
	const normalizedToolCalls = normalizeCount(toolCalls)
	const normalizedInputTokens = normalizeCount(inputTokens)
	const normalizedOutputTokens = normalizeCount(outputTokens)
	const normalizedCacheHitRate = Number.isFinite(cacheHitRate) ? Math.max(0, Math.min(100, cacheHitRate ?? 0)) : undefined
	const classes = [
		"inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-description tabular-nums",
		className,
	]
		.filter(Boolean)
		.join(" ")

	return (
		<span className={classes} data-testid="subagent-metrics">
			<span>{`${normalizedToolCalls} ${normalizedToolCalls === 1 ? "tool" : "tools"}`}</span>
			<span aria-hidden="true">·</span>
			<span>{formatSubagentDuration(startedAt, finishedAt)}</span>
			<span aria-hidden="true">·</span>
			<span>{`In:${formatTokenMetric(normalizedInputTokens)}`}</span>
			<span>{`Out:${formatTokenMetric(normalizedOutputTokens)}`}</span>
			{normalizedCacheHitRate !== undefined && (
				<span>{`Cache:${normalizedCacheHitRate.toFixed(2).replace(/\.00$/, "")}%`}</span>
			)}
			<span aria-hidden="true">·</span>
			<span>{formatSubagentCost(totalCost, currency)}</span>
		</span>
	)
}
