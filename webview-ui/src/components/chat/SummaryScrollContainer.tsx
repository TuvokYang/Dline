import type { ReactNode } from "react"

interface SummaryScrollContainerProps {
	children: ReactNode
}

/** Keep long automatic and manual summaries inside a viewport-bounded scroll region. */
export function SummaryScrollContainer({ children }: SummaryScrollContainerProps) {
	return (
		<div className="max-h-[60vh] overflow-y-auto pr-1" data-testid="summary-scroll-container">
			{children}
		</div>
	)
}
