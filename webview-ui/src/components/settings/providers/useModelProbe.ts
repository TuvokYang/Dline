import { type ModelInfo, openAiModelInfoSaneDefaults } from "@shared/api"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

export interface ModelProbeOptions {
	/**
	 * Fetches the model IDs the configured endpoint currently exposes.
	 *
	 * Must be memoized by the caller (useCallback over the credentials it
	 * reads). The hook treats a new function identity as a credential change
	 * and drops previously discovered IDs, so an unstable callback would clear
	 * the dropdown on every render.
	 */
	probe: () => Promise<string[]>
	/** Skips probing while the endpoint credentials are incomplete. */
	enabled: boolean
	/** Kept in the list so the current selection stays visible before a probe returns. */
	selectedModelId?: string
	/** Template for synthesized entries; the endpoint only reports IDs. */
	template?: ModelInfo
}

export interface ModelProbeResult {
	/** Discovered IDs plus the current selection, as autocomplete entries. */
	models: Record<string, ModelInfo>
	/** Idempotent while a probe is in flight; safe to bind to a dropdown `onOpen`. */
	refresh: () => void
	loading: boolean
	error?: Error
}

/**
 * Discovers model IDs from a user-configured endpoint.
 *
 * Endpoints reached this way report IDs only, so entries are synthesized from
 * `template` and marked `userDefined`. Catalog metadata comes from
 * `useProviderModels` instead.
 */
export function useModelProbe({
	probe,
	enabled,
	selectedModelId,
	template = openAiModelInfoSaneDefaults,
}: ModelProbeOptions): ModelProbeResult {
	const [discoveredIds, setDiscoveredIds] = useState<string[]>([])
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<Error | undefined>(undefined)
	const requestId = useRef(0)
	const pending = useRef(false)

	// A new probe identity means different credentials, so previously
	// discovered IDs no longer describe the configured endpoint. Bumping the
	// request id also discards responses still in flight for the old one.
	useEffect(() => {
		requestId.current += 1
		pending.current = false
		setDiscoveredIds([])
		setError(undefined)
		setLoading(false)
	}, [probe])

	const refresh = useCallback(() => {
		if (!enabled || pending.current) {
			return
		}
		pending.current = true
		const currentRequest = ++requestId.current
		setLoading(true)
		probe()
			.then((ids) => {
				if (currentRequest !== requestId.current) {
					return
				}
				setDiscoveredIds([...new Set(ids.filter(Boolean))])
				setError(undefined)
			})
			.catch((cause: unknown) => {
				if (currentRequest !== requestId.current) {
					return
				}
				setError(cause instanceof Error ? cause : new Error(String(cause)))
			})
			.finally(() => {
				if (currentRequest !== requestId.current) {
					return
				}
				pending.current = false
				setLoading(false)
			})
	}, [enabled, probe])

	const models = useMemo<Record<string, ModelInfo>>(() => {
		const ids = new Set(discoveredIds)
		if (selectedModelId) {
			ids.add(selectedModelId)
		}
		return Object.fromEntries(Array.from(ids).map((id) => [id, { ...template, id, name: id, userDefined: true }]))
	}, [discoveredIds, selectedModelId, template])

	return { models, refresh, loading, error }
}
