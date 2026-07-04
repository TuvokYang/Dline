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
	} = useApiProfiles()

	return (
		<div>
			{renderSectionHeader?.("api-config")}
			<Section>
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
			</Section>
		</div>
	)
}

export default ApiConfigurationSection
