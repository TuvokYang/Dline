import type { ContextWindowIndicatorPhase, ContextWindowIndicatorSnapshot } from "@shared/context-window-indicator"
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
	createContextWindowIndicatorViewModel,
	type ContextWindowSegmentKind,
	type ContextWindowSegmentViewModel,
} from "./ContextWindowIndicatorViewModel"
export type ContextWindowSegmentMotion = "none" | "commit" | "rollback" | "restore"

interface ContextWindowSegmentedProgressProps {
	snapshot: ContextWindowIndicatorSnapshot
}

interface SegmentDefinition extends ContextWindowSegmentViewModel {
	color: string
	temporary: boolean
	transitionSource: "authoritative" | "previous"
}

interface SegmentTransitionState {
	motion: ContextWindowSegmentMotion
	previous?: ContextWindowIndicatorSnapshot
	revision?: number
}

const MOTION_SETTLE_MS = 720

const SEGMENT_COLORS: Record<ContextWindowSegmentKind, string> = {
	durable: "var(--vscode-charts-green, #3fb950)",
	sending: "var(--vscode-charts-blue, #58a6ff)",
	receiving: "var(--vscode-charts-yellow, #d29922)",
	environment: "var(--vscode-charts-purple, #bc8cff)",
}

function explicitMotionForPhase(phase: ContextWindowIndicatorPhase): ContextWindowSegmentMotion {
	if (phase === "committing") return "commit"
	if (phase === "rolling_back") return "rollback"
	if (phase === "restoring") return "restore"
	return "none"
}

function inferSettledMotion(
	previous: ContextWindowIndicatorSnapshot | undefined,
	current: ContextWindowIndicatorSnapshot,
): ContextWindowSegmentMotion {
	if (!previous || current.phase !== "stable") return "none"
	if (current.lineage.kind === "restore" && previous.lineage.kind !== "restore") return "restore"
	if (previous.pendingSendTokens + previous.receivingTokens <= 0) return "none"
	return current.epoch > previous.epoch ? "rollback" : "commit"
}

function useSegmentTransition(snapshot: ContextWindowIndicatorSnapshot): SegmentTransitionState {
	const previousRef = useRef<ContextWindowIndicatorSnapshot | undefined>(undefined)
	const latestTemporaryRef = useRef<ContextWindowIndicatorSnapshot | undefined>(undefined)
	const clearTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const [settledTransition, setSettledTransition] = useState<SegmentTransitionState>({ motion: "none" })
	const previous = previousRef.current
	const explicitMotion = explicitMotionForPhase(snapshot.phase)
	const inheritedMotion = snapshot.phase === "stable" && previous ? explicitMotionForPhase(previous.phase) : "none"
	const inferredMotion = inferSettledMotion(previous, snapshot)
	const candidateMotion =
		explicitMotion !== "none" ? explicitMotion : inheritedMotion !== "none" ? inheritedMotion : inferredMotion
	const candidatePrevious = latestTemporaryRef.current ?? previous
	const candidateTransition: SegmentTransitionState = {
		motion: candidateMotion,
		previous: candidatePrevious,
		revision: snapshot.revision,
	}
	const activeRequestPhase = snapshot.phase === "sending" || snapshot.phase === "receiving"
	const transition: SegmentTransitionState =
		candidateMotion !== "none" ? candidateTransition : activeRequestPhase ? { motion: "none" } : settledTransition

	useLayoutEffect(() => {
		previousRef.current = snapshot
		if (snapshot.pendingSendTokens + snapshot.receivingTokens > 0) latestTemporaryRef.current = snapshot
	}, [snapshot])

	useEffect(() => {
		if (activeRequestPhase) {
			if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
			clearTimerRef.current = undefined
			setSettledTransition({ motion: "none" })
			return
		}
		if (candidateMotion === "none") return
		if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
		setSettledTransition({ motion: candidateMotion, previous: candidatePrevious, revision: snapshot.revision })
		clearTimerRef.current = setTimeout(() => {
			setSettledTransition({ motion: "none" })
			latestTemporaryRef.current = undefined
			clearTimerRef.current = undefined
		}, MOTION_SETTLE_MS)
	}, [activeRequestPhase, candidateMotion, candidatePrevious, snapshot.revision])

	useEffect(
		() => () => {
			if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
		},
		[],
	)

	return transition
}

function transientTransform(motion: ContextWindowSegmentMotion): string {
	if (motion === "commit") return "translateX(-8px)"
	if (motion === "rollback" || motion === "restore") return "translateX(8px)"
	return "translateX(0)"
}

/** Render the authoritative context snapshot as four ordered, independently animated segments. */
const ContextWindowSegmentedProgress = memo(({ snapshot }: ContextWindowSegmentedProgressProps) => {
	const transition = useSegmentTransition(snapshot)
	const motion = transition.motion
	const previousTemporaryTokens = transition.previous
		? {
				sending: transition.previous.pendingSendTokens,
				receiving: transition.previous.receivingTokens,
			}
		: undefined
	const sendingDisplayTokens =
		motion !== "none" && snapshot.pendingSendTokens === 0 && (previousTemporaryTokens?.sending ?? 0) > 0
			? (previousTemporaryTokens?.sending ?? 0)
			: snapshot.pendingSendTokens
	const receivingDisplayTokens =
		motion !== "none" && snapshot.receivingTokens === 0 && (previousTemporaryTokens?.receiving ?? 0) > 0
			? (previousTemporaryTokens?.receiving ?? 0)
			: snapshot.receivingTokens
	const viewModel = useMemo(
		() =>
			createContextWindowIndicatorViewModel(snapshot, {
				sending: sendingDisplayTokens,
				receiving: receivingDisplayTokens,
			}),
		[receivingDisplayTokens, sendingDisplayTokens, snapshot],
	)
	const segments = useMemo<SegmentDefinition[]>(
		() =>
			viewModel.segments.map((segment) => ({
				...segment,
				color: SEGMENT_COLORS[segment.kind],
				temporary: segment.kind === "sending" || segment.kind === "receiving",
				transitionSource:
					segment.kind === "sending" && sendingDisplayTokens !== snapshot.pendingSendTokens
						? "previous"
						: segment.kind === "receiving" && receivingDisplayTokens !== snapshot.receivingTokens
							? "previous"
							: "authoritative",
			})),
		[receivingDisplayTokens, sendingDisplayTokens, snapshot.pendingSendTokens, snapshot.receivingTokens, viewModel.segments],
	)

	return (
		<div
			aria-label="Context window usage progress"
			aria-valuemax={snapshot.contextWindow}
			aria-valuemin={0}
			aria-valuenow={Math.min(viewModel.totalTokens, snapshot.contextWindow)}
			aria-valuetext={`${viewModel.totalTokens} of ${snapshot.contextWindow} tokens; phase ${snapshot.phase}`}
			className="relative h-3 w-full overflow-hidden rounded-full bg-code-foreground/20"
			data-context-window={snapshot.contextWindow}
			data-epoch={snapshot.epoch}
			data-mode={snapshot.mode}
			data-motion={motion}
			data-phase={snapshot.phase}
		data-minor-factor={viewModel.minorGroupFactor}
		data-profile-name={snapshot.profileName}
		data-revision={snapshot.revision}
		data-testid="context-window-segmented-progress"
			role="progressbar"
			title={`Context phase: ${snapshot.phase}`}>
			<div className="absolute inset-0 flex items-stretch overflow-hidden rounded-full">
				{segments.map((segment) => {
					const active =
						(segment.kind === "sending" && snapshot.phase === "sending") ||
						(segment.kind === "receiving" && snapshot.phase === "receiving")
					const settling = segment.temporary && motion !== "none"
					return (
						<div
							aria-label={`${segment.label}: ${segment.authoritativeTokens} tokens`}
							aria-hidden={segment.displayTokens <= 0 ? "true" : undefined}
							className={`h-full shrink transition-[width,opacity,transform,filter] duration-300 ease-out motion-reduce:transition-none motion-reduce:transform-none ${
								active ? "animate-pulse motion-reduce:animate-none" : ""
							}`}
							data-active={active ? "true" : "false"}
							data-authoritative-tokens={segment.authoritativeTokens}
							data-segment={segment.kind}
							data-testid={`context-window-segment-${segment.kind}`}
							data-tokens={segment.displayTokens}
							data-transition-source={segment.transitionSource}
							key={segment.kind}
							tabIndex={segment.displayTokens > 0 ? 0 : -1}
							style={{
								backgroundColor: segment.color,
								filter: motion === "commit" && segment.kind === "durable" ? "brightness(1.16)" : "none",
								opacity: settling ? 0 : segment.displayTokens > 0 ? 1 : 0,
						transform: segment.temporary ? transientTransform(motion) : "translateX(0)",
						width: settling ? "0%" : `${segment.widthPercent}%`,
							}}
							title={`${segment.label}: ${segment.authoritativeTokens} tokens`}
						/>
					)
				})}
			</div>
		</div>
	)
})

ContextWindowSegmentedProgress.displayName = "ContextWindowSegmentedProgress"

export default ContextWindowSegmentedProgress
