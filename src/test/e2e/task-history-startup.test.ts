import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

e2e("Startup does not prompt to reconstruct an empty task history", async ({ page, sidebar }) => {
	await expect(sidebar.locator("body")).toBeVisible()
	await page.waitForTimeout(1_000)

	await expect(page.getByRole("button", { name: "Yes, Reconstruct", exact: true })).toHaveCount(0)
	await expect(page.getByText("This will rebuild your task history from existing task data.", { exact: false })).toHaveCount(0)
})
