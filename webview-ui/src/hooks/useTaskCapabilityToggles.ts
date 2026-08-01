import {
	createTaskCapabilityToggles,
	reconcileTaskCapabilityToggles,
	serializeTaskCapabilityToggles,
	type TaskCapabilityToggleKey,
	type TaskCapabilityToggles,
	updateTaskCapabilityToggle,
} from "@shared/TaskCapabilityToggles"
import { useCallback, useMemo, useRef } from "react"
import { updateTaskSettings } from "@/components/settings/utils/settingsHandlers"
import { useExtensionState } from "@/context/ExtensionStateContext"

export function useTaskCapabilityToggles(hasTaskDraft: boolean) {
	const {
		currentTaskItem,
		taskViewState,
		taskCapabilityToggles,
		setTaskCapabilityToggles,
		draftTaskCapabilityToggles,
		setDraftTaskCapabilityToggles,
		globalClineRulesToggles,
		localClineRulesToggles,
		localCursorRulesToggles,
		localWindsurfRulesToggles,
		localAgentsRulesToggles,
		globalWorkflowToggles,
		localWorkflowToggles,
		globalSkillsToggles,
		localSkillsToggles,
		remoteSkillsToggles,
		remoteRulesToggles,
		remoteWorkflowToggles,
		mcpServers,
	} = useExtensionState()
	const taskId = taskViewState?.taskId ?? currentTaskItem?.id
	const isTaskScoped = taskId !== undefined || draftTaskCapabilityToggles !== undefined || hasTaskDraft
	const inheritedSnapshot = useMemo(
		() =>
			createTaskCapabilityToggles({
				globalClineRulesToggles,
				localClineRulesToggles,
				localCursorRulesToggles,
				localWindsurfRulesToggles,
				localAgentsRulesToggles,
				globalWorkflowToggles,
				localWorkflowToggles,
				globalSkillsToggles,
				localSkillsToggles,
				remoteSkillsToggles,
				remoteRulesToggles,
				remoteWorkflowToggles,
				mcpServers: Object.fromEntries(mcpServers.map((server) => [server.name, server.disabled !== true])),
			}),
		[
			globalClineRulesToggles,
			localClineRulesToggles,
			localCursorRulesToggles,
			localWindsurfRulesToggles,
			localAgentsRulesToggles,
			globalWorkflowToggles,
			localWorkflowToggles,
			globalSkillsToggles,
			localSkillsToggles,
			remoteSkillsToggles,
			remoteRulesToggles,
			remoteWorkflowToggles,
			mcpServers,
		],
	)
	const snapshot = isTaskScoped
		? taskId !== undefined
			? (taskCapabilityToggles ?? inheritedSnapshot)
			: (draftTaskCapabilityToggles ?? inheritedSnapshot)
		: undefined
	const snapshotRef = useRef(snapshot)
	snapshotRef.current = snapshot

	const persistSnapshot = useCallback(
		(next: TaskCapabilityToggles) => {
			snapshotRef.current = next
			if (taskId !== undefined) {
				setTaskCapabilityToggles(next)
				return updateTaskSettings(taskId, { taskCapabilityToggles: serializeTaskCapabilityToggles(next) })
			}
			setDraftTaskCapabilityToggles(next)
			return Promise.resolve()
		},
		[taskId, setDraftTaskCapabilityToggles, setTaskCapabilityToggles],
	)

	const updateToggle = useCallback(
		(key: TaskCapabilityToggleKey, resourceId: string, enabled: boolean) => {
			const current = snapshotRef.current
			if (!current) return Promise.resolve()
			return persistSnapshot(updateTaskCapabilityToggle(current, key, resourceId, enabled))
		},
		[persistSnapshot],
	)

	const reconcile = useCallback(
		(discovered: Partial<TaskCapabilityToggles>) => {
			const current = snapshotRef.current
			if (!current) return Promise.resolve()
			const next = reconcileTaskCapabilityToggles(current, discovered)
			if (serializeTaskCapabilityToggles(next) === serializeTaskCapabilityToggles(current)) {
				return Promise.resolve()
			}
			return persistSnapshot(next)
		},
		[persistSnapshot],
	)

	return { isTaskScoped, snapshot, updateToggle, reconcile }
}
