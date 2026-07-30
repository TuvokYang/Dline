import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

e2e("Chat - can send messages and switch between modes", async ({ helper, sidebar }) => {
	// Sign in
	await helper.signin(sidebar)

	const inputbox = sidebar.getByTestId("chat-input")
	await expect(inputbox).toBeVisible()

	const actButton = sidebar.getByRole("switch", { name: "Act" })
	const planButton = sidebar.getByRole("switch", { name: "Plan" })

	await expect(actButton).toHaveAttribute("aria-checked", "true")
	await expect(planButton).not.toHaveAttribute("aria-checked", "true")

	await planButton.click()
	await expect(planButton).toHaveAttribute("aria-checked", "true")
	await expect(actButton).not.toHaveAttribute("aria-checked", "true")
	await actButton.click()
	await expect(actButton).toHaveAttribute("aria-checked", "true")

	await expect(inputbox).toHaveValue("")
	await inputbox.fill("/newt")

	await inputbox.focus()
	await sidebar.getByText("newtask", { exact: false }).first().click()
	await expect(inputbox).toHaveValue("/cmd:newtask ")

	await inputbox.focus()
	await inputbox.press("End")
	await inputbox.pressSequentially("following text should be preserved", { delay: 10 })
	await expect(inputbox).toHaveValue("/cmd:newtask following text should be preserved")

	await inputbox.fill("")
	await expect(inputbox).toHaveValue("")

	await inputbox.fill("@prob")

	await sidebar.getByText("Problems", { exact: false }).first().click()
	await expect(inputbox).toHaveValue("@problems ")

	await inputbox.focus()
	await inputbox.press("End")
	await inputbox.pressSequentially("following text should be preserved", { delay: 10 })
	await expect(inputbox).toHaveValue("@problems following text should be preserved")

	await inputbox.fill("E2E chat message")
	await sidebar.getByTestId("send-button").click()
	await expect(inputbox).toHaveValue("")
	await expect(sidebar.getByText("E2E chat message").first()).toBeVisible()

	const cancelButton = sidebar.getByRole("button", { name: "Cancel" }).first()
	if (await cancelButton.isVisible()) {
		await cancelButton.click()
	}
})
