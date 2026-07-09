import { RefreshCw } from "lucide-react"
import { useState } from "react"
import { buttonVariants } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { TaskServiceClient } from "@/services/grpc-client"

interface RefreshPromptButtonProps {
	taskId?: string
	className?: string
}

/**
 * Button to manually refresh the frozen system prompt cache.
 * Sends a gRPC RefreshPrompt request with confirmation dialog.
 */
const RefreshPromptButton: React.FC<RefreshPromptButtonProps> = ({ taskId, className }) => {
	const [loading, setLoading] = useState(false)

	const handleRefresh = async (e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		if (!taskId || loading) return
		const confirmed = window.confirm("Refresh system prompt cache? This will rebuild the frozen prompt.")
		if (!confirmed) return
		setLoading(true)
		try {
			await TaskServiceClient.refreshPrompt({ taskId })
		} finally {
			setLoading(false)
		}
	}

	return (
		<Tooltip>
			<TooltipContent>Refresh Prompt Cache</TooltipContent>
			<TooltipTrigger
				className={cn(buttonVariants({ variant: "icon", size: "xs" }), "!overflow-visible !min-h-6", className)}
				disabled={!taskId || loading}
				onClick={handleRefresh}>
				<RefreshCw className={loading ? "animate-spin" : ""} />
			</TooltipTrigger>
		</Tooltip>
	)
}
RefreshPromptButton.displayName = "RefreshPromptButton"

export default RefreshPromptButton
