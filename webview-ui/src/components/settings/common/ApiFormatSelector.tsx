import { ApiFormat } from "@shared/proto/dline/models/metadata"
import { getApiFormatLabel, resolveApiFormat } from "@shared/providers/api-format"
import { useId } from "react"
import { nativeSelectOptionStyle, nativeSelectStyle } from "@/components/ui/native-select-theme"
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
				style={nativeSelectStyle}
				value={String(selected)}>
				{apiFormats.map((apiFormat) => (
					<option key={apiFormat} style={nativeSelectOptionStyle} value={String(apiFormat)}>
						{getApiFormatLabel(apiFormat)}
					</option>
				))}
			</select>
		</ProfileField>
	)
}
