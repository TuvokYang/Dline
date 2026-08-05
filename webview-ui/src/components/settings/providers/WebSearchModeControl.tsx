import { WebSearchMode } from "@shared/proto/dline/provider/common"

interface WebSearchModeControlProps {
	value?: WebSearchMode
	onChange: (value: WebSearchMode) => void
}

const WEB_SEARCH_MODE_OPTIONS = [
	{ value: WebSearchMode.WEB_SEARCH_MODE_AUTO, label: "Auto" },
	{ value: WebSearchMode.WEB_SEARCH_MODE_FORCE_LOCAL, label: "Force Local" },
	{ value: WebSearchMode.WEB_SEARCH_MODE_FORCE_OFF, label: "Off" },
	{ value: WebSearchMode.WEB_SEARCH_MODE_FORCE_REMOTE, label: "Force Remote" },
] as const

/** Per-profile routing policy for Web Search. Changes are persisted by the profile owner. */
export function WebSearchModeControl({ value, onChange }: WebSearchModeControlProps) {
	const selectedValue = value ?? WebSearchMode.WEB_SEARCH_MODE_AUTO

	return (
		<label className="block mb-2">
			<span className="text-xs font-medium text-description block mb-0.5">Web Search</span>
			<select
				aria-label="Web Search mode"
				className="w-full text-xs p-1 rounded bg-input-background border border-input-border"
				onChange={(event) => onChange(Number(event.target.value) as WebSearchMode)}
				value={selectedValue}>
				{WEB_SEARCH_MODE_OPTIONS.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
		</label>
	)
}
