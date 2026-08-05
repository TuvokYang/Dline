import {
	MAX_AUTO_CONDENSE_CONTEXT_TOKENS,
	MAX_AUTO_CONDENSE_TRIGGER_PERCENT,
	MIN_AUTO_CONDENSE_TRIGGER_PERCENT,
	normalizeAutoCondenseMaxContextTokens,
	normalizeAutoCondenseTriggerPercent,
} from "@shared/auto-condense"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useExtensionState } from "@/context/ExtensionStateContext"
import SettingsSlider from "./SettingsSlider"
import { updateSetting } from "./utils/settingsHandlers"
import { useDebouncedInput } from "./utils/useDebouncedInput"

const MAX_CONTEXT_K = Math.floor(MAX_AUTO_CONDENSE_CONTEXT_TOKENS / 1_000)

function parseContextK(value: string): number | undefined {
	if (value.trim() === "") return 0
	if (!/^\d+$/.test(value)) return undefined
	const contextK = Number(value)
	if (!Number.isSafeInteger(contextK) || contextK > MAX_CONTEXT_K) return undefined
	return contextK * 1_000
}

const AutoCondenseSettings = () => {
	const { autoCondenseMaxContextTokens, autoCondenseTriggerPercent } = useExtensionState()
	const persistedTriggerPercent = normalizeAutoCondenseTriggerPercent(autoCondenseTriggerPercent)
	const persistedMaxContextTokens = normalizeAutoCondenseMaxContextTokens(autoCondenseMaxContextTokens)
	const [triggerPercent, setTriggerPercent] = useDebouncedInput(persistedTriggerPercent, (value) => {
		void updateSetting("autoCondenseTriggerPercent", value)
	})
	const [maxContextK, setMaxContextK] = useDebouncedInput(
		String(Math.floor(persistedMaxContextTokens / 1_000)),
		(value) => {
			const contextTokens = parseContextK(value)
			if (contextTokens !== undefined) void updateSetting("autoCondenseMaxContextTokens", contextTokens)
		},
		250,
	)
	const maxContextError = parseContextK(maxContextK) === undefined

	return (
		<div className="ml-3 mb-3 pl-3 border-l border-editor-widget-border/60 space-y-4">
			<SettingsSlider
				description="The earliest of this percentage, the maximum context limit, or the safety boundary triggers compaction."
				label="Compression point (%)"
				max={MAX_AUTO_CONDENSE_TRIGGER_PERCENT}
				min={MIN_AUTO_CONDENSE_TRIGGER_PERCENT}
				onChange={setTriggerPercent}
				step={1}
				value={triggerPercent}
				valueWidth="w-8"
			/>
			<div className="space-y-1.5">
				<Label className="text-xs text-description" htmlFor="auto-condense-max-context-k">
					Maximum context
				</Label>
				<div className="flex items-center gap-2">
					<Input
						aria-invalid={maxContextError}
						aria-label="Maximum context (K tokens)"
						className="h-8"
						id="auto-condense-max-context-k"
						max={MAX_CONTEXT_K}
						min={0}
						onBlur={() => {
							if (maxContextK.trim() === "") setMaxContextK("0")
							else if (maxContextError) setMaxContextK(String(Math.floor(persistedMaxContextTokens / 1_000)))
						}}
						onChange={(event) => setMaxContextK(event.target.value)}
						step={1}
						type="number"
						value={maxContextK}
					/>
					<span className="shrink-0 text-xs text-description">K tokens</span>
				</div>
				{maxContextError ? (
					<p className="text-xs text-(--vscode-errorForeground)">Enter a whole number from 0 to {MAX_CONTEXT_K}.</p>
				) : (
					<p className="text-xs text-description">0 means no absolute limit.</p>
				)}
			</div>
		</div>
	)
}

export default AutoCondenseSettings
