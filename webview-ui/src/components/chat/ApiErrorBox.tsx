import { TriangleAlertIcon } from "lucide-react"
import type { ReactNode } from "react"
import { ClineError } from "../../../../src/services/error/ClineError"

interface ApiErrorDetails {
	status?: number
	code?: string
	message: string
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined
}

/** Parse the serialized provider error into the fields users need to act on it. */
export function parseApiErrorDetails(serializedError?: string): ApiErrorDetails {
	const parsed = ClineError.parse(serializedError)
	const details: unknown = parsed?._error.details
	const detailRecord = details && typeof details === "object" ? (details as Record<string, unknown>) : undefined
	return {
		status: parsed?._error.status,
		code: parsed?._error.code ?? readString(detailRecord?.code),
		message:
			readString(detailRecord?.message) ??
			readString(parsed?._error.message) ??
			readString(parsed?.message) ??
			serializedError ??
			"Unknown API error",
	}
}

/** Render one structured API error with an optional status section below it. */
export function ApiErrorBox({
	error,
	children,
	testId = "api-error-box",
}: {
	error?: string
	children?: ReactNode
	testId?: string
}) {
	const details = parseApiErrorDetails(error)
	return (
		<div className="overflow-hidden rounded-sm border border-error/50 bg-error/10" data-testid={testId}>
			<div className="p-3">
				<div className="flex items-center gap-2 text-error">
					<TriangleAlertIcon className="size-3 shrink-0" />
					<div className="font-medium text-xs">API Request Failed</div>
				</div>
				<dl className="mt-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
					{details.status !== undefined && (
						<>
							<dt className="text-description">HTTP status</dt>
							<dd className="m-0 font-mono text-foreground" data-testid={`${testId}-status`}>
								{details.status}
							</dd>
						</>
					)}
					{details.code && (
						<>
							<dt className="text-description">Error code</dt>
							<dd className="m-0 break-all font-mono text-foreground" data-testid={`${testId}-code`}>
								{details.code}
							</dd>
						</>
					)}
					<dt className="text-description">Message</dt>
					<dd className="m-0 whitespace-pre-wrap break-words text-foreground" data-testid={`${testId}-message`}>
						{details.message}
					</dd>
				</dl>
			</div>
			{children && <div className="border-error/30 border-t bg-editor-background/30 px-3 py-2.5">{children}</div>}
		</div>
	)
}
