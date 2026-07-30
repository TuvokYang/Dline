import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

// Test for setting up API keys
e2e("Views - can set up API keys and navigate to Settings from Chat", async ({ sidebar }) => {
	// Verify initial state
	await expect(sidebar.getByRole("button", { name: "Login to Cline" })).toBeVisible()
	await expect(sidebar.getByText("Bring my own API key")).toBeVisible()

	// Navigate to API key setup
	await sidebar.getByText("Bring my own API key").click()
	await sidebar.getByRole("button", { name: "Continue" }).click()

	await expect(sidebar.getByRole("heading", { name: "Configure your provider" })).toBeVisible()
	await sidebar.getByRole("button", { name: "Add API" }).click()

	const providerSelector = sidebar.getByRole("combobox").first()
	await expect(providerSelector).toBeVisible()
	await providerSelector.selectOption("openrouter")

	const apiKeyInput = sidebar.getByRole("textbox", { name: "OpenRouter API Key" })
	await apiKeyInput.fill("test-api-key")
	await expect(apiKeyInput).toHaveValue("test-api-key")
	await sidebar.getByRole("button", { name: "Continue" }).click()

	await expect(sidebar.getByRole("button", { name: "Login to Cline" })).not.toBeVisible()

	// Verify start up page is no longer visible
	await expect(apiKeyInput).not.toBeVisible()
	await expect(providerSelector).not.toBeVisible()

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
	const chatInputBox = sidebar.getByTestId("chat-input")
	await expect(chatInputBox).toBeVisible()
})
