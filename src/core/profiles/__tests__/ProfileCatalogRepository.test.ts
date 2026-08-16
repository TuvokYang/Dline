import type { ApiProfile } from "@shared/proto/dline/profile"
import { describe, expect, it } from "vitest"
import { mergeProfileCatalog } from "../ProfileCatalogRepository"

const profile = (id: string, name: string, modelId: string): ApiProfile => ({ id, name, modelId, enabled: true }) as ApiProfile

describe("mergeProfileCatalog", () => {
	it("preserves a different Profile committed after the client baseline", () => {
		const baseline = [profile("a", "A", "a-1"), profile("b", "B", "b-1")]
		const requested = [profile("a", "A", "a-2"), profile("b", "B", "b-1")]
		const latest = [profile("a", "A", "a-1"), profile("b", "B", "b-2")]

		expect(mergeProfileCatalog(baseline, requested, latest).map(({ id, modelId }) => ({ id, modelId }))).toEqual([
			{ id: "a", modelId: "a-2" },
			{ id: "b", modelId: "b-2" },
		])
	})

	it("uses the current commit for the same stable Profile ID", () => {
		const baseline = [profile("a", "A", "a-1")]
		const requested = [profile("a", "A", "a-3")]
		const latest = [profile("a", "A", "a-2")]

		expect(mergeProfileCatalog(baseline, requested, latest)[0]?.modelId).toBe("a-3")
	})

	it("deletes only IDs removed relative to the client baseline", () => {
		const baseline = [profile("a", "A", "a-1")]
		const requested: ApiProfile[] = []
		const latest = [profile("a", "A", "a-1"), profile("b", "B", "b-1")]

		expect(mergeProfileCatalog(baseline, requested, latest).map(({ id }) => id)).toEqual(["b"])
	})
})
