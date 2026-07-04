import { StringRequest } from "@shared/proto/dline/common"
import type { TaskLockStatus } from "@shared/proto/dline/task"
import { useCallback, useEffect, useRef, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { TaskServiceClient } from "@/services/grpc-client"

interface TaskLockBannerProps {
	taskLockStatus?: TaskLockStatus
	currentTaskId?: string
}

/**
 * Banner displayed when the current task is locked by another instance.
 * Shows a warning with options to dismiss or force-unlock.
 * Automatically polls for lock release every 30 seconds.
 */
export const TaskLockBanner: React.FC<TaskLockBannerProps> = ({ taskLockStatus, currentTaskId }) => {
	const [dismissed, setDismissed] = useState(false)
	const [showUnlockConfirm, setShowUnlockConfirm] = useState(false)
	const [isUnlocking, setIsUnlocking] = useState(false)
	const [currentLockStatus, setCurrentLockStatus] = useState<TaskLockStatus | undefined>(taskLockStatus)
	const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

	// Sync external status changes
	useEffect(() => {
		setCurrentLockStatus(taskLockStatus)
	}, [taskLockStatus])

	// Reset dismissed state when lock status changes
	useEffect(() => {
		if (taskLockStatus?.isLocked) {
			setDismissed(false)
		}
	}, [taskLockStatus?.isLocked])

	// Poll for lock status changes every 30 seconds
	useEffect(() => {
		if (!currentTaskId || !currentLockStatus?.isLocked) {
			return
		}

		pollTimerRef.current = setInterval(async () => {
			try {
				const status = await TaskServiceClient.checkTaskLock(StringRequest.create({ value: currentTaskId }))
				setCurrentLockStatus(status)
				// If lock was released, clear the banner
				if (!status.isLocked) {
					setDismissed(true)
				}
			} catch (_error) {
				// Silently ignore poll errors
			}
		}, 30000)

		return () => {
			if (pollTimerRef.current) {
				clearInterval(pollTimerRef.current)
				pollTimerRef.current = null
			}
		}
	}, [currentTaskId, currentLockStatus?.isLocked])

	/**
	 * Handle force-unlock action with confirmation dialog.
	 */
	const handleUnlock = useCallback(async () => {
		if (!currentTaskId) return
		setIsUnlocking(true)
		try {
			await TaskServiceClient.forceReleaseTaskLock(StringRequest.create({ value: currentTaskId }))
			// Status will be updated via the polling effect or state push
			setDismissed(true)
			setShowUnlockConfirm(false)
		} catch (error) {
			console.error("Failed to force unlock task:", error)
		} finally {
			setIsUnlocking(false)
		}
	}, [currentTaskId])

	// Don't render if dismissed or no lock status
	if (dismissed || !currentLockStatus?.isLocked) {
		return null
	}

	const isStale = currentLockStatus.isStale
	const lockedBy = currentLockStatus.lockedBy || "unknown"
	const warningMessage = isStale
		? "Task lock is stale and will be released automatically."
		: `Task is locked by another instance (${lockedBy}). You are in read-only mode.`

	return (
		<>
			<div className="flex items-center justify-center w-full">
				<Alert title={warningMessage} variant="warning">
					<AlertDescription className="flex gap-2 justify-end">
						<Button
							className="px-3 py-1.5"
							disabled={isUnlocking}
							onClick={() => setShowUnlockConfirm(true)}
							size="xs"
							variant="default">
							{isUnlocking ? "Unlocking..." : "Unlock"}
						</Button>
					</AlertDescription>
				</Alert>
			</div>

			{/* Confirmation dialog */}
			{showUnlockConfirm && (
				<div
					className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]"
					onClick={(e) => {
						if (e.target === e.currentTarget) {
							setShowUnlockConfirm(false)
						}
					}}>
					<div
						className="fixed top-[50%] left-[50%] grid w-[60%] min-w-[320px] max-w-[640px] translate-x-[-50%] translate-y-[-50%]"
						onClick={(e) => e.stopPropagation()}>
						<div className="bg-(--vscode-editor-background) rounded-sm gap-3 border border-(--vscode-panel-border) p-6 shadow-lg sm:max-w-lg">
							<div className="flex flex-col gap-1 text-left">
								<h2 className="text-base font-medium text-(--vscode-editor-foreground) text-left">Unlock Task</h2>
								<p className="text-(--vscode-descriptionForeground) text-sm text-left">
									Unlocking will interfere with other processes currently running this task. Confirm unlock?
								</p>
							</div>
							<div className="flex flex-row justify-end gap-3 mt-6">
								<Button onClick={() => setShowUnlockConfirm(false)} size="xs" variant="secondary">
									Cancel
								</Button>
								<Button disabled={isUnlocking} onClick={handleUnlock} size="xs" variant="default">
									{isUnlocking ? "Unlocking..." : "Confirm Unlock"}
								</Button>
							</div>
						</div>
					</div>
				</div>
			)}
		</>
	)
}
