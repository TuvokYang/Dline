import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { BaseUrlField } from "../common/BaseUrlField"
import type { ApiProfile } from "./ProviderProfile"

interface OcaProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	profile: ApiProfile
	onUpdate: (updates: Partial<ApiProfile>) => void
}

/** OCA provider â€?baseUrl + apiKey from ApiProfile. Model selection via OcaModelPicker. */
export const OcaProvider = ({ isPopup, profile, onUpdate }: OcaProviderProps) => {
	return (
		<div>
			<BaseUrlField
				initialValue={profile.baseUrl}
				label="OCA Base URL"
				onChange={(v) => onUpdate({ baseUrl: v || undefined })}
				placeholder="https://oca.example.com"
			/>
			<VSCodeTextField
				onInput={(e: any) => onUpdate({ apiKey: e.target.value })}
				placeholder="Enter API Key"
				style={{ width: "100%" }}
				type="password"
				value={profile.apiKey}>
				<span style={{ fontWeight: 500 }}>OCA API Key</span>
			</VSCodeTextField>
		</div>
	)
}
