export interface ApiRequestTimingMarkers {
	requestStartedAtMs: number
	providerRequestStartedAtMs: number
	firstChunkAtMs: number
	streamCompletedAtMs: number
}

export interface ApiRequestTiming {
	localPrepareMs: number
	upstreamTtfbMs: number
	streamMs: number
	totalMs: number
}

function phaseDuration(startedAtMs: number, completedAtMs: number): number {
	return Math.max(0, Math.round(completedAtMs - startedAtMs))
}

/** Calculate non-overlapping request phases from monotonic clock markers. */
export function calculateApiRequestTiming(markers: ApiRequestTimingMarkers): ApiRequestTiming {
	return {
		localPrepareMs: phaseDuration(markers.requestStartedAtMs, markers.providerRequestStartedAtMs),
		upstreamTtfbMs: phaseDuration(markers.providerRequestStartedAtMs, markers.firstChunkAtMs),
		streamMs: phaseDuration(markers.firstChunkAtMs, markers.streamCompletedAtMs),
		totalMs: phaseDuration(markers.requestStartedAtMs, markers.streamCompletedAtMs),
	}
}
