import type { AccountUsageData, AccountUsageQuotaData } from "@shared/ExtensionMessage"
import type { AccountUsage as ProtoAccountUsage, UsageQuota as ProtoUsageQuota } from "@shared/proto/cline/state"

/**
 * Convert a single proto UsageQuota to shared AccountUsageQuotaData.
 */
function protoToQuota(proto?: ProtoUsageQuota): AccountUsageQuotaData | undefined {
	if (!proto) {
		return undefined
	}
	return {
		type: proto.type,
		label: proto.label,
		used: proto.used,
		limit: proto.limit,
		resetAt: proto.resetAt ?? undefined,
		resetLabel: proto.resetLabel ?? undefined,
	}
}

/**
 * Convert shared AccountUsageQuotaData to proto UsageQuota.
 */
function quotaToProto(data?: AccountUsageQuotaData): ProtoUsageQuota | undefined {
	if (!data) {
		return undefined
	}
	return {
		type: data.type,
		label: data.label,
		used: data.used,
		limit: data.limit,
		resetAt: data.resetAt,
		resetLabel: data.resetLabel,
	}
}

/**
 * Convert proto AccountUsage to shared AccountUsageData.
 * Returns undefined when proto is undefined (not fetched yet).
 */
export function protoToAccountUsage(proto?: ProtoAccountUsage): AccountUsageData | undefined {
	if (!proto) {
		return undefined
	}
	return {
		currency: proto.currency,
		remainingBalance: proto.remainingBalance ?? undefined,
		toppedUpBalance: proto.toppedUpBalance ?? undefined,
		grantedBalance: proto.grantedBalance ?? undefined,
		quotas: proto.quotas?.map(protoToQuota).filter(Boolean) as AccountUsageQuotaData[] | undefined,
		isAvailable: proto.isAvailable ?? undefined,
		dailyInputTokens: proto.dailyInputTokens ?? undefined,
		dailyOutputTokens: proto.dailyOutputTokens ?? undefined,
		dailyCacheHitTokens: proto.dailyCacheHitTokens ?? undefined,
		dailyCacheMissTokens: proto.dailyCacheMissTokens ?? undefined,
	}
}

/**
 * Convert shared AccountUsageData to proto AccountUsage.
 * Returns undefined when data is undefined.
 */
export function accountUsageToProto(data?: AccountUsageData): ProtoAccountUsage | undefined {
	if (!data) {
		return undefined
	}
	return {
		currency: data.currency,
		remainingBalance: data.remainingBalance,
		toppedUpBalance: data.toppedUpBalance,
		grantedBalance: data.grantedBalance,
		quotas: (data.quotas?.map(quotaToProto).filter(Boolean) as ProtoUsageQuota[] | undefined) ?? [],
		isAvailable: data.isAvailable,
		dailyInputTokens: data.dailyInputTokens,
		dailyOutputTokens: data.dailyOutputTokens,
		dailyCacheHitTokens: data.dailyCacheHitTokens,
		dailyCacheMissTokens: data.dailyCacheMissTokens,
	}
}
