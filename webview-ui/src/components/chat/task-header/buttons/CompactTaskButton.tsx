import { FoldVerticalIcon } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const CompactTaskButton: React.FC<{
	className?: string
	onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
}> = ({ onClick, className }) => {
	return (
		<Tooltip>
			<TooltipContent side="left">Compact Task</TooltipContent>
			<TooltipTrigger
				className={cn(
					buttonVariants({ variant: "icon", size: "icon" }),
					"!overflow-visible !min-h-6",
					"[&_svg]:size-3",
					className,
				)}
				onClick={(e) => {
					e.preventDefault()
					e.stopPropagation()
					onClick(e)
				}}>
				<FoldVerticalIcon />
			</TooltipTrigger>
		</Tooltip>
	)
}

export default CompactTaskButton
