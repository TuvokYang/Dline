import { ApiFormat } from "@shared/proto/dline/models/metadata"
import { getApiFormatLabel, resolveApiFormat } from "@shared/providers/api-format"

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
	return (
		<label className="flex flex-col gap-1 my-2" htmlFor="api-format">
			<span className="text-xs font-medium">API Format</span>
			<select
				aria-label="API Format"
				className="w-full h-7 px-2 border"
				id="api-format"
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
		</label>
	)
}
