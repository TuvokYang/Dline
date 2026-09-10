import { AccountUsageResetCreditRequest, type AccountUsageResetResult, ProviderUsageRequest } from "@shared/proto/dline/account"
import { LoaderIcon, RefreshCwIcon } from "lucide-react"
import { useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient } from "@/services/grpc-client"
import {
	formatProviderUsageCurrency,
	ProviderUsageDetails,
	selectEffectiveUsageQuota,
	usageRemainingPercent,
	usageUsedPercent,
} from "../settings/providers/ProviderUsageDetails"

const fmt = (n: number): string => {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
	return String(n)
}

const formatTime = (value: string | undefined): string | undefined => {
	if (!value) return undefined
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? undefined : date.toLocaleString()
}

/** Existing account usage surface, enhanced by provider-owned capability data. */
export const UsageBar = () => {
	const { accountUsage } = useExtensionState()
	const [open, setOpen] = useState(false)
	const [refreshing, setRefreshing] = useState(false)
	const [resetting, setResetting] = useState(false)
	const [resetError, setResetError] = useState<string>()

	if (!accountUsage) return null
	const quotas = accountUsage.quotas?.filter((quota) => quota.limit > 0) ?? []
	const effectiveQuota = selectEffectiveUsageQuota(quotas)
	const supportsResetCredits = accountUsage.resetCredits !== undefined || accountUsage.resetCreditsAvailableCount !== undefined
	const nextResetCreditExpiry = accountUsage.resetCredits
		?.map((credit) => credit.expiresAt)
		.filter((value): value is string => value !== undefined && Number.isFinite(Date.parse(value)))
		.sort((left, right) => Date.parse(left) - Date.parse(right))[0]
	const summary = effectiveQuota
		? `${effectiveQuota.type === "5hour" ? "5h:" : effectiveQuota.type === "weekly" ? "7d:" : `${effectiveQuota.label}:`} ${usageRemainingPercent(effectiveQuota).toFixed(0)}%`
		: !accountUsage.planType && accountUsage.remainingBalance !== undefined
			? formatProviderUsageCurrency(accountUsage.currency, accountUsage.remainingBalance)
			: undefined
	if (!summary) return null

	const tooltip = (
		<div className="flex max-w-72 flex-col gap-1">
			{quotas.map((quota) => {
				const resetAt = formatTime(quota.resetAt)
				return (
					<span key={`${quota.type}:${quota.label}`}>
						{quota.label}: {usageUsedPercent(quota).toFixed(0)}% used
						{resetAt ? ` · resets ${resetAt}` : ""}
					</span>
				)
			})}
			{supportsResetCredits ? <span>Reset cards: {accountUsage.resetCreditsAvailableCount ?? 0}</span> : null}
			{nextResetCreditExpiry ? <span>Next card expires {formatTime(nextResetCreditExpiry)}</span> : null}
			{!accountUsage.planType && accountUsage.remainingBalance !== undefined ? (
				<span>Balance: {formatProviderUsageCurrency(accountUsage.currency, accountUsage.remainingBalance)}</span>
			) : null}
			{accountUsage.dailyInputTokens !== undefined ? <span>Today In: {fmt(accountUsage.dailyInputTokens)}</span> : null}
			{accountUsage.dailyOutputTokens !== undefined ? <span>Today Out: {fmt(accountUsage.dailyOutputTokens)}</span> : null}
		</div>
	)

	const refresh = async () => {
		if (!accountUsage.profileId || refreshing) return
		setRefreshing(true)
		try {
			await AccountServiceClient.getProviderUsage(ProviderUsageRequest.create({ profileId: accountUsage.profileId }))
		} finally {
			setRefreshing(false)
		}
	}

	const consumeResetCredit = async (creditId: string): Promise<AccountUsageResetResult | undefined> => {
		if (!accountUsage.profileId || resetting) return undefined
		setResetError(undefined)
		setResetting(true)
		try {
			return await AccountServiceClient.consumeAccountUsageResetCredit(
				AccountUsageResetCreditRequest.create({ profileId: accountUsage.profileId, creditId }),
			)
		} catch {
			setResetError("The Provider rate-limit reset could not be completed.")
			return undefined
		} finally {
			setResetting(false)
		}
	}

	return (
		<Popover onOpenChange={setOpen} open={open}>
			<Tooltip>
				{!open ? <TooltipContent side="top">{tooltip}</TooltipContent> : null}
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<button
							aria-label="Provider usage"
							className="chat-input-control-outline inline-flex h-[18.5px] shrink-0 cursor-pointer items-center rounded-sm border-0 bg-toolbar-hover px-1 py-0 text-xs font-medium leading-[18px] text-foreground shadow-none max-[420px]:hidden"
							data-chat-input-slot="provider-usage"
							type="button">
							{summary}
						</button>
					</PopoverTrigger>
				</TooltipTrigger>
			</Tooltip>
			<PopoverContent
				align="end"
				aria-label="Provider usage details"
				className="w-72 overflow-hidden p-0 text-xs"
				side="top"
				sideOffset={4}
				style={{
					background: "var(--vscode-dropdown-background)",
					borderColor: "var(--vscode-dropdown-border)",
					color: "var(--vscode-foreground)",
				}}>
				<div className="flex items-center justify-between gap-2 border-b border-dropdown-border px-3 py-2">
					<span className="font-medium">Usage</span>
					<button
						aria-label="Refresh Provider usage"
						className="flex size-6 items-center justify-center rounded-xs border-0 bg-transparent text-description hover:bg-toolbar-hover hover:text-foreground disabled:opacity-50"
						disabled={!accountUsage.profileId || refreshing}
						onClick={() => void refresh()}
						type="button">
						{refreshing ? <LoaderIcon className="size-3.5 animate-spin" /> : <RefreshCwIcon className="size-3.5" />}
					</button>
				</div>
				<div className="p-3">
					<ProviderUsageDetails
						consumeResetCredit={consumeResetCredit}
						resetError={resetError}
						resetting={resetting}
						usage={accountUsage}
					/>
				</div>
			</PopoverContent>
		</Popover>
	)
}
