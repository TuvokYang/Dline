import { DEFAULT_TERMINAL_COMMAND_TIMEOUT_SECONDS } from "@shared/terminal-settings"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { updateSetting } from "./utils/settingsHandlers"

const TerminalCommandTimeoutSetting = () => {
	const { terminalCommandTimeoutSeconds } = useExtensionState()
	const timeoutSeconds = terminalCommandTimeoutSeconds ?? DEFAULT_TERMINAL_COMMAND_TIMEOUT_SECONDS
	const [inputValue, setInputValue] = useState(String(timeoutSeconds / 60))
	const [inputError, setInputError] = useState<string | null>(null)
	const isEditing = useRef(false)

	useEffect(() => {
		if (!isEditing.current) {
			setInputValue(String(timeoutSeconds / 60))
		}
	}, [timeoutSeconds])

	const handleChange = (event: Event) => {
		const value = (event.target as HTMLInputElement).value
		setInputValue(value)

		const minutes = Number(value)
		if (!Number.isFinite(minutes) || minutes < 1) {
			setInputError("Enter at least 1 minute")
			return
		}

		setInputError(null)
	}

	const handleBlur = () => {
		isEditing.current = false
		const minutes = Number(inputValue)
		if (!Number.isFinite(minutes) || minutes < 1) {
			setInputValue(String(timeoutSeconds / 60))
			setInputError(null)
			return
		}

		const nextTimeoutSeconds = Math.round(minutes * 60)
		setInputValue(String(nextTimeoutSeconds / 60))
		updateSetting("terminalCommandTimeoutSeconds", nextTimeoutSeconds)
	}

	return (
		<div className="mb-4">
			<label className="font-medium block mb-1" htmlFor="terminal-command-timeout">
				Terminal command timeout (minutes)
			</label>
			<VSCodeTextField
				className="w-full"
				id="terminal-command-timeout"
				onBlur={handleBlur}
				onFocus={() => {
					isEditing.current = true
				}}
				onInput={(event) => handleChange(event as unknown as Event)}
				value={inputValue}
			/>
			{inputError && <div className="text-(--vscode-errorForeground) text-xs mt-1">{inputError}</div>}
			<p className="text-xs text-(--vscode-descriptionForeground) mt-1">
				Maximum runtime before Dline terminates a command. Minimum 1 minute.
			</p>
		</div>
	)
}

export default TerminalCommandTimeoutSetting
