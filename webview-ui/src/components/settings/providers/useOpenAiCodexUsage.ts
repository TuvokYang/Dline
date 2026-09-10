import {
	ConsumeOpenAiCodexRateLimitResetCreditRequest,
	OpenAiCodexProfileRequest,
	type OpenAiCodexRateLimitResetResult,
	type OpenAiCodexUsageResponse,
} from "@shared/proto/dline/account"
import { useCallback, useEffect, useRef, useState } from "react"
import { AccountServiceClient } from "@/services/grpc-client"

const USAGE_POLL_INTERVAL_MS = 60_000

export interface OpenAiCodexUsageState {
	readonly usage?: OpenAiCodexUsageResponse
	readonly loading: boolean
	readonly refreshing: boolean
	readonly resetting: boolean
	readonly error?: string
	readonly resetError?: string
	readonly refresh: () => Promise<OpenAiCodexUsageResponse | undefined>
	readonly consumeResetCredit: (creditId: string) => Promise<OpenAiCodexRateLimitResetResult | undefined>
}

export function useOpenAiCodexUsage(profileId: string, enabled: boolean): OpenAiCodexUsageState {
	const [usage, setUsage] = useState<OpenAiCodexUsageResponse>()
	const [loading, setLoading] = useState(false)
	const [refreshing, setRefreshing] = useState(false)
	const [resetting, setResetting] = useState(false)
	const [error, setError] = useState<string>()
	const [resetError, setResetError] = useState<string>()
	const profileRef = useRef(profileId)
	const usageRef = useRef<OpenAiCodexUsageResponse>()
	const requestSequence = useRef(0)
	const mounted = useRef(true)
	profileRef.current = profileId
	usageRef.current = usage

	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
			requestSequence.current += 1
		}
	}, [])

	const refresh = useCallback(async (): Promise<OpenAiCodexUsageResponse | undefined> => {
		if (!enabled) return undefined
		const requestProfileId = profileId
		const sequence = ++requestSequence.current
		setError(undefined)
		if (usageRef.current === undefined) setLoading(true)
		else setRefreshing(true)
		try {
			const response = await AccountServiceClient.getOpenAiCodexUsage(
				OpenAiCodexProfileRequest.create({ profileId: requestProfileId }),
			)
			if (!mounted.current || sequence !== requestSequence.current || profileRef.current !== response.profileId) {
				return undefined
			}
			setUsage(response)
			return response
		} catch {
			if (mounted.current && sequence === requestSequence.current && profileRef.current === requestProfileId) {
				setError("ChatGPT usage could not be loaded.")
			}
			return undefined
		} finally {
			if (mounted.current && sequence === requestSequence.current) {
				setLoading(false)
				setRefreshing(false)
			}
		}
	}, [enabled, profileId])

	useEffect(() => {
		requestSequence.current += 1
		usageRef.current = undefined
		setUsage(undefined)
		setError(undefined)
		setResetError(undefined)
		setLoading(false)
		setRefreshing(false)
		if (!enabled) return
		void refresh()
		const interval = window.setInterval(() => void refresh(), USAGE_POLL_INTERVAL_MS)
		return () => window.clearInterval(interval)
	}, [enabled, refresh])

	const consumeResetCredit = useCallback(
		async (creditId: string): Promise<OpenAiCodexRateLimitResetResult | undefined> => {
			if (!enabled || resetting) return undefined
			const normalizedCreditId = creditId.trim()
			if (normalizedCreditId.length === 0) return undefined
			const requestProfileId = profileId
			setResetError(undefined)
			setResetting(true)
			try {
				const result = await AccountServiceClient.consumeOpenAiCodexRateLimitResetCredit(
					ConsumeOpenAiCodexRateLimitResetCreditRequest.create({
						profileId: requestProfileId,
						creditId: normalizedCreditId,
					}),
				)
				if (!mounted.current || profileRef.current !== result.profileId) return undefined
				await refresh()
				return result
			} catch {
				if (mounted.current && profileRef.current === requestProfileId) {
					setResetError("The ChatGPT rate-limit reset could not be completed.")
				}
				return undefined
			} finally {
				if (mounted.current && profileRef.current === requestProfileId) setResetting(false)
			}
		},
		[enabled, profileId, refresh, resetting],
	)

	return { usage, loading, refreshing, resetting, error, resetError, refresh, consumeResetCredit }
}
