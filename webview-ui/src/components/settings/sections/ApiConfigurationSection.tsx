import { Mode } from "@shared/storage/types"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import ProviderProfileList from "../providers/ProviderProfileList"
import { useApiProfiles } from "../providers/useApiProfiles"
import Section from "../Section"

interface ApiConfigurationSectionProps {
	renderSectionHeader?: (tabId: string) => JSX.Element | null
	initialModelTab?: "recommended" | "free"
}

/**
 * API Configuration section — replaced old provider selector + conditional rendering
 * with a unified ProviderProfileList that reuses existing Provider components.
 */
const ApiConfigurationSection = ({ renderSectionHeader, initialModelTab }: ApiConfigurationSectionProps) => {
	const { mode } = useExtensionState()
	const [currentTab] = useState<Mode>(mode)
	const {
		profiles,
		expandedId,
		editMode,
		setEditMode,
		addProfile,
		updateProfile,
		removeProfile,
		toggleExpand,
		providerOptions,
		loaded,
		error,
		reloadProfiles,
	} = useApiProfiles()

	return (
		<div>
			{renderSectionHeader?.("api-config")}
			<Section>
				{!loaded && !error && <div className="py-3 text-sm text-description">Loading API profiles…</div>}
				{error && (
					<div className="py-3 text-sm text-errorForeground">
						<div>Failed to load API profiles. Existing profiles have not been replaced.</div>
						<button className="mt-2" onClick={() => void reloadProfiles()} type="button">
							Retry
						</button>
					</div>
				)}
				{loaded && !error && (
					<ProviderProfileList
						currentMode={currentTab}
						editMode={editMode}
						expandedId={expandedId}
						onAddProfile={addProfile}
						onDeleteProfile={removeProfile}
						onToggleEditMode={() => setEditMode(!editMode)}
						onToggleExpand={toggleExpand}
						onUpdateProfile={updateProfile}
						profiles={profiles}
						providerOptions={providerOptions}
					/>
				)}
			</Section>
		</div>
	)
}

export default ApiConfigurationSection
