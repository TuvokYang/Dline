import {
	createTaskCapabilityToggles,
	reconcileTaskCapabilityToggles,
	serializeTaskCapabilityToggles,
	type TaskCapabilityToggleKey,
	type TaskCapabilityToggles,
	updateTaskCapabilityToggle,
} from "@shared/TaskCapabilityToggles"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { updateTaskSettings } from "@/components/settings/utils/settingsHandlers"
import { useExtensionState } from "@/context/ExtensionStateContext"

export function useTaskCapabilityToggles() {
	const {
		currentTaskItem,
		taskViewState,
		stateRevision,
		taskCapabilityToggles,
		setTaskCapabilityToggles,
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
	const isTaskScoped = taskId !== undefined
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
	const authoritativeSnapshot = isTaskScoped ? (taskCapabilityToggles ?? inheritedSnapshot) : undefined
	type PendingIntent = { taskId: string; enabled: boolean; startRevision: number; persisted: boolean }
	const pendingRef = useRef(new Map<string, PendingIntent>())
	const writeQueuesRef = useRef(new Map<string, Promise<unknown>>())
	const pendingTaskIdRef = useRef(taskId)
	const currentTaskIdRef = useRef(taskId)
	const authoritativeRef = useRef(authoritativeSnapshot)
	const stateRevisionRef = useRef(stateRevision ?? 0)
	const [, setPendingVersion] = useState(0)
	if (pendingTaskIdRef.current !== taskId) {
		pendingTaskIdRef.current = taskId
		pendingRef.current.clear()
	}
	currentTaskIdRef.current = taskId
	authoritativeRef.current = authoritativeSnapshot
	stateRevisionRef.current = stateRevision ?? 0

	const pendingKey = (pendingTaskId: string, key: TaskCapabilityToggleKey, resourceId: string) =>
		`${pendingTaskId}\u0000${key}\u0000${resourceId}`
	const overlayPending = useCallback(
		(base: TaskCapabilityToggles | undefined) => {
			if (!base) return undefined
			let next = base
			for (const [identity, intent] of pendingRef.current) {
				if (intent.taskId !== taskId) continue
				const keySeparator = identity.indexOf("\u0000")
				const resourceSeparator = identity.indexOf("\u0000", keySeparator + 1)
				const key = identity.slice(keySeparator + 1, resourceSeparator) as TaskCapabilityToggleKey
				const resourceId = identity.slice(resourceSeparator + 1)
				next = updateTaskCapabilityToggle(next, key, resourceId, intent.enabled)
			}
			return next
		},
		[taskId],
	)
	const snapshot = overlayPending(authoritativeSnapshot)
	const snapshotRef = useRef(snapshot)
	snapshotRef.current = snapshot

	const settleAcknowledgedIntents = useCallback(() => {
		const authoritative = authoritativeRef.current
		if (!authoritative) return
		let changed = false
		for (const [identity, intent] of pendingRef.current) {
			if (
				intent.taskId !== currentTaskIdRef.current ||
				!intent.persisted ||
				stateRevisionRef.current <= intent.startRevision
			) {
				continue
			}
			const keySeparator = identity.indexOf("\u0000")
			const resourceSeparator = identity.indexOf("\u0000", keySeparator + 1)
			const key = identity.slice(keySeparator + 1, resourceSeparator) as TaskCapabilityToggleKey
			const resourceId = identity.slice(resourceSeparator + 1)
			if (authoritative[key][resourceId] === intent.enabled) {
				pendingRef.current.delete(identity)
				changed = true
			}
		}
		if (changed) setPendingVersion((version) => version + 1)
	}, [])

	useEffect(() => {
		settleAcknowledgedIntents()
	}, [authoritativeSnapshot, stateRevision, settleAcknowledgedIntents])

	const enqueueTaskSnapshotWrite = useCallback((operationTaskId: string, next: TaskCapabilityToggles) => {
		const previousWrite = writeQueuesRef.current.get(operationTaskId)
		const persist = () => updateTaskSettings(operationTaskId, { taskCapabilityToggles: serializeTaskCapabilityToggles(next) })
		const durableWrite = previousWrite ? previousWrite.catch(() => undefined).then(persist) : persist()
		writeQueuesRef.current.set(operationTaskId, durableWrite)
		return durableWrite.finally(() => {
			if (writeQueuesRef.current.get(operationTaskId) === durableWrite) writeQueuesRef.current.delete(operationTaskId)
		})
	}, [])

	const persistSnapshot = useCallback(
		(next: TaskCapabilityToggles) => {
			snapshotRef.current = next
			if (taskId === undefined) return Promise.resolve()
			setTaskCapabilityToggles(next)
			return updateTaskSettings(taskId, { taskCapabilityToggles: serializeTaskCapabilityToggles(next) })
		},
		[taskId, setTaskCapabilityToggles],
	)

	const updateToggle = useCallback(
		async (key: TaskCapabilityToggleKey, resourceId: string, enabled: boolean) => {
			const current = snapshotRef.current
			if (!current || taskId === undefined) return
			const operationTaskId = taskId
			const identity = pendingKey(operationTaskId, key, resourceId)
			pendingRef.current.set(identity, {
				taskId: operationTaskId,
				enabled,
				startRevision: stateRevisionRef.current,
				persisted: false,
			})
			const next = updateTaskCapabilityToggle(current, key, resourceId, enabled)
			snapshotRef.current = next
			setTaskCapabilityToggles(next)
			setPendingVersion((version) => version + 1)
			try {
				await enqueueTaskSnapshotWrite(operationTaskId, next)
				if (currentTaskIdRef.current !== operationTaskId) return
				const pending = pendingRef.current.get(identity)
				if (pending?.enabled === enabled) {
					pending.persisted = true
					settleAcknowledgedIntents()
				}
			} catch (error) {
				const pending = pendingRef.current.get(identity)
				if (pending?.enabled === enabled) {
					pendingRef.current.delete(identity)
					if (currentTaskIdRef.current === operationTaskId) {
						setTaskCapabilityToggles(authoritativeRef.current)
						setPendingVersion((version) => version + 1)
					}
				}
				throw error
			}
		},
		[enqueueTaskSnapshotWrite, settleAcknowledgedIntents, setTaskCapabilityToggles, taskId],
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
