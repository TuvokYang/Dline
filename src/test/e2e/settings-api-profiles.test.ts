import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

e2e("Settings API Config - shows configured profiles without changing them", async ({ helper, page, sidebar }) => {
	await helper.signin(sidebar)
	await page.getByRole("button", { name: "Settings", exact: true }).click()

	await expect(sidebar.getByRole("heading", { name: "API Configuration" })).toBeVisible()
	await expect(sidebar.getByText("Add API")).toBeVisible()
	await expect(sidebar.getByRole("textbox").first()).toBeVisible()
})
