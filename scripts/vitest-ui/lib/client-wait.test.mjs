import assert from "node:assert/strict"
import test from "node:test"
import { rerunWithScope, waitForIdle } from "./client.mjs"

function file(id, state) {
	return {
		id,
		filepath: `C:/repo/${id}.test.ts`,
		name: `${id}.test.ts`,
		projectName: "backend",
		type: "file",
		result: { state },
		tasks: [],
	}
}

test("waitForIdle waits until every discovered path has been collected", async () => {
	const batches = [
		[file("one", "pass")],
		[file("one", "pass"), file("two", "pass")],
		[file("one", "pass"), file("two", "pass"), file("three", "pass")],
	]
	let getFilesCalls = 0
	const client = {
		state: { lastFinishedAt: Date.now() },
		getPaths: async () => ["C:/repo/one.test.ts", "C:/repo/two.test.ts", "C:/repo/three.test.ts"],
		getFiles: async () => batches[Math.min(getFilesCalls++, batches.length - 1)],
	}

	const files = await waitForIdle(client, { timeoutMs: 100, pollMs: 0 })

	assert.equal(files.length, 3)
	assert.equal(getFilesCalls, 3)
})

test("waitForIdle reports collected and expected counts on timeout", async () => {
	const client = {
		state: { lastFinishedAt: 0 },
		getPaths: async () => ["C:/repo/one.test.ts", "C:/repo/two.test.ts"],
		getFiles: async () => [file("one", "pass")],
	}

	await assert.rejects(waitForIdle(client, { timeoutMs: 5, pollMs: 0 }), /Collected 1\/2 files/)
})

test("rerun all dispatches every discovered path instead of only previously collected files", async () => {
	const reruns = []
	const client = {
		getFiles: async () => [file("one", "pass")],
		getPaths: async () => ["C:/repo/one.test.ts", "C:/repo/two.test.ts", "C:/repo/three.test.ts"],
		rerun: async (paths, resetTestNamePattern) => {
			reruns.push({ paths, resetTestNamePattern })
		},
	}

	const result = await rerunWithScope(client, { scope: "all" })

	assert.deepEqual(reruns, [
		{
			paths: ["C:/repo/one.test.ts", "C:/repo/two.test.ts", "C:/repo/three.test.ts"],
			resetTestNamePattern: true,
		},
	])
	assert.deepEqual(result.targets, ["C:/repo/one.test.ts", "C:/repo/two.test.ts", "C:/repo/three.test.ts"])
})
