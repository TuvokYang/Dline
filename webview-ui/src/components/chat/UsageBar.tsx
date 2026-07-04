import { useExtensionState } from "@/context/ExtensionStateContext"

const fmt = (n: number): string => {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
	return String(n)
}

const formatCurrency = (currency: string | undefined, amount: number): string => {
	const code = (currency || "USD").toUpperCase()
	if (code === "CNY") {
		return `￥${amount.toFixed(2)}`
	}

	try {
		return new Intl.NumberFormat(undefined, {
			style: "currency",
			currency: code,
			currencyDisplay: "narrowSymbol",
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}).format(amount)
	} catch {
		return `${code} ${amount.toFixed(2)}`
	}
}

/**
 * Compact usage badge placed between provider name and Plan/Act toggle.
 * Hover to show detailed tooltip with balance, today in/out, cache hit rate.
 */
export const UsageBar = () => {
	const { accountUsage } = useExtensionState()

	const baseClass =
		"inline-flex items-center gap-1 text-xs text-description select-none whitespace-nowrap cursor-default group relative"

	if (!accountUsage) {
		return (
			<span className={baseClass}>
				<span className="font-medium text-description">--</span>
				<span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:inline-flex flex-col gap-0.5 bg-dropdown-background border border-editor-group-border rounded-[3px] px-2 py-1 shadow-lg z-50 text-[10px] whitespace-nowrap">
					<span>Usage unavailable for this profile</span>
					<span>Provider does not expose account usage data</span>
				</span>
			</span>
		)
	}

	const balance = accountUsage?.remainingBalance ?? 0
	const dailyIn = accountUsage?.dailyInputTokens ?? 0
	const dailyOut = accountUsage?.dailyOutputTokens ?? 0
	const dailyCacheTotal = (accountUsage?.dailyCacheHitTokens ?? 0) + (accountUsage?.dailyCacheMissTokens ?? 0)
	const dailyCacheHitRate = dailyCacheTotal > 0 ? ((accountUsage?.dailyCacheHitTokens ?? 0) / dailyCacheTotal) * 100 : 0
	return (
		<span className={baseClass}>
			<span className="font-medium text-foreground">{formatCurrency(accountUsage.currency, balance)}</span>
			{/* Tooltip on hover */}
			<span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:inline-flex flex-col gap-0.5 bg-dropdown-background border border-editor-group-border rounded-[3px] px-2 py-1 shadow-lg z-50 text-[10px] whitespace-nowrap">
				<span>Today In: {fmt(dailyIn)}</span>
				<span>Today Out: {fmt(dailyOut)}</span>
				{dailyCacheHitRate > 0 && <span>Cache Hit: {dailyCacheHitRate.toFixed(1)}%</span>}
				<span>Account-level usage</span>
				<span>Profiles sharing a key show the same balance</span>
			</span>
		</span>
	)
}
