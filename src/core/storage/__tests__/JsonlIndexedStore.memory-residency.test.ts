/**
 * Baseline + diagnostic tests for JsonlIndexedStore memory residency.
 *
 * These tests LOCK the current memory behavior so that any performance
 * refactoring that changes residency semantics must update them explicitly:
 *
 *  1. getAll() returns the internal full-residency array (same reference).
 *  2. open() fully parses the JSONL and keeps a second deep-copied persisted
 *     baseline (_persistedItems) in memory.
 *  3. flush() re-clones the full history into the persisted baseline.
 *
 * The diagnostic describe quantifies the residency footprint for a large task
 * history — the primary extension-host memory growth path behind the observed
 * OOM crash (heap ~1.66 GB, crash log "JavaScript heap out of memory").
 */
import { afterEach, describe, it } from "vitest"
import "should"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { JsonlIndexedStore } from "../JsonlIndexedStore"

/** Test entry type — must include ts for indexing. */
interface TestEntry {
	ts: number
	text: string
}

/** Build an entry whose serialized JSON is approximately `payloadBytes` long. */
function makeEntry(ts: number, payloadBytes: number): TestEntry {
	// JSON escaping overhead is fixed; pad to the requested size.
	const pad = Math.max(0, payloadBytes - 40)
	return { ts, text: "x".repeat(pad) }
}

describe("JsonlIndexedStore memory residency (baseline)", () => {
	let tmpDir: string

	afterEach(async () => {
		if (tmpDir) {
			try {
				await fs.rm(tmpDir, { recursive: true, force: true })
			} catch {
				/* ignore */
			}
		}
	})

	async function openStore(name: string, seed?: TestEntry[]): Promise<JsonlIndexedStore<TestEntry>> {
		const dir = path.join(os.tmpdir(), `jistore-mem-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(dir, { recursive: true })
		tmpDir = dir
		const fp = path.join(dir, `${name}.jsonl`)
		if (seed && seed.length > 0) {
			const lines = `${seed.map((e) => JSON.stringify(e)).join("\n")}\n`
			await fs.writeFile(fp, lines, "utf8")
		}
		return JsonlIndexedStore.open<TestEntry>(fp)
	}

	it("getAll returns the internal full-residency array (same reference, not a snapshot)", async () => {
		const store = await openStore("ref-identity", [
			{ ts: 100, text: "a" },
			{ ts: 200, text: "b" },
		])
		// Locks that getAll() is the in-memory array itself — full residency.
		;(store.getAll() as unknown[]).should.equal((store as unknown as { _items: TestEntry[] })._items)
		await store.close()
	})

	it("open fully parses the file and keeps a second deep-copied persisted baseline", async () => {
		const seed: TestEntry[] = [
			{ ts: 100, text: "first" },
			{ ts: 200, text: "second" },
		]
		const store = await openStore("dual-copy", seed)
		const internals = store as unknown as {
			_items: TestEntry[]
			_persistedItems: TestEntry[]
		}

		// Both arrays hold the full history.
		internals._items.length.should.equal(2)
		internals._persistedItems.length.should.equal(2)

		// The persisted baseline is a deep clone — second object graph in memory.
		internals._persistedItems[0].should.not.equal(internals._items[0])
		JSON.stringify(internals._persistedItems[0]).should.equal(JSON.stringify(internals._items[0]))
		await store.close()
	})

	it("flush re-clones the full history into the persisted baseline", async () => {
		const store = await openStore("flush-reclone", [{ ts: 100, text: "a" }])
		const internals = store as unknown as {
			_items: TestEntry[]
			_persistedItems: TestEntry[]
		}

		await store.append({ ts: 200, text: "b" })
		const itemRefBeforeFlush = internals._items[1]
		await store.flush()

		// Baseline updated to full length and deep-copied again.
		internals._persistedItems.length.should.equal(2)
		internals._persistedItems[1].should.not.equal(itemRefBeforeFlush)
		JSON.stringify(internals._persistedItems[1]).should.equal(JSON.stringify(itemRefBeforeFlush))
		await store.close()
	})
})

describe("JsonlIndexedStore memory footprint (diagnostic)", () => {
	let tmpDir: string

	afterEach(async () => {
		if (tmpDir) {
			try {
				await fs.rm(tmpDir, { recursive: true, force: true })
			} catch {
				/* ignore */
			}
		}
	})

	it("quantifies full residency footprint for a large task history", async () => {
		const ENTRY_COUNT = 2000
		const BYTES_PER_ENTRY = 1024
		const dir = path.join(os.tmpdir(), `jistore-footprint-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(dir, { recursive: true })
		tmpDir = dir
		const fp = path.join(dir, "large.jsonl")

		const seed: TestEntry[] = []
		for (let i = 0; i < ENTRY_COUNT; i++) {
			seed.push(makeEntry(1000 + i, BYTES_PER_ENTRY))
		}
		const lines = `${seed.map((e) => JSON.stringify(e)).join("\n")}\n`
		await fs.writeFile(fp, lines, "utf8")

		const store = await JsonlIndexedStore.open<TestEntry>(fp)
		const internals = store as unknown as { _items: TestEntry[]; _persistedItems: TestEntry[] }

		// Structural fact: full history resident in two independent arrays.
		internals._items.length.should.equal(ENTRY_COUNT)
		internals._persistedItems.length.should.equal(ENTRY_COUNT)

		// Quantify serialized payload per copy (proxy for heap footprint).
		const singleCopyBytes = JSON.stringify(store.getAll()).length
		singleCopyBytes.should.be.greaterThan(ENTRY_COUNT * BYTES_PER_ENTRY * 0.9)
		singleCopyBytes.should.be.lessThan(ENTRY_COUNT * BYTES_PER_ENTRY * 1.3)

		// Report the effective dual-copy residency (diagnostic output, not an assertion).
		console.info(
			`[memory-diagnostic] entries=${ENTRY_COUNT}, ` +
				`serializedBytes=${singleCopyBytes}, dualCopyBytes≈${singleCopyBytes * 2}`,
		)

		await store.close()
	})
})
