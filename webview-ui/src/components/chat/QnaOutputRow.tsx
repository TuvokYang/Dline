import { MessageSquareIcon } from "lucide-react"
import { memo } from "react"
import { CopyButton } from "@/components/common/CopyButton"
import MarkdownBlock from "@/components/common/MarkdownBlock"
import { cn } from "@/lib/utils"

interface QnaOutputProps {
	text: string
	headClassNames?: string
}

/**
 * Styled output for Q&A responses.
 * Uses the same visual style as PlanCompletionOutputRow
 * but with MessageSquare icon and "Q&A" title.
 */
const QnaOutputRow = memo(({ text, headClassNames }: QnaOutputProps) => {
	return (
		<div className="rounded-sm border border-amber-300/30 dark:border-amber-700/30 overflow-visible bg-amber-100/20 dark:bg-amber-900/10 p-2 pt-3 relative">
			{/* Header */}
			<div className={cn(headClassNames, "justify-between px-1")}>
				<div className="flex gap-2 items-center">
					<MessageSquareIcon className="size-2 text-amber-500 dark:text-amber-400" />
					<span className="text-amber-600 dark:text-amber-400 font-semibold">Q&A</span>
				</div>
				<CopyButton textToCopy={text || ""} />
			</div>

			{/* Content */}
			<div className="w-full relative border-t-1 border-amber-300/20 dark:border-amber-700/20 rounded-b-sm">
				<div className="plan-completion-content p-2 pt-3 w-full [&_hr]:opacity-20 [&_p:last-child]:mb-0 max-h-[80vh] overflow-y-auto">
					<div className="wrap-anywhere [&_hr]:opacity-20">
						<MarkdownBlock markdown={text} />
					</div>
				</div>
			</div>
		</div>
	)
})

QnaOutputRow.displayName = "QnaOutputRow"

export default QnaOutputRow
