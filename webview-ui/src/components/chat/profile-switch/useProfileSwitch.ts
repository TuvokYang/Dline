import type { ProfileSwitchSnapshot } from "@shared/profile-switch"
import { PlanActMode, ProfileSwitchOperationRequest, ProfileSwitchRequest, ProfileSwitchStatus } from "@shared/proto/dline/state"
import type { Mode } from "@shared/storage/types"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { StateServiceClient } from "../../../services/grpc-client"

interface PendingProfileSwitch {
	requestId: number
	operationId?: string
	targetProfile: string
	targetModes: Mode[]
	startRevision: number
}

interface UseProfileSwitchOptions {
	stateRevision: number
	profileSwitch?: ProfileSwitchSnapshot
}

interface UseProfileSwitchResult {
	requestSwitch: (targetProfile: string, targetModes: Mode[]) => Promise<void>
	confirmSwitch: (operationId: string) => Promise<void>
	cancelSwitch: (operationId: string) => Promise<void>
	isSwitchPending: boolean
	statusText?: string
	error?: string
}

const ACTIVE_PHASES = new Set<ProfileSwitchSnapshot["phase"]>([
	"preflighting",
	"awaiting_confirmation",
	"compacting",
	"committing",
])

/** Convert a shared mode to its protobuf value. */
function toProtoMode(mode: Mode): PlanActMode {
	return mode === "plan" ? PlanActMode.PLAN : PlanActMode.ACT
}

/** Coordinate Profile-switch RPCs without optimistically adopting target settings. */
export function useProfileSwitch({ stateRevision, profileSwitch }: UseProfileSwitchOptions): UseProfileSwitchResult {
	const [pending, setPending] = useState<PendingProfileSwitch>()
	const nextRequestId = useRef(0)
	const backendPending = Boolean(profileSwitch && ACTIVE_PHASES.has(profileSwitch.phase))
	const isSwitchPending = Boolean(pending) || backendPending

	useEffect(() => {
		if (!pending || stateRevision <= pending.startRevision) return
		const matchingSnapshot =
			profileSwitch?.operationId &&
			profileSwitch.targetProfile === pending.targetProfile &&
			(!pending.operationId || profileSwitch.operationId === pending.operationId)
				? profileSwitch
				: undefined
		if (!matchingSnapshot) return
		if (matchingSnapshot.phase === "failed" || matchingSnapshot.phase === "idle") {
			setPending(undefined)
			return
		}
		setPending((current) =>
			current?.requestId === pending.requestId ? { ...current, operationId: matchingSnapshot.operationId } : current,
		)
	}, [pending, profileSwitch, stateRevision])

	const requestSwitch = useCallback(
		async (targetProfile: string, targetModes: Mode[]): Promise<void> => {
			if (isSwitchPending || targetModes.length === 0) return
			const requestId = ++nextRequestId.current
			setPending({ requestId, targetProfile, targetModes: [...targetModes], startRevision: stateRevision })
			try {
				const response = await StateServiceClient.requestProfileSwitch(
					ProfileSwitchRequest.create({
						targetProfile,
						targetModes: targetModes.map(toProtoMode),
					}),
				)
				if (
					response.status === ProfileSwitchStatus.PROFILE_SWITCH_STATUS_REJECTED ||
					response.status === ProfileSwitchStatus.PROFILE_SWITCH_STATUS_SWITCHED ||
					response.status === ProfileSwitchStatus.PROFILE_SWITCH_STATUS_UNSPECIFIED ||
					response.status === ProfileSwitchStatus.UNRECOGNIZED
				) {
					setPending((current) => (current?.requestId === requestId ? undefined : current))
					return
				}
				setPending((current) =>
					current?.requestId === requestId ? { ...current, operationId: response.operationId } : current,
				)
			} catch {
				setPending((current) => (current?.requestId === requestId ? undefined : current))
			}
		},
		[isSwitchPending, stateRevision],
	)

	const confirmSwitch = useCallback(async (operationId: string): Promise<void> => {
		try {
			const response = await StateServiceClient.confirmProfileSwitch(ProfileSwitchOperationRequest.create({ operationId }))
			if (response.status === ProfileSwitchStatus.PROFILE_SWITCH_STATUS_REJECTED) {
				setPending((current) => (current?.operationId === operationId ? undefined : current))
			}
		} catch {
			setPending((current) => (current?.operationId === operationId ? undefined : current))
		}
	}, [])

	const cancelSwitch = useCallback(async (operationId: string): Promise<void> => {
		try {
			await StateServiceClient.cancelProfileSwitch(ProfileSwitchOperationRequest.create({ operationId }))
		} finally {
			setPending((current) => (current?.operationId === operationId ? undefined : current))
		}
	}, [])

	const statusText = useMemo(() => {
		switch (profileSwitch?.phase) {
			case "preflighting":
				return "Checking target Profile..."
			case "awaiting_confirmation":
				return "Confirmation required"
			case "compacting":
				return `Compacting with ${profileSwitch.targetProfile ?? "target Profile"}...`
			case "committing":
				return `Activating ${profileSwitch.targetProfile ?? "target Profile"}...`
			case "failed":
				return `Switch failed — ${profileSwitch.sourceProfile ?? "source Profile"} remains active.`
			default:
				return undefined
		}
	}, [profileSwitch])

	return {
		requestSwitch,
		confirmSwitch,
		cancelSwitch,
		isSwitchPending,
		statusText,
		error: profileSwitch?.phase === "failed" ? profileSwitch.error : undefined,
	}
}
