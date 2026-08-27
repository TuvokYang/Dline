import { isCompletedFocusChainItem, isFocusChainItem } from "@shared/focus-chain-utils"

const CHINESE_TITLE_LIMIT = 10
const DEFAULT_TITLE_LIMIT = 16
const PANEL_TITLE_FALLBACK = "Dline"
const PROGRESS_SUFFIX_PATTERN = /^(.*?)( \(\d+\/\d+\))$/
const HAN_CHARACTER_PATTERN = /\p{Script=Han}/u

export interface TaskPanelTitleOptions {
	taskTitle?: string | null
	checklist?: string | null
	currentItemIndex?: number | null
}

function truncateTitle(title: string): string {
	const characters = Array.from(title)
	const limit = HAN_CHARACTER_PATTERN.test(title) ? CHINESE_TITLE_LIMIT : DEFAULT_TITLE_LIMIT
	return characters.length > limit ? characters.slice(0, limit).join("") : title
}

function formatProgress(checklist: string, currentItemIndex: number | null | undefined): string {
	const items = checklist
		.split("\n")
		.map((line) => line.trim())
		.filter(isFocusChainItem)

	if (items.length === 0) {
		return ""
	}

	const explicitCurrentIndex =
		currentItemIndex != null && currentItemIndex >= 0 && currentItemIndex < items.length ? currentItemIndex : null
	const currentIndex =
		explicitCurrentIndex != null && !isCompletedFocusChainItem(items[explicitCurrentIndex])
			? explicitCurrentIndex
			: items.findIndex((item) => !isCompletedFocusChainItem(item))
	const displayIndex = currentIndex >= 0 ? currentIndex + 1 : items.length

	return ` (${displayIndex}/${items.length})`
}

/** Format an editor-panel task title from the task text and canonical checklist state. */
export function formatTaskPanelTitle({ taskTitle, checklist, currentItemIndex }: TaskPanelTitleOptions): string {
	const baseTitle = truncateTitle(taskTitle?.trim() || PANEL_TITLE_FALLBACK)
	return `${baseTitle}${checklist ? formatProgress(checklist, currentItemIndex) : ""}`
}

/** Normalize a title supplied by any panel entry point while preserving a progress suffix. */
export function normalizeTaskPanelTitle(title: string): string {
	const normalizedTitle = title.trim() || PANEL_TITLE_FALLBACK
	const progressMatch = normalizedTitle.match(PROGRESS_SUFFIX_PATTERN)
	if (!progressMatch) {
		return truncateTitle(normalizedTitle)
	}

	const baseTitle = truncateTitle(progressMatch[1])
	return progressMatch[2] === " (0/0)" ? baseTitle : `${baseTitle}${progressMatch[2]}`
}
