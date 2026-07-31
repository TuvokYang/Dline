import { XIcon } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const NewTaskButton: React.FC<{
	onClick: () => void
	className?: string
}> = ({ className, onClick }) => {
	return (
		<Tooltip>
			<TooltipContent side="left">Close Task</TooltipContent>
			<TooltipTrigger
				aria-label="Close Task"
				className={cn(buttonVariants({ variant: "icon", size: "icon" }), "!overflow-visible !min-h-6", className)}
				onClick={(e) => {
					e.preventDefault()
					e.stopPropagation()
					onClick()
				}}>
				<XIcon />
			</TooltipTrigger>
		</Tooltip>
	)
}

export default NewTaskButton
