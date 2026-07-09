import { StringArrayRequest } from "@shared/proto/dline/common"
import { TrashIcon } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { TaskServiceClient } from "@/services/grpc-client"
import { formatSize } from "@/utils/format"

const DeleteTaskButton: React.FC<{
	taskId?: string
	taskSize?: number
	className?: string
}> = ({ taskId, className, taskSize }) => (
	<Tooltip>
		<TooltipContent>{`Delete Task (size: ${taskSize ? formatSize(taskSize) : "--"})`}</TooltipContent>
		<TooltipTrigger
			className={cn(buttonVariants({ variant: "icon", size: "xs" }), "!overflow-visible !min-h-6", className)}
			disabled={!taskId}
			onClick={async (e) => {
				e.preventDefault()
				e.stopPropagation()
				if (!taskId) return
				try {
					await TaskServiceClient.deleteTasksWithIds(StringArrayRequest.create({ value: [taskId] }))
				} catch (err) {
					console.error("Delete task failed:", err)
				}
			}}>
			<TrashIcon />
		</TooltipTrigger>
	</Tooltip>
)
DeleteTaskButton.displayName = "DeleteTaskButton"

export default DeleteTaskButton
