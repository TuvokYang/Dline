import type { ClineMessage } from "@shared/ExtensionMessage"
import { ApiErrorBox } from "@/components/chat/ApiErrorBox"
import { CopyButton } from "@/components/common/CopyButton"

/** Props shared by pure interaction presentation renderers. */
export interface PresentationProps {
	message: ClineMessage
	selection: string[]
	onSelectionChange: (selection: string[]) => void
}

/** Render one pure presentation shell. */
function shell(message: ClineMessage) {
	return <div>{message.text}</div>
}

/** Render approval-oriented interaction content. */
export function ApprovalRenderer(props: PresentationProps) {
	return shell(props.message)
}

/** Render command-oriented interaction content. */
export function CommandRenderer(props: PresentationProps) {
	return (
		<div className="relative rounded-sm border border-editor-group-border bg-code p-3 pr-10">
			<div className="absolute right-1 top-1">
				<CopyButton ariaLabel="Copy command" textToCopy={props.message.text} />
			</div>
			<pre className="m-0 whitespace-pre-wrap break-words font-mono text-xs">{props.message.text}</pre>
		</div>
	)
}

/** Render conversation interaction content. */
export function ConversationRenderer(props: PresentationProps) {
	return shell(props.message)
}

/** Render report interaction content. */
export function ReportRenderer(props: PresentationProps) {
	return shell(props.message)
}

/** Render completion interaction content. */
export function CompletionRenderer(props: PresentationProps) {
	return shell(props.message)
}

/** Render API error interaction content. */
export function ErrorRenderer(props: PresentationProps) {
	return <ApiErrorBox error={props.message.text} testId="error-presentation-box" />
}

/** Render resume interaction content. */
export function ResumeRenderer(props: PresentationProps) {
	return shell(props.message)
}

/** Parse pending focus-chain item labels from the persisted plan payload. */
function focusItems(message: ClineMessage): string[] {
	let plan = message.text ?? ""
	try {
		const parsed = JSON.parse(plan) as { plan?: string }
		plan = parsed.plan ?? plan
	} catch {
		// Plain-text plans are valid historical presentation payloads.
	}
	return plan
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => /^- \[ \]/.test(line))
		.map((line) => line.replace(/^- \[ \]\s*/, ""))
}

/** Render focus-chain checkboxes with host-owned selection state. */
export function FocusChainRenderer({ message, selection, onSelectionChange }: PresentationProps) {
	const items = focusItems(message)
	return (
		<div>
			{items.map((item, index) => {
				const value = String(index)
				return (
					<label key={value}>
						<input
							aria-label={item}
							checked={selection.includes(value)}
							onChange={(event) => {
								const next = event.target.checked
									? [...selection, value]
									: selection.filter((selected) => selected !== value)
								onSelectionChange(next)
							}}
							type="checkbox"
						/>
						{item}
					</label>
				)
			})}
		</div>
	)
}
