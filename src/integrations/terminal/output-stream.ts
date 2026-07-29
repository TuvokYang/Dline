import type { TerminalOutputLine, TerminalOutputStream } from "./types"

const OUTPUT_STREAM_LABELS: Record<TerminalOutputStream, string> = {
	stdout: "O",
	stderr: "E",
	combined: "C",
}

export function formatTerminalOutputLogLine(output: TerminalOutputLine): string {
	const label = OUTPUT_STREAM_LABELS[output.stream]
	return output.line ? `[${label}] ${output.line}` : `[${label}]`
}

export function formatTerminalOutput(output: readonly TerminalOutputLine[], processOutput: (lines: string[]) => string): string {
	return processOutput(output.map(formatTerminalOutputLogLine))
}

export function splitTerminalOutput(output: readonly TerminalOutputLine[]): {
	outputEntries: TerminalOutputLine[]
	outputLines: string[]
	stdoutLines: string[]
	stderrLines: string[]
	combinedOutputLines: string[]
} {
	return {
		outputEntries: output.map((entry) => ({ ...entry })),
		outputLines: output.map((entry) => entry.line),
		stdoutLines: output.filter((entry) => entry.stream === "stdout").map((entry) => entry.line),
		stderrLines: output.filter((entry) => entry.stream === "stderr").map((entry) => entry.line),
		combinedOutputLines: output.filter((entry) => entry.stream === "combined").map((entry) => entry.line),
	}
}
