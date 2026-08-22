import type { StateManager } from "@core/storage/StateManager"
import type { Settings } from "@shared/storage/state-keys"

export type GlobalCapabilitySettingsKey =
	| "globalClineRulesToggles"
	| "globalWorkflowToggles"
	| "globalSkillsToggles"
	| "globalSubagentsToggles"

type ToggleMap = Record<string, boolean>

export async function setGlobalCapabilityEnabled(
	stateManager: StateManager,
	key: GlobalCapabilitySettingsKey,
	resourcePath: string,
	enabled: boolean,
): Promise<ToggleMap> {
	return stateManager.mutateGlobalSettingsKey(key, (current) => ({ ...current, [resourcePath]: enabled })) as Promise<
		Settings[GlobalCapabilitySettingsKey]
	>
}

export async function removeGlobalCapability(
	stateManager: StateManager,
	key: GlobalCapabilitySettingsKey,
	resourcePath: string,
): Promise<ToggleMap> {
	return stateManager.mutateGlobalSettingsKey(key, (current) => {
		const { [resourcePath]: _removed, ...remaining } = current
		return remaining
	}) as Promise<Settings[GlobalCapabilitySettingsKey]>
}

export async function reconcileGlobalCapabilities(
	stateManager: StateManager,
	key: GlobalCapabilitySettingsKey,
	discovered: Readonly<Record<string, boolean>>,
): Promise<ToggleMap> {
	return stateManager.mutateGlobalSettingsKey(key, (current) =>
		Object.fromEntries(
			Object.entries(discovered).map(([resourcePath, defaultEnabled]) => [
				resourcePath,
				current[resourcePath] ?? defaultEnabled,
			]),
		),
	) as Promise<Settings[GlobalCapabilitySettingsKey]>
}
