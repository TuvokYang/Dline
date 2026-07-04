import { ANTHROPIC_MAX_THINKING_BUDGET, ANTHROPIC_MIN_THINKING_BUDGET } from "@shared/api"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { memo, useCallback, useEffect, useState } from "react"
import styled from "styled-components"

const THUMB_SIZE = 16

const Container = styled.div`
	display: flex;
	flex-direction: column;
	margin-top: 5px;
	margin-bottom: 10px;
`

const RangeInput = styled.input<{ $value: number; $min: number; $max: number }>`
	width: 100%;
	height: 8px;
	appearance: none;
	border-radius: 4px;
	outline: none;
	cursor: pointer;
	margin: 5px 0 0;
	padding: 0;
	background: ${(props) => {
		const percentage = ((props.$value - props.$min) / (props.$max - props.$min)) * 100
		return `linear-gradient(to right, 
			var(--vscode-progressBar-background) 0%,
			var(--vscode-progressBar-background) ${percentage}%,
			var(--vscode-scrollbarSlider-background) ${percentage}%,
			var(--vscode-scrollbarSlider-background) 100%)`
	}};

	&::-webkit-slider-thumb {
		appearance: none;
		width: ${THUMB_SIZE}px;
		height: ${THUMB_SIZE}px;
		border-radius: 50%;
		background: var(--vscode-foreground);
		cursor: pointer;
		border: 0px solid var(--vscode-progressBar-background);
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
	}

	&:focus {
		outline: none;
	}

	&:focus::-webkit-slider-thumb,
	&:hover::-webkit-slider-thumb {
		border-color: var(--vscode-progressBar-background);
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
	}

	&:active::-webkit-slider-thumb {
		outline: none;
		border-color: var(--vscode-progressBar-background);
	}
`

interface ThinkingBudgetSliderProps {
	maxBudget?: number
	showEnableToggle?: boolean
	/**
	 * Direct thinking budget token value (preferred).
	 * When provided, onThinkingBudgetTokensChange must also be provided.
	 * Falls back to apiConfiguration mode-specific fields when not set.
	 */
	thinkingBudgetTokens?: number
	/** Callback when thinking budget changes (when using direct value). */
	onThinkingBudgetTokensChange?: (value: number) => void
}

/**
 * Slider for configuring thinking budget tokens.
 * Uses thinkingBudgetTokens prop when provided, otherwise falls back
 * to legacy apiConfiguration mode-specific fields.
 */
const ThinkingBudgetSlider = ({
	maxBudget,
	showEnableToggle = true,
	thinkingBudgetTokens,
	onThinkingBudgetTokensChange,
}: ThinkingBudgetSliderProps) => {
	const initialBudget = thinkingBudgetTokens != null ? thinkingBudgetTokens : 0

	const persistBudget = useCallback(
		(value: number) => {
			onThinkingBudgetTokensChange?.(value)
		},
		[onThinkingBudgetTokensChange],
	)

	// Add local state for the slider value
	const [localValue, setLocalValue] = useState(initialBudget)

	const [isEnabled, setIsEnabled] = useState<boolean>(initialBudget > 0)

	const onToggle = useCallback(
		(isChecked: boolean) => {
			const newThinkingBudgetValue = isChecked ? ANTHROPIC_MIN_THINKING_BUDGET : 0
			setIsEnabled(isChecked)
			setLocalValue(newThinkingBudgetValue)
			persistBudget(newThinkingBudgetValue)
		},
		[persistBudget],
	)

	useEffect(() => {
		// Ensure thinking is enabled for models where it's always-on
		const isToggleAlwaysOn = !showEnableToggle
		const hasThinkingConfig = initialBudget > 0
		if (isToggleAlwaysOn && !hasThinkingConfig) {
			onToggle(true)
		}
	}, [showEnableToggle, initialBudget, onToggle])

	useEffect(() => {
		const newThinkingBudgetValue = initialBudget
		const newIsEnabled = newThinkingBudgetValue > 0

		// Sync local state when external value changes
		if (newThinkingBudgetValue !== localValue) {
			setLocalValue(newThinkingBudgetValue)
		}
		if (newIsEnabled !== isEnabled) {
			setIsEnabled(newIsEnabled)
		}
	}, [initialBudget, localValue, isEnabled])

	const handleSliderChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
		const value = Number.parseInt(event.target.value, 10)
		const clampedValue = Math.max(value, ANTHROPIC_MIN_THINKING_BUDGET)
		setLocalValue(clampedValue)
	}, [])

	const handleSliderComplete = () => {
		persistBudget(localValue)
	}

	const handleToggleChange = (event: any) => {
		const isChecked = (event.target as HTMLInputElement).checked

		onToggle(isChecked)
	}

	return (
		<div className="w-full">
			{showEnableToggle ? (
				<VSCodeCheckbox checked={isEnabled} onClick={handleToggleChange}>
					Enable thinking{localValue && localValue > 0 ? ` (${localValue.toLocaleString()} tokens)` : ""}
				</VSCodeCheckbox>
			) : (
				<p className="text-[var(--vscode-descriptionForeground)] text-sm">
					Thinking is enabled by default for this model. ({localValue.toLocaleString()} tokens)
				</p>
			)}

			{isEnabled && (
				<Container>
					<RangeInput
						$max={maxBudget || ANTHROPIC_MAX_THINKING_BUDGET}
						$min={0}
						$value={localValue}
						aria-describedby="thinking-budget-description"
						aria-label={`Thinking budget: ${localValue.toLocaleString()} tokens`}
						aria-valuemax={maxBudget || ANTHROPIC_MAX_THINKING_BUDGET}
						aria-valuemin={ANTHROPIC_MIN_THINKING_BUDGET}
						aria-valuenow={localValue}
						id="thinking-budget-slider"
						max={maxBudget || ANTHROPIC_MAX_THINKING_BUDGET}
						min={0}
						onChange={handleSliderChange}
						onMouseUp={handleSliderComplete}
						onTouchEnd={handleSliderComplete}
						step={1}
						type="range"
						value={localValue}
					/>
				</Container>
			)}
		</div>
	)
}

export default memo(ThinkingBudgetSlider)
