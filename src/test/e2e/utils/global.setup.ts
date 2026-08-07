import { test as setup } from "@playwright/test"
import { E2ETestHelper } from "./helpers"

setup("setup test environment", async () => {
	await Promise.all([
		E2ETestHelper.rmForRetries(E2ETestHelper.DLINE_DIR_ROOT, { recursive: true, force: true }),
		E2ETestHelper.rmForRetries(E2ETestHelper.DLINE_DOCS_DIR_ROOT, { recursive: true, force: true }),
		E2ETestHelper.rmForRetries(E2ETestHelper.DLINE_STATE_TEMPLATE_DIR_ROOT, { recursive: true, force: true }),
	])
})
