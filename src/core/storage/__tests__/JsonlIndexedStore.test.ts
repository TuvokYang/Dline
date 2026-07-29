/**
 * Unit tests for JsonlIndexedStore — single-file indexed JSONL storage.
 */
import { afterEach, describe, it } from "vitest"
import "should"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { JsonlIndexedStore } from "../JsonlIndexedStore"

/** Test entry type — must include ts for indexing */
interface TestEntry {
	ts: number
	text: string
}

describe("JsonlIndexedStore", () => {
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
		const dir = path.join(os.tmpdir(), `jistore-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(dir, { recursive: true })
		tmpDir = dir
		const fp = path.join(dir, `${name}.jsonl`)
		if (seed && seed.length > 0) {
			const lines = `${seed.map((e) => JSON.stringify(e)).join("\n")}\n`
			await fs.writeFile(fp, lines, "utf8")
		}
		return JsonlIndexedStore.open<TestEntry>(fp)
	}

	describe("open and load", () => {
		it("should open an empty store when file does not exist", async () => {
			const store = await openStore("nonexistent")
			store.count.should.equal(0)
			store.getAll().should.deepEqual([])
		})

		it("should load existing entries from JSONL file", async () => {
			const seed: TestEntry[] = [
				{ ts: 100, text: "first" },
				{ ts: 200, text: "second" },
				{ ts: 300, text: "third" },
			]
			const store = await openStore("loaded", seed)
			store.count.should.equal(3)
			store.getAll().should.deepEqual(seed)
		})

		it("should preserve JSONL line order on load while keeping ts index searchable", async () => {
			const seed: TestEntry[] = [
				{ ts: 300, text: "c" },
				{ ts: 100, text: "a" },
				{ ts: 200, text: "b" },
			]
			const store = await openStore("unsorted", seed)
			const all = store.getAll()
			all.should.deepEqual(seed)
			store.findIndexByTs(200).should.equal(1)
		})
	})

	describe("cache access", () => {
		it("getByTs should return correct entry (O(1) via Map)", async () => {
			const store = await openStore("getbyts", [
				{ ts: 100, text: "a" },
				{ ts: 200, text: "b" },
				{ ts: 300, text: "c" },
			])
			const entry = store.getByTs(200)
			entry?.text.should.equal("b")
		})

		it("getByTs should return undefined for missing ts", async () => {
			const store = await openStore("missing-ts", [{ ts: 100, text: "a" }])
			;(store.getByTs(999) === undefined).should.be.true()
		})

		it("getAt should return entry by index", async () => {
			const store = await openStore("getat", [
				{ ts: 100, text: "a" },
				{ ts: 200, text: "b" },
			])
			store.getAt(0)?.text.should.equal("a")
			store.getAt(1)?.text.should.equal("b")
			;(store.getAt(5) === undefined).should.be.true()
		})

		it("getAll should return readonly array", async () => {
			const store = await openStore("getall", [{ ts: 100, text: "x" }])
			const all = store.getAll()
			all.length.should.equal(1)
			all[0].text.should.equal("x")
		})
	})

	describe("binary search (findIndexByTs)", () => {
		it("should find insertion index for exact match", async () => {
			const store = await openStore("bsearch", [
				{ ts: 100, text: "a" },
				{ ts: 200, text: "b" },
				{ ts: 300, text: "c" },
			])
			store.findIndexByTs(200).should.equal(1)
		})

		it("should find first index >= target when no exact match", async () => {
			const store = await openStore("bsearch2", [
				{ ts: 100, text: "a" },
				{ ts: 300, text: "c" },
			])
			store.findIndexByTs(200).should.equal(1) // first >= 200 is ts=300 at index 1
		})

		it("should return length when all entries have smaller ts", async () => {
			const store = await openStore("bsearch3", [{ ts: 100, text: "a" }])
			store.findIndexByTs(500).should.equal(1)
		})

		it("should return 0 when all entries have larger ts", async () => {
			const store = await openStore("bsearch4", [{ ts: 500, text: "a" }])
			store.findIndexByTs(100).should.equal(0)
		})
	})

	describe("append", () => {
		it("should append entry and update cache + ts index", async () => {
			const store = await openStore("append-test")
			await store.append({ ts: 100, text: "first" })
			await store.append({ ts: 200, text: "second" })

			store.count.should.equal(2)
			store.getByTs(100)?.text.should.equal("first")
			store.getByTs(200)?.text.should.equal("second")
		})

		it("should persist appended entries to the JSONL file", async () => {
			const store = await openStore("append-persist")
			await store.append({ ts: 1, text: "persisted" })

			// Force flush before re-opening (append is memory-only, timer may not have fired)
			await store.flush()

			// Re-open the same file and verify the entry is there
			const fp = (store as any)._filePath as string
			const reopened = await JsonlIndexedStore.open<TestEntry>(fp)
			reopened.count.should.equal(1)
			reopened.getByTs(1)?.text.should.equal("persisted")
		})
	})

	describe("truncate", () => {
		it("should keep only entries with ts < beforeTs", async () => {
			const store = await openStore("trunc", [
				{ ts: 100, text: "a" },
				{ ts: 200, text: "b" },
				{ ts: 300, text: "c" },
				{ ts: 400, text: "d" },
			])
			await store.truncate(300) // keep ts < 300

			store.count.should.equal(2)
			store.getByTs(100)?.text.should.equal("a")
			store.getByTs(200)?.text.should.equal("b")
			;(store.getByTs(300) === undefined).should.be.true()
			;(store.getByTs(400) === undefined).should.be.true()
		})

		it("should persist truncation to file", async () => {
			const store = await openStore("trunc-persist", [
				{ ts: 100, text: "keep" },
				{ ts: 200, text: "drop" },
			])
			await store.truncate(200)

			const fp = (store as any)._filePath as string
			const reopened = await JsonlIndexedStore.open<TestEntry>(fp)
			reopened.count.should.equal(1)
			reopened.getByTs(100)?.text.should.equal("keep")
		})
	})

	describe("replaceByTs", () => {
		it("should replace an existing entry in place", async () => {
			const store = await openStore("replace", [
				{ ts: 100, text: "old" },
				{ ts: 200, text: "keep" },
			])
			const result = await store.replaceByTs(100, { ts: 100, text: "new" })
			result.should.be.true()
			store.getByTs(100)?.text.should.equal("new")
			store.getByTs(200)?.text.should.equal("keep") // unaffected
		})

		it("should return false for non-existent ts", async () => {
			const store = await openStore("replace-miss", [{ ts: 100, text: "a" }])
			const result = await store.replaceByTs(999, { ts: 999, text: "ghost" })
			result.should.be.false()
		})
	})

	describe("overwrite", () => {
		it("should replace entire store content", async () => {
			const store = await openStore("overwrite", [{ ts: 100, text: "old" }])
			await store.overwrite([
				{ ts: 10, text: "new1" },
				{ ts: 20, text: "new2" },
				{ ts: 30, text: "new3" },
			])

			store.count.should.equal(3)
			store.getByTs(10)?.text.should.equal("new1")
			;(store.getByTs(100) === undefined).should.be.true()
		})

		it("should preserve caller order in overwrite", async () => {
			const store = await openStore("overwrite-sort", [{ ts: 100, text: "old" }])
			const replacement = [
				{ ts: 30, text: "c" },
				{ ts: 10, text: "a" },
				{ ts: 20, text: "b" },
			]
			await store.overwrite(replacement)

			const all = store.getAll()
			all.should.deepEqual(replacement)
		})
	})

	// ── Boundary tests for transaction-based operations ──

	describe("deleteAt (transaction)", () => {
		it("should delete first entry and shift indices", async () => {
			const store = await openStore("del-first", [
				{ ts: 100, text: "a" },
				{ ts: 200, text: "b" },
				{ ts: 300, text: "c" },
			])
			await store.deleteAt(0)

			store.count.should.equal(2)
			store.getAt(0)?.ts.should.equal(200)
			store.getAt(1)?.ts.should.equal(300)
			;(store.getByTs(100) === undefined).should.be.true()
		})

		it("should delete last entry", async () => {
			const store = await openStore("del-last", [
				{ ts: 100, text: "a" },
				{ ts: 200, text: "b" },
			])
			await store.deleteAt(1)

			store.count.should.equal(1)
			store.getAt(0)?.ts.should.equal(100)
		})

		it("should throw on out-of-bounds index", async () => {
			const store = await openStore("del-oob", [{ ts: 100, text: "a" }])
			try {
				await store.deleteAt(5)
				throw new Error("should have thrown")
			} catch (e: any) {
				e.message.should.match(/out of range/)
			}
		})

		it("should persist deletion to file", async () => {
			const store = await openStore("del-persist", [
				{ ts: 100, text: "keep" },
				{ ts: 200, text: "drop" },
			])
			await store.deleteAt(1)

			const fp = (store as any)._filePath as string
			const reopened = await JsonlIndexedStore.open<TestEntry>(fp)
			reopened.count.should.equal(1)
			reopened.getAt(0)?.ts.should.equal(100)
		})
	})

	describe("deleteMany (transaction)", () => {
		it("should delete multiple entries in one transaction", async () => {
			const store = await openStore("del-many", [
				{ ts: 100, text: "a" },
				{ ts: 200, text: "b" },
				{ ts: 300, text: "c" },
				{ ts: 400, text: "d" },
			])
			await store.deleteMany([0, 2]) // delete a(0) and c(2)

			store.count.should.equal(2)
			store.getAt(0)?.ts.should.equal(200) // b moved to 0
			store.getAt(1)?.ts.should.equal(400) // d moved to 1
		})

		it("should delete from back to front maintaining index validity", async () => {
			const store = await openStore("del-backfront", [
				{ ts: 100, text: "a" },
				{ ts: 200, text: "b" },
				{ ts: 300, text: "c" },
			])
			await store.deleteMany([2, 0]) // unordered input

			store.count.should.equal(1)
			store.getAt(0)?.ts.should.equal(200)
		})

		it("should be no-op for empty indices", async () => {
			const store = await openStore("del-empty", [{ ts: 100, text: "a" }])
			await store.deleteMany([])
			store.count.should.equal(1)
		})

		it("should throw on any out-of-bounds index", async () => {
			const store = await openStore("del-many-oob", [{ ts: 100, text: "a" }])
			try {
				await store.deleteMany([0, 5])
				throw new Error("should have thrown")
			} catch (e: any) {
				e.message.should.match(/out of range/)
			}
		})
	})

	describe("insertAt (transaction)", () => {
		it("should insert at beginning and shift", async () => {
			const store = await openStore("ins-first", [
				{ ts: 200, text: "b" },
				{ ts: 300, text: "c" },
			])
			await store.insertAt(0, { ts: 100, text: "a" })

			store.count.should.equal(3)
			store.getAt(0)?.ts.should.equal(100)
			store.getAt(1)?.ts.should.equal(200)
		})

		it("should insert at end (equivalent to append)", async () => {
			const store = await openStore("ins-end", [{ ts: 100, text: "a" }])
			await store.insertAt(1, { ts: 200, text: "b" })

			store.count.should.equal(2)
			store.getAt(1)?.ts.should.equal(200)
		})

		it("should insert beyond length as append", async () => {
			const store = await openStore("ins-beyond", [{ ts: 100, text: "a" }])
			await store.insertAt(10, { ts: 200, text: "b" })

			store.count.should.equal(2)
			store.getAt(1)?.ts.should.equal(200)
		})
	})

	describe("clear (transaction)", () => {
		it("should clear all entries", async () => {
			const store = await openStore("clr", [
				{ ts: 100, text: "a" },
				{ ts: 200, text: "b" },
			])
			await store.clear()

			store.count.should.equal(0)
			store.getAll().should.deepEqual([])
		})

		it("should be idempotent on empty store", async () => {
			const store = await openStore("clr-empty")
			await store.clear()
			store.count.should.equal(0)
		})

		it("should persist clear to file", async () => {
			const store = await openStore("clr-persist", [{ ts: 100, text: "a" }])
			await store.clear()

			const fp = (store as any)._filePath as string
			const reopened = await JsonlIndexedStore.open<TestEntry>(fp)
			reopened.count.should.equal(0)
		})
	})

	describe("truncateByLineNum (transaction)", () => {
		it("should keep first N rows", async () => {
			const store = await openStore("tln", [
				{ ts: 100, text: "a" },
				{ ts: 200, text: "b" },
				{ ts: 300, text: "c" },
			])
			await store.truncateByLineNum(2)

			store.count.should.equal(2)
			store.getAt(0)?.ts.should.equal(100)
			store.getAt(1)?.ts.should.equal(200)
		})

		it("should clear when count is 0", async () => {
			const store = await openStore("tln-zero", [{ ts: 100, text: "a" }])
			await store.truncateByLineNum(0)

			store.count.should.equal(0)
		})

		it("should keep all when count >= length", async () => {
			const store = await openStore("tln-over", [{ ts: 100, text: "a" }])
			await store.truncateByLineNum(10)

			store.count.should.equal(1)
		})
	})

	describe("updateAt with _fullyLoaded check", () => {
		it("should update entry at index", async () => {
			const store = await openStore("upd", [
				{ ts: 100, text: "old" },
				{ ts: 200, text: "b" },
			])
			await store.updateAt(0, { ts: 100, text: "new" })

			store.getByTs(100)?.text.should.equal("new")
			store.count.should.equal(2) // count unchanged
		})

		it("should throw on out-of-bounds", async () => {
			const store = await openStore("upd-oob")
			try {
				await store.updateAt(0, { ts: 100, text: "x" })
				throw new Error("should have thrown")
			} catch (e: any) {
				e.message.should.match(/out of range/)
			}
		})
	})

	describe("upsertByTs with _fullyLoaded check", () => {
		it("should preserve earlier unflushed rows when a later row is upserted", async () => {
			const store = await openStore("upsert-after-appends")
			await store.append({ ts: 100, text: "initial task" })
			await store.append({ ts: 200, text: "checkpoint pending" })

			await store.upsertByTs({ ts: 200, text: "checkpoint committed" })
			await store.flush()

			const fp = (store as any)._filePath as string
			const reopened = await JsonlIndexedStore.open<TestEntry>(fp)
			reopened.getAll().should.deepEqual([
				{ ts: 100, text: "initial task" },
				{ ts: 200, text: "checkpoint committed" },
			])
		})

		it("should update existing entry by ts", async () => {
			const store = await openStore("upsert-exists", [{ ts: 100, text: "old" }])
			await store.upsertByTs({ ts: 100, text: "new" })

			store.count.should.equal(1)
			store.getByTs(100)?.text.should.equal("new")
		})

		it("should append new entry when ts not found", async () => {
			const store = await openStore("upsert-new", [{ ts: 100, text: "a" }])
			await store.upsertByTs({ ts: 200, text: "b" })

			store.count.should.equal(2)
			store.getByTs(200)?.text.should.equal("b")
		})

		it("should not reorder existing rows when appending a new ts", async () => {
			const store = await openStore("upsert-new-unsorted", [
				{ ts: 300, text: "c" },
				{ ts: 100, text: "a" },
			])
			await store.upsertByTs({ ts: 200, text: "b" })

			store.getAll().should.deepEqual([
				{ ts: 300, text: "c" },
				{ ts: 100, text: "a" },
				{ ts: 200, text: "b" },
			])
		})
	})

	describe("L2 cache consistency after transaction", () => {
		it("should evict deleted entries from L2 after deleteAt", async () => {
			const store = await openStore("l2-del", [
				{ ts: 100, text: "a" },
				{ ts: 200, text: "b" },
			])
			// getByTs populates L2
			store.getByTs(100)?.text.should.equal("a")
			await store.deleteAt(0)

			// After transaction, deleted entry should NOT be in L2
			;(store.getByTs(100) === undefined).should.be.true()
			store.getByTs(200)?.text.should.equal("b")
		})

		it("should evict truncated entries from L2 after truncateByLineNum", async () => {
			const store = await openStore("l2-trunc", [
				{ ts: 100, text: "a" },
				{ ts: 200, text: "b" },
				{ ts: 300, text: "c" },
			])
			store.getByTs(200)?.text.should.equal("b")
			store.getByTs(300)?.text.should.equal("c")
			await store.truncateByLineNum(1)

			store.count.should.equal(1)
			store.getByTs(100)?.text.should.equal("a")
			;(store.getByTs(200) === undefined).should.be.true()
			;(store.getByTs(300) === undefined).should.be.true()
		})

		it("should have correct L2 after overwrite replaces all", async () => {
			const store = await openStore("l2-ow", [{ ts: 100, text: "old" }])
			store.getByTs(100)?.text.should.equal("old")
			await store.overwrite([{ ts: 10, text: "new" }])

			;(store.getByTs(100) === undefined).should.be.true()
			store.getByTs(10)?.text.should.equal("new")
		})
	})

	describe("loadAll with force parameter", () => {
		it("should re-read from disk when force=true even if fully loaded", async () => {
			const store = await openStore("force-reload", [{ ts: 100, text: "initial" }])
			store.isFullyLoaded.should.be.true()
			await store.loadAll()
			store.isFullyLoaded.should.be.true()

			// Append directly to the file behind the store's back (simulate cross-process write)
			const fp = (store as any)._filePath as string
			const fs = await import("fs/promises")
			const extra = `${JSON.stringify({ ts: 200, text: "cross-process" })}\n`
			await fs.appendFile(fp, extra, "utf8")

			// Normal loadAll should skip (already fully loaded)
			await store.loadAll()
			store.count.should.equal(1) // still sees only the initial entry

			// Force reload should pick up the cross-process write
			await store.loadAll(true)
			store.count.should.equal(2)
			store.getByTs(200)?.text.should.equal("cross-process")
		})

		it("should work correctly when force=false (default) on first load", async () => {
			const store = await openStore("force-default", [{ ts: 100, text: "a" }])
			await store.loadAll() // first load — force=false is fine
			store.count.should.equal(1)
			store.isFullyLoaded.should.be.true()
		})
	})

	describe("insertLine — memory-layer insert", () => {
		it("should insert at beginning and shift existing entries", async () => {
			const store = await openStore("insline-first", [
				{ ts: 200, text: "b" },
				{ ts: 300, text: "c" },
			])
			await store.insertLine(0, { ts: 100, text: "a" })

			store.count.should.equal(3)
			store.getAt(0)?.ts.should.equal(100)
			store.getAt(1)?.ts.should.equal(200)
			store.getAt(2)?.ts.should.equal(300)
		})

		it("should insert in the middle", async () => {
			const store = await openStore("insline-mid", [
				{ ts: 100, text: "a" },
				{ ts: 300, text: "c" },
			])
			await store.insertLine(1, { ts: 200, text: "b" })

			store.count.should.equal(3)
			store.getAt(0)?.ts.should.equal(100)
			store.getAt(1)?.ts.should.equal(200)
			store.getAt(2)?.ts.should.equal(300)
		})

		it("should append when index >= length", async () => {
			const store = await openStore("insline-end", [{ ts: 100, text: "a" }])
			await store.insertLine(10, { ts: 200, text: "b" })

			store.count.should.equal(2)
			store.getAt(1)?.ts.should.equal(200)
		})

		it("should persist to disk after flush", async () => {
			const store = await openStore("insline-flush")
			await store.insertLine(0, { ts: 100, text: "persisted" })
			await store.flush()

			const fp = (store as any)._filePath as string
			const reopened = await JsonlIndexedStore.open<TestEntry>(fp)
			reopened.count.should.equal(1)
			reopened.getByTs(100)?.text.should.equal("persisted")
		})
	})

	describe("upsertMessage pattern — insertLine by ts order", () => {
		it("should insert new ts at correct ascending position", async () => {
			const store = await openStore("upsert-ts-order", [
				{ ts: 100, text: "a" },
				{ ts: 300, text: "c" },
			])

			// Simulate upsertMessage: new ts=200 — find position, insertLine
			const all = store.getAll() as TestEntry[]
			const existing = all.findIndex((m) => m.ts === 200)
			existing.should.equal(-1) // ts not found

			let insertIndex = all.length
			for (let i = 0; i < all.length; i++) {
				if (all[i].ts > 200) {
					insertIndex = i
					break
				}
			}
			insertIndex.should.equal(1) // between 100 and 300
			await store.insertLine(insertIndex, { ts: 200, text: "b" })

			store.count.should.equal(3)
			store.getAt(0)?.ts.should.equal(100)
			store.getAt(1)?.ts.should.equal(200)
			store.getAt(2)?.ts.should.equal(300)
		})

		it("should insert at end when ts is the largest", async () => {
			const store = await openStore("upsert-ts-end", [{ ts: 100, text: "a" }])

			const all = store.getAll() as TestEntry[]
			let insertIndex = all.length
			for (let i = 0; i < all.length; i++) {
				if (all[i].ts > 500) {
					insertIndex = i
					break
				}
			}
			insertIndex.should.equal(1)
			await store.insertLine(insertIndex, { ts: 500, text: "z" })

			store.count.should.equal(2)
			store.getAt(1)?.ts.should.equal(500)
		})
	})

	describe("insertLine — boundary cases", () => {
		it("should insert into empty store", async () => {
			const store = await openStore("insline-empty")
			await store.insertLine(0, { ts: 100, text: "first" })

			store.count.should.equal(1)
			store.getAt(0)?.ts.should.equal(100)
			store.getByTs(100)?.text.should.equal("first")
		})

		it("should maintain L2 cache consistency after insertLine", async () => {
			const store = await openStore("insline-l2", [
				{ ts: 100, text: "a" },
				{ ts: 300, text: "c" },
			])
			// Populate L2
			store.getByTs(100)?.text.should.equal("a")
			store.getByTs(300)?.text.should.equal("c")

			// Insert in middle
			await store.insertLine(1, { ts: 200, text: "b" })

			// Existing entries still accessible
			store.getByTs(100)?.text.should.equal("a")
			store.getByTs(300)?.text.should.equal("c")
			// New entry accessible
			store.getByTs(200)?.text.should.equal("b")
		})
	})

	describe("loadAll(force) — boundary cases", () => {
		it("should reload when file is externally emptied", async () => {
			const store = await openStore("force-empty", [
				{ ts: 100, text: "a" },
				{ ts: 200, text: "b" },
			])
			await store.loadAll()
			store.count.should.equal(2)

			// External process clears the file
			const fp = (store as any)._filePath as string
			const fs = await import("fs/promises")
			await fs.writeFile(fp, "", "utf8")

			// Force reload should see empty file
			await store.loadAll(true)
			store.count.should.equal(0)
			store.getAll().should.deepEqual([])
		})
	})

	describe("upsertMessage pattern — ts already exists", () => {
		it("should replace in-place when ts already exists (no new entry)", async () => {
			const store = await openStore("upsert-exists-replace", [
				{ ts: 100, text: "old" },
				{ ts: 200, text: "keep" },
			])

			const all = store.getAll() as TestEntry[]
			const existingIndex = all.findIndex((m) => m.ts === 100)
			existingIndex.should.equal(0)

			// Simulate upsertMessage existing ts branch: Object.assign replace
			Object.assign(all[existingIndex], { ts: 100, text: "new" })

			store.count.should.equal(2) // count unchanged
			store.getByTs(100)?.text.should.equal("new")
			store.getByTs(200)?.text.should.equal("keep")
		})
	})

	describe("insertLine + append mixed — flush merge", () => {
		it("should flush insertLine and append together preserving order", async () => {
			const store = await openStore("mix-ia", [{ ts: 100, text: "a" }])

			// InsertLine in middle (real scenario: partial msg arrives out of ts order)
			await store.insertLine(0, { ts: 50, text: "early" })
			// Append at end (real scenario: next partial msg with higher ts)
			await store.append({ ts: 200, text: "late" })

			store.count.should.equal(3)
			store.getAt(0)?.ts.should.equal(50)
			store.getAt(1)?.ts.should.equal(100)
			store.getAt(2)?.ts.should.equal(200)

			// Flush should persist all three in correct order
			await store.flush()
			const fp = (store as any)._filePath as string
			const reopened = await JsonlIndexedStore.open<TestEntry>(fp)
			reopened.count.should.equal(3)
			reopened.getAt(0)?.ts.should.equal(50)
			reopened.getAt(1)?.ts.should.equal(100)
			reopened.getAt(2)?.ts.should.equal(200)
		})
	})

	describe("insertLine to non-zero position — flush persistence", () => {
		it("should persist insertLine at index 1 after flush (merge strategy)", async () => {
			const store = await openStore("insline-flush-merge", [
				{ ts: 100, text: "a" },
				{ ts: 300, text: "c" },
			])

			// Insert at index 1 — dirty range starts from index 1
			await store.insertLine(1, { ts: 200, text: "b" })
			store.count.should.equal(3)

			// Force flush — merge strategy: disk[0..dirtyStart) + memory[dirtyStart..]
			await store.flush()

			const fp = (store as any)._filePath as string
			const reopened = await JsonlIndexedStore.open<TestEntry>(fp)
			reopened.count.should.equal(3)
			reopened.getAt(0)?.ts.should.equal(100)
			reopened.getAt(1)?.ts.should.equal(200)
			reopened.getAt(2)?.ts.should.equal(300)
		})
	})

	describe("loadAll(force) with pending dirty data", () => {
		it("should reflect disk state after force reload (dirty data flushed first)", async () => {
			const store = await openStore("force-dirty", [{ ts: 100, text: "on-disk" }])
			await store.loadAll()
			store.count.should.equal(1)

			// Append to memory and flush — now disk has both entries
			await store.append({ ts: 200, text: "persisted" })
			await store.flush()

			// Force reload should see both entries from disk
			await store.loadAll(true)
			store.count.should.equal(2)
			store.getByTs(200)?.text.should.equal("persisted")
		})

		it("should lose unflushed dirty data on force reload (disk overwrites memory)", async () => {
			const store = await openStore("force-dirty2", [{ ts: 100, text: "on-disk" }])
			await store.loadAll()
			store.count.should.equal(1)

			// Append to memory only — dirty, not yet flushed
			await store.append({ ts: 200, text: "unflushed" })
			store.count.should.equal(2)

			// Force reload — disk wins, unflushed data is lost
			await store.loadAll(true)
			store.count.should.equal(1)
			;(store.getByTs(200) === undefined).should.be.true()
			store.getByTs(100)?.text.should.equal("on-disk")
		})
	})

	describe("upsertMessage Object.assign — neighbor isolation", () => {
		it("should not affect adjacent entries when replacing by ts", async () => {
			const store = await openStore("upsert-neighbor", [
				{ ts: 100, text: "first" },
				{ ts: 200, text: "second" },
				{ ts: 300, text: "third" },
			])

			const all = store.getAll() as TestEntry[]
			const existingIndex = all.findIndex((m) => m.ts === 200)
			existingIndex.should.equal(1)

			// Replace middle entry — neighbors must be untouched
			Object.assign(all[existingIndex], { ts: 200, text: "updated" })

			store.count.should.equal(3)
			store.getByTs(100)?.text.should.equal("first")
			store.getByTs(200)?.text.should.equal("updated")
			store.getByTs(300)?.text.should.equal("third")
		})
	})
})
