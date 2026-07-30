import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

e2e("Views - reaches Chat without exposing Cline login", async ({ sidebar }) => {
	await expect(sidebar.getByRole("button", { name: "Login to Cline" })).toHaveCount(0)

	const bringYourOwnKey = sidebar.getByText("Bring my own API key")
	const chatInput = sidebar.getByTestId("chat-input")
	await expect(bringYourOwnKey.or(chatInput)).toBeVisible()

	if (await bringYourOwnKey.isVisible()) {
		await bringYourOwnKey.click()
		await sidebar.getByRole("button", { name: "Continue" }).click()
		await sidebar.getByRole("button", { name: "Add API" }).click()

		const providerSelector = sidebar.getByRole("combobox").first()
		await providerSelector.selectOption("openrouter")
		await sidebar.getByRole("textbox", { name: "OpenRouter API Key" }).fill("test-api-key")
		await sidebar.getByRole("button", { name: "Continue" }).click()
	}

	// Dismiss "What's New" version update announcement modal if present
	const whatsNewDialog = sidebar.getByRole("heading", { name: /New in v/ })
	try {
		await whatsNewDialog.waitFor({ state: "visible", timeout: 5000 })
		await sidebar.getByRole("button", { name: "Close" }).click()
		await expect(whatsNewDialog).not.toBeVisible()
	} catch {
		// "What's New" modal did not appear
	}

	// Verify you are now in the chat page after setup was completed.
	await expect(chatInput).toBeVisible()
})
