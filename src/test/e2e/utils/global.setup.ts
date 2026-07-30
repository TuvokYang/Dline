import { test as setup } from "@playwright/test"
import { E2ETestHelper } from "./helpers"

setup("setup test environment", async () => {
	await E2ETestHelper.rmForRetries(E2ETestHelper.getResultsDir(), { recursive: true, force: true })
})
