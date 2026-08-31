import { WebSearchMode } from "@shared/proto/dline/provider/common"
import { useId } from "react"
import { ProfileField } from "../profile-ui"

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
	const inputId = useId()

	return (
		<ProfileField htmlFor={inputId} label="Web Search">
			<select
				aria-label="Web Search mode"
				className="min-h-7 w-full rounded-xs border border-input-border bg-input-background px-2 text-sm"
				id={inputId}
				onChange={(event) => onChange(Number(event.target.value) as WebSearchMode)}
				value={selectedValue}>
				{WEB_SEARCH_MODE_OPTIONS.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
		</ProfileField>
	)
}
