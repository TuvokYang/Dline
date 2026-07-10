import type { ModeSwitchSnapshot } from "@shared/mode-switch"
import { AlertTriangle } from "lucide-react"
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/common/AlertDialog"

interface ModeSwitchDialogProps {
	state: ModeSwitchSnapshot
	onCancel: (operationId: string) => void
	onConfirm: (operationId: string) => void
}

/** Format a context-window or token count for readable transaction details. */
function formatCount(value?: number): string {
	return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value).toLocaleString("en-US") : "Unavailable"
}

/** Render the confirmation required before switching into a smaller context window. */
export function ModeSwitchDialog({ state, onCancel, onConfirm }: ModeSwitchDialogProps) {
	if (state.phase !== "awaiting_confirmation" || !state.operationId) {
		return null
	}
	const operationId = state.operationId

	/** Treat dismissing the modal as an explicit transaction cancellation. */
	const handleOpenChange = (open: boolean): void => {
		if (!open) onCancel(operationId)
	}

	return (
		<AlertDialog onOpenChange={handleOpenChange} open={true}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						<AlertTriangle className="h-5 w-5 text-(--vscode-errorForeground)" />
						Switch to a smaller context window?
					</AlertDialogTitle>
					<AlertDialogDescription>
						The target profile cannot safely hold the current context. Dline must compact this task in the current
						mode before switching.
					</AlertDialogDescription>
				</AlertDialogHeader>

				<div className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xs border border-[rgba(255,255,255,0.12)] bg-[rgba(0,0,0,0.18)] p-3 text-sm">
					<span className="text-[#a1a1aa]">Source</span>
					<span>
						{state.sourceProfile ?? "Unavailable"} · {formatCount(state.sourceContextWindow)} tokens
					</span>
					<span className="text-[#a1a1aa]">Target</span>
					<span>
						{state.targetProfile ?? "Unavailable"} · {formatCount(state.targetContextWindow)} tokens
					</span>
					<span className="text-[#a1a1aa]">Current</span>
					<span>{formatCount(state.currentTokens)} tokens</span>
					<span className="text-[#a1a1aa]">Compact trigger</span>
					<span>{formatCount(state.triggerTokens)} tokens</span>
				</div>

				<AlertDialogFooter>
					<AlertDialogCancel onClick={() => onCancel(operationId)}>Cancel</AlertDialogCancel>
					<AlertDialogAction onClick={() => onConfirm(operationId)}>Compact & Switch</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
