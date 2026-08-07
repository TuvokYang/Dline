import * as path from "node:path"
import { expect, test } from "@playwright/test"
import { E2ETestHelper } from "./utils/helpers"
import { E2E_OUTPUT_ROOT, E2E_RUN_ID } from "./utils/run-context"

test("E2E fixture isolates run, worker, task, retry, and artifact directories", () => {
	const workerZero = E2ETestHelper.getWorkerDirectories(0)
	const workerOne = E2ETestHelper.getWorkerDirectories(1)
	const taskA = E2ETestHelper.getTestDirectories(workerZero, "task-a", 0)
	const taskB = E2ETestHelper.getTestDirectories(workerZero, "task-b", 0)
	const taskARetry = E2ETestHelper.getTestDirectories(workerZero, "task-a", 1)

	expect(E2E_OUTPUT_ROOT).toContain(path.join("tmp", "test-result", E2E_RUN_ID))
	expect(workerZero.dlineDir).not.toBe(workerOne.dlineDir)
	expect(workerZero.dlineDocsDir).not.toBe(workerOne.dlineDocsDir)
	expect(taskA.dlineDir).not.toBe(taskB.dlineDir)
	expect(taskA.dlineDocsDir).not.toBe(taskARetry.dlineDocsDir)
	expect(E2ETestHelper.getResultsDir("same title", "recordings", "task-a-retry-0")).not.toBe(
		E2ETestHelper.getResultsDir("same title", "recordings", "task-b-retry-0"),
	)
})
