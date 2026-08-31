import { ApiFormat } from "@shared/proto/dline/models/metadata"
import { getApiFormatLabel, resolveApiFormat } from "@shared/providers/api-format"
import { useId } from "react"
import { ProfileField } from "../profile-ui"

interface ApiFormatSelectorProps {
	apiFormats: ApiFormat[] | undefined
	selectedApiFormat: ApiFormat | undefined
	fallbackApiFormat: ApiFormat
	onChange: (apiFormat: ApiFormat) => void
}

/** Render a protocol picker only when the selected model supports multiple formats. */
export function ApiFormatSelector({ apiFormats, selectedApiFormat, fallbackApiFormat, onChange }: ApiFormatSelectorProps) {
	if (!apiFormats || apiFormats.length <= 1) {
		return null
	}

	const selected = resolveApiFormat(selectedApiFormat, { apiFormats }, fallbackApiFormat)
	const inputId = useId()
	return (
		<ProfileField htmlFor={inputId} label="API Format">
			<select
				aria-label="API Format"
				className="min-h-7 w-full rounded-xs border px-2 text-sm"
				id={inputId}
				onChange={(event) => onChange(Number(event.target.value) as ApiFormat)}
				style={{
					backgroundColor: "var(--vscode-dropdown-background)",
					borderColor: "var(--vscode-dropdown-border)",
					color: "var(--vscode-dropdown-foreground)",
				}}
				value={String(selected)}>
				{apiFormats.map((apiFormat) => (
					<option
						key={apiFormat}
						style={{
							backgroundColor: "var(--vscode-dropdown-background)",
							color: "var(--vscode-dropdown-foreground)",
						}}
						value={String(apiFormat)}>
						{getApiFormatLabel(apiFormat)}
					</option>
				))}
			</select>
		</ProfileField>
	)
}
