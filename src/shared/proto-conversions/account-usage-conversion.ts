import type { AccountUsageData, AccountUsageQuotaData, AccountUsageResetCreditData } from "@shared/ExtensionMessage"
import type {
	AccountUsage as ProtoAccountUsage,
	AccountUsageResetCredit as ProtoAccountUsageResetCredit,
	UsageQuota as ProtoUsageQuota,
} from "@shared/proto/dline/state"

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
		windowSeconds: proto.windowSeconds ?? undefined,
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
		windowSeconds: data.windowSeconds,
		resetAt: data.resetAt,
		resetLabel: data.resetLabel,
	}
}

function protoToResetCredit(proto?: ProtoAccountUsageResetCredit): AccountUsageResetCreditData | undefined {
	if (!proto?.id) return undefined
	return {
		id: proto.id,
		grantedAt: proto.grantedAt ?? undefined,
		expiresAt: proto.expiresAt ?? undefined,
	}
}

function resetCreditToProto(data?: AccountUsageResetCreditData): ProtoAccountUsageResetCredit | undefined {
	if (!data?.id) return undefined
	return {
		id: data.id,
		grantedAt: data.grantedAt,
		expiresAt: data.expiresAt,
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
		profileId: proto.profileId ?? undefined,
		providerId: proto.providerId ?? undefined,
		currency: proto.currency,
		remainingBalance: proto.remainingBalance ?? undefined,
		toppedUpBalance: proto.toppedUpBalance ?? undefined,
		grantedBalance: proto.grantedBalance ?? undefined,
		planType: proto.planType ?? undefined,
		allowed: proto.allowed ?? undefined,
		limitReached: proto.limitReached ?? undefined,
		quotas: proto.quotas?.map(protoToQuota).filter(Boolean) as AccountUsageQuotaData[] | undefined,
		resetCredits: proto.resetCredits?.map(protoToResetCredit).filter(Boolean) as AccountUsageResetCreditData[] | undefined,
		resetCreditsAvailableCount: proto.resetCreditsAvailableCount ?? undefined,
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
		profileId: data.profileId,
		providerId: data.providerId,
		currency: data.currency,
		remainingBalance: data.remainingBalance,
		toppedUpBalance: data.toppedUpBalance,
		grantedBalance: data.grantedBalance,
		planType: data.planType,
		allowed: data.allowed,
		limitReached: data.limitReached,
		quotas: (data.quotas?.map(quotaToProto).filter(Boolean) as ProtoUsageQuota[] | undefined) ?? [],
		resetCredits:
			(data.resetCredits?.map(resetCreditToProto).filter(Boolean) as ProtoAccountUsageResetCredit[] | undefined) ?? [],
		resetCreditsAvailableCount: data.resetCreditsAvailableCount,
		isAvailable: data.isAvailable,
		dailyInputTokens: data.dailyInputTokens,
		dailyOutputTokens: data.dailyOutputTokens,
		dailyCacheHitTokens: data.dailyCacheHitTokens,
		dailyCacheMissTokens: data.dailyCacheMissTokens,
	}
}
