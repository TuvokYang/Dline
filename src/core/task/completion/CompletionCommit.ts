export interface CompletionCommitPorts {
	publishResult(): Promise<number | undefined>
	saveCheckpoint(completionMessageTs: number | undefined): Promise<void>
	markWorkspaceChanges(): Promise<void>
	captureTelemetry(): void
	updateFocusChain(): Promise<void>
}

/** Commit completion side effects only after all completion prerequisites have succeeded. */
export async function commitCompletion(ports: CompletionCommitPorts): Promise<void> {
	const completionMessageTs = await ports.publishResult()
	await ports.saveCheckpoint(completionMessageTs)
	await ports.markWorkspaceChanges()
	ports.captureTelemetry()
	await ports.updateFocusChain()
}
