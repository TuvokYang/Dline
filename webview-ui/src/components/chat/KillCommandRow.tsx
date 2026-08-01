import { CircleStopIcon } from "lucide-react"

interface KillCommandRowProps {
	functionId: string
	result: string
}

export function KillCommandRow({ functionId, result }: KillCommandRowProps) {
	return (
		<div>
			<div className="flex items-center gap-2.5 mb-3">
				<CircleStopIcon className="size-2" />
				<span className="font-bold">Dline requested command termination:</span>
			</div>
			<div className="bg-code overflow-hidden border border-editor-group-border rounded-[3px] py-2 px-2.5">
				<code className="ph-no-capture break-all">{functionId}</code>
				{result ? <div className="mt-1 text-description break-words">{result}</div> : null}
			</div>
		</div>
	)
}
