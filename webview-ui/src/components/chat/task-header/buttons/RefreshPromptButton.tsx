import { AlertTriangle, RefreshCw } from "lucide-react"
import { useMemo, useState } from "react"
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
import { buttonVariants } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { TaskServiceClient } from "@/services/grpc-client"
import { buildRefreshPromptBudget } from "./refreshPromptBudget"

interface RefreshPromptButtonProps {
	taskId?: string
	className?: string
	estimatedInputTokens?: number
	inputPrice?: number
	currency?: string
}

/**
 * Button to manually refresh the frozen system prompt cache.
 * Sends a gRPC RefreshPrompt request with confirmation dialog.
 */
const RefreshPromptButton: React.FC<RefreshPromptButtonProps> = ({
	taskId,
	className,
	estimatedInputTokens = 0,
	inputPrice,
	currency,
}) => {
	const [loading, setLoading] = useState(false)
	const [confirmOpen, setConfirmOpen] = useState(false)
	const budget = useMemo(
		() => buildRefreshPromptBudget({ estimatedInputTokens, inputPrice, currency }),
		[estimatedInputTokens, inputPrice, currency],
	)

	const handleRefresh = (e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		if (!taskId || loading) return
		setConfirmOpen(true)
	}

	const handleCancel = () => {
		setConfirmOpen(false)
	}

	const handleConfirm = async () => {
		if (!taskId || loading) return
		setLoading(true)
		try {
			await TaskServiceClient.refreshPrompt({ taskId })
			setConfirmOpen(false)
		} finally {
			setLoading(false)
		}
	}

	return (
		<>
			<Tooltip>
				<TooltipContent>Refresh Prompt Cache</TooltipContent>
				<TooltipTrigger
					className={cn(buttonVariants({ variant: "icon", size: "xs" }), "!overflow-visible !min-h-6", className)}
					disabled={!taskId || loading}
					onClick={handleRefresh}>
					<RefreshCw className={loading ? "animate-spin" : ""} />
				</TooltipTrigger>
			</Tooltip>
			<AlertDialog onOpenChange={setConfirmOpen} open={confirmOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							<AlertTriangle className="w-5 h-5 text-(--vscode-warningForeground)" />
							Refresh Prompt Cache
						</AlertDialogTitle>
						<AlertDialogDescription>
							Refresh Prompt Cache will rebuild the frozen system prompt for this task and may invalidate the
							provider prompt cache on the next request.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div
						className="mt-4 rounded-xs border border-(--vscode-panel-border) p-3 text-left shadow-[inset_0_0_0_1px_var(--vscode-editorWidget-border)]"
						style={{ backgroundColor: "var(--vscode-editor-background)" }}>
						<div className="text-xs font-semibold uppercase tracking-wide text-(--vscode-editor-foreground)">
							Estimated cache miss
						</div>
						<div className="mt-2 text-lg font-bold text-(--vscode-editor-foreground)">{budget.tokenLine}</div>
						{budget.priceLine && (
							<div className="mt-1 text-lg font-bold text-(--vscode-editor-foreground)">{budget.priceLine}</div>
						)}
						{budget.inputPriceLine && (
							<div className="mt-3 text-xs font-medium text-(--vscode-editor-foreground)">
								{budget.inputPriceLine}
							</div>
						)}
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={loading} onClick={handleCancel}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction disabled={loading} onClick={handleConfirm}>
							{loading ? "Refreshing..." : "Confirm"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}
RefreshPromptButton.displayName = "RefreshPromptButton"

export default RefreshPromptButton
