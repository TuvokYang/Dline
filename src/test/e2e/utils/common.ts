import type { Page } from "@playwright/test"

export const openTab = async (_page: Page, tabName: string) => {
	await _page
		.getByRole("tab", { name: new RegExp(`${tabName}`) })
		.locator("a")
		.click()
}

export const addSelectedCodeToDline = async (_page: Page) => {
	const editor = _page.getByRole("textbox", { name: "The editor is not accessible" })
	await editor.focus()
	await editor.press("ControlOrMeta+a")

	await _page.keyboard.press("ControlOrMeta+.")
	const action = _page.locator(".monaco-list-row").filter({ hasText: "Add to Dline" }).first()
	await action.waitFor({ state: "visible" })
	await action.click({ force: true })
}

export const toggleNotifications = async (_page: Page) => {
	await _page.waitForLoadState("domcontentloaded")
	await _page.keyboard.press("ControlOrMeta+Shift+p")
	const editorSearchBar = _page.getByRole("textbox")
	if (!(await editorSearchBar.isVisible())) {
		await _page.keyboard.press("ControlOrMeta+Shift+p")
	}
	await editorSearchBar.click({ delay: 100 }) // Ensure focus
	await editorSearchBar.fill("> Toggle Do Not Disturb Mode")
	await _page.keyboard.press("Enter")
	return _page
}
