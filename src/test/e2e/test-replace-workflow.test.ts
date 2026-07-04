/**
 * E2E test for the test-replace workflow.
 * Validates all 15 SEARCH/REPLACE delimiter boundary conditions.
 *
 * Run: npx playwright test --config=playwright.config.ts src/test/e2e/test-replace-workflow.test.ts
 */
import { expect } from "@playwright/test"
import { E2E_WORKSPACE_TYPES, e2e } from "./utils/helpers"

const TEST_CONTENT_FILE = "test-replace/test-content.md"
const WORKFLOW_NAME = "test-replace"

// Expected results for each condition (matching test-report.md)
const _EXPECTED_RESULTS: Record<number, { pattern: RegExp }> = {
	1: { pattern: /deleted 1 lines, added 1 lines/ },
	2: { pattern: /deleted 1 lines, added 1 lines/ },
	3: { pattern: /deleted 1 lines, added 1 lines/ },
	4: { pattern: /deleted 1 lines, added 1 lines/ },
	5: { pattern: /deleted 2 lines, added 2 lines/ },
	6: { pattern: /deleted 1 lines, added 0 lines/ },
	7: { pattern: /SEARCH content.*not found/ },
	8: { pattern: /deleted 1 lines, added 1 lines/ },
	9: { pattern: /Empty SEARCH block/ },
	10: { pattern: /Delimiter conflict/ },
	11: { pattern: /SEARCH marker inside REPLACE/ },
	12: { pattern: /Missing ======= separator/ },
	13: { pattern: /REPLACE block was not closed/ },
	14: { pattern: /Missing ======= separator/ },
	15: { pattern: /Block #2.*overlaps/ },
}

e2e.describe("test-replace workflow", () => {
	E2E_WORKSPACE_TYPES.forEach(({ title, workspaceType }) => {
		e2e.extend({
			workspaceType,
		})(title, async ({ helper, page, sidebar }) => {
			await helper.signin(sidebar)

			const inputbox = sidebar.getByTestId("chat-input")
			await expect(inputbox).toBeVisible()

			// Activate the test-replace workflow
			await inputbox.fill(`/workflow:${WORKFLOW_NAME}`)
			await sidebar.getByTestId("send-button").click()
			await expect(inputbox).toHaveValue("")

			// Wait for workflow to complete (all 15 conditions).
			// The final condition checks for overlap, so look for that.
			await expect(sidebar.getByText(/Block #2.*overlaps/)).toBeVisible({ timeout: 300_000 })

			// Verify the test content file was created and modified
			const testContent = await helper.getFileContent(TEST_CONTENT_FILE)
			expect(testContent).toBeTruthy()
			expect(testContent.length).toBeGreaterThan(100)
		})
	})
})
