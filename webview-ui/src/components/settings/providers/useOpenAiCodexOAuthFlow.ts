import {
	type OpenAiCodexAuthFlow,
	OpenAiCodexAuthStatus,
	type OpenAiCodexAuthStatusResponse,
	OpenAiCodexFlowStatus,
} from "@shared/proto/dline/account"
import { useCallback, useEffect, useRef, useState } from "react"
import { AccountServiceClient } from "@/services/grpc-client"

export type OpenAiCodexOAuthDialogPhase = "closed" | "starting" | "active" | "completing" | "timed-out" | "failed"

export interface OpenAiCodexOAuthDialogState {
	phase: OpenAiCodexOAuthDialogPhase
	flow?: OpenAiCodexAuthFlow
}

export function isOpenAiCodexAuthenticated(status: OpenAiCodexAuthStatus): boolean {
	return (
		status === OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_AUTHENTICATED ||
		status === OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_REFRESHABLE_EXPIRED
	)
}

export function useOpenAiCodexOAuthFlow(profileId: string) {
	const [status, setStatus] = useState(OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_UNSPECIFIED)
	const [dialog, setDialog] = useState<OpenAiCodexOAuthDialogState>({ phase: "closed" })
	const [statusError, setStatusError] = useState<string>()
	const [actionError, setActionError] = useState<string>()
	const [busy, setBusy] = useState(false)
	const flowRef = useRef<OpenAiCodexAuthFlow>()
	const ignoredFlowIdsRef = useRef(new Set<string>())
	const mountedRef = useRef(false)
	const profileIdRef = useRef(profileId)
	const lifecycleEpochRef = useRef(0)
	const statusSequenceRef = useRef(0)
	profileIdRef.current = profileId

	const invalidatePendingResponses = useCallback(() => {
		statusSequenceRef.current += 1
		lifecycleEpochRef.current += 1
		return lifecycleEpochRef.current
	}, [])

	const isCurrent = useCallback(
		(targetProfileId: string, epoch: number) =>
			mountedRef.current && profileIdRef.current === targetProfileId && lifecycleEpochRef.current === epoch,
		[],
	)

	useEffect(() => {
		mountedRef.current = true
		return () => {
			mountedRef.current = false
			invalidatePendingResponses()
			const flow = flowRef.current
			flowRef.current = undefined
			if (flow) {
				void AccountServiceClient.cancelOpenAiCodexSignIn({ profileId: flow.profileId, flowId: flow.flowId }).catch(
					() => undefined,
				)
			}
		}
	}, [invalidatePendingResponses, profileId])

	const setClosed = useCallback(() => {
		flowRef.current = undefined
		setDialog({ phase: "closed" })
		setActionError(undefined)
	}, [])

	const applyStatus = useCallback(
		(response: OpenAiCodexAuthStatusResponse) => {
			if (response.profileId !== profileId) return
			setStatus(response.status)
			setStatusError(undefined)
			const currentFlow = flowRef.current
			const outcome = response.lastFlowOutcome
			if (currentFlow && outcome?.flowId === currentFlow.flowId) {
				if (outcome.status === OpenAiCodexFlowStatus.OPEN_AI_CODEX_FLOW_STATUS_TIMED_OUT) {
					setActionError("OAUTH 认证已超时，请重新认证。")
					setDialog({ phase: "timed-out", flow: currentFlow })
					return
				}
				if (outcome.status === OpenAiCodexFlowStatus.OPEN_AI_CODEX_FLOW_STATUS_FAILED) {
					flowRef.current = undefined
					setActionError("本次 OAUTH 认证失败，请重新认证。")
					setDialog({ phase: "failed" })
					return
				}
				if (outcome.status === OpenAiCodexFlowStatus.OPEN_AI_CODEX_FLOW_STATUS_CANCELLED) {
					setClosed()
					return
				}
			}
			const activeFlow = response.activeFlow
			if (activeFlow?.profileId === profileId && activeFlow.flowId && !ignoredFlowIdsRef.current.has(activeFlow.flowId)) {
				flowRef.current = activeFlow
				setDialog((current) =>
					current.phase === "completing" && current.flow?.flowId === activeFlow.flowId
						? current
						: { phase: "active", flow: activeFlow },
				)
				return
			}
			if (isOpenAiCodexAuthenticated(response.status)) setClosed()
		},
		[profileId, setClosed],
	)

	const refreshStatus = useCallback(async () => {
		const targetProfileId = profileId
		const epoch = lifecycleEpochRef.current
		const sequence = ++statusSequenceRef.current
		try {
			const response = await AccountServiceClient.getOpenAiCodexAuthStatus({ profileId: targetProfileId })
			if (isCurrent(targetProfileId, epoch) && statusSequenceRef.current === sequence) applyStatus(response)
		} catch {
			if (isCurrent(targetProfileId, epoch) && statusSequenceRef.current === sequence) {
				setStatusError("无法读取 OpenAI Codex 认证状态，请重试。")
			}
		}
	}, [applyStatus, isCurrent, profileId])

	useEffect(() => {
		ignoredFlowIdsRef.current.clear()
		setBusy(false)
		setStatus(OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_UNSPECIFIED)
		setClosed()
		setStatusError(undefined)
		void refreshStatus()
	}, [refreshStatus, setClosed])

	useEffect(() => {
		const active = dialog.phase === "active" || dialog.phase === "completing"
		const timer = setInterval(() => void refreshStatus(), active ? 1_000 : 5_000)
		return () => clearInterval(timer)
	}, [dialog.phase, refreshStatus])

	const start = useCallback(async () => {
		const targetProfileId = profileId
		const epoch = invalidatePendingResponses()
		ignoredFlowIdsRef.current.clear()
		flowRef.current = undefined
		setBusy(true)
		setActionError(undefined)
		setDialog({ phase: "starting" })
		try {
			const flow = await AccountServiceClient.startOpenAiCodexSignIn({ profileId: targetProfileId })
			if (!isCurrent(targetProfileId, epoch)) {
				if (flow.profileId && flow.flowId) {
					void AccountServiceClient.cancelOpenAiCodexSignIn({ profileId: flow.profileId, flowId: flow.flowId }).catch(
						() => undefined,
					)
				}
				return
			}
			if (flow.profileId !== targetProfileId || !flow.flowId || !flow.authorizationUrl) {
				throw new Error("Unexpected OpenAI Codex OAUTH response.")
			}
			flowRef.current = flow
			setDialog({ phase: "active", flow })
		} catch {
			if (!isCurrent(targetProfileId, epoch)) return
			flowRef.current = undefined
			setActionError("无法启动 OpenAI Codex OAUTH 认证，请重试。")
			setDialog({ phase: "failed" })
		} finally {
			if (isCurrent(targetProfileId, epoch)) setBusy(false)
		}
	}, [invalidatePendingResponses, isCurrent, profileId])

	const complete = useCallback(
		async (callbackUri: string) => {
			const flow = flowRef.current
			if (!flow || Date.now() >= flow.expiresAtMs) {
				setDialog({ phase: "timed-out", flow })
				setActionError("OAUTH 认证已超时，请重新认证。")
				return
			}
			const targetProfileId = flow.profileId
			const epoch = invalidatePendingResponses()
			setBusy(true)
			setActionError(undefined)
			setDialog({ phase: "completing", flow })
			try {
				const response = await AccountServiceClient.completeOpenAiCodexCallbackUri({
					profileId: targetProfileId,
					flowId: flow.flowId,
					callbackUri,
				})
				if (isCurrent(targetProfileId, epoch)) applyStatus(response)
			} catch {
				if (!isCurrent(targetProfileId, epoch)) return
				if (Date.now() >= flow.expiresAtMs) {
					setDialog({ phase: "timed-out", flow })
					setActionError("OAUTH 认证已超时，请重新认证。")
				} else {
					setDialog({ phase: "active", flow })
					setActionError("无法完成 OAUTH 认证，请检查完整回调 URI 后重试。")
				}
			} finally {
				if (isCurrent(targetProfileId, epoch)) setBusy(false)
			}
		},
		[applyStatus, invalidatePendingResponses, isCurrent],
	)

	const importCredential = useCallback(
		async (oauthJson: string) => {
			const targetProfileId = profileId
			const epoch = invalidatePendingResponses()
			setBusy(true)
			setActionError(undefined)
			try {
				const response = await AccountServiceClient.importOpenAiCodexCredentialJson({
					profileId: targetProfileId,
					oauthJson,
				})
				if (isCurrent(targetProfileId, epoch)) applyStatus(response)
			} catch {
				if (isCurrent(targetProfileId, epoch)) {
					setActionError("无法导入 OpenAI Codex OAuth credential，请检查 JSON 后重试。")
				}
			} finally {
				if (isCurrent(targetProfileId, epoch)) setBusy(false)
			}
		},
		[applyStatus, invalidatePendingResponses, isCurrent, profileId],
	)

	const cancel = useCallback(async () => {
		const flow = flowRef.current
		if (flow) ignoredFlowIdsRef.current.add(flow.flowId)
		const targetProfileId = flow?.profileId ?? profileId
		const epoch = invalidatePendingResponses()
		setClosed()
		if (!flow) return
		try {
			await AccountServiceClient.cancelOpenAiCodexSignIn({ profileId: targetProfileId, flowId: flow.flowId })
			if (isCurrent(targetProfileId, epoch)) await refreshStatus()
		} catch {
			if (!isCurrent(targetProfileId, epoch)) return
			ignoredFlowIdsRef.current.delete(flow.flowId)
			setActionError("无法取消 OpenAI Codex OAUTH 认证，请重试。")
			await refreshStatus()
		}
	}, [invalidatePendingResponses, isCurrent, profileId, refreshStatus, setClosed])

	const signOut = useCallback(async () => {
		const targetProfileId = profileId
		const epoch = invalidatePendingResponses()
		setBusy(true)
		setActionError(undefined)
		try {
			await AccountServiceClient.signOutOpenAiCodexProfile({ profileId: targetProfileId })
			if (!isCurrent(targetProfileId, epoch)) return
			setClosed()
			setStatus(OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_MISSING)
		} catch {
			if (isCurrent(targetProfileId, epoch)) setActionError("无法退出当前 OpenAI Codex Profile，请重试。")
		} finally {
			if (isCurrent(targetProfileId, epoch)) setBusy(false)
		}
	}, [invalidatePendingResponses, isCurrent, profileId, setClosed])

	const markTimedOut = useCallback(() => {
		const flow = flowRef.current
		if (!flow) return
		invalidatePendingResponses()
		setActionError("OAUTH 认证已超时，请重新认证。")
		setDialog({ phase: "timed-out", flow })
	}, [invalidatePendingResponses])

	return {
		status,
		dialog,
		statusError,
		actionError,
		busy,
		start,
		complete,
		importCredential,
		cancel,
		signOut,
		markTimedOut,
	}
}
