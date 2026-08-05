import { ApiProfile } from "@shared/proto/dline/profile"
import { WebSearchMode } from "@shared/proto/dline/provider/common"
import { describe, expect, it } from "vitest"

describe("ApiProfile web search mode", () => {
	it("preserves an omitted legacy value", () => {
		const profile = ApiProfile.create()

		expect(ApiProfile.fromJSON({}).webSearchMode).toBeUndefined()
		expect(ApiProfile.decode(ApiProfile.encode(profile).finish()).webSearchMode).toBeUndefined()
	})

	it.each([
		WebSearchMode.WEB_SEARCH_MODE_AUTO,
		WebSearchMode.WEB_SEARCH_MODE_FORCE_LOCAL,
		WebSearchMode.WEB_SEARCH_MODE_FORCE_OFF,
		WebSearchMode.WEB_SEARCH_MODE_FORCE_REMOTE,
	])("round-trips mode %s through JSON and binary protobuf representations", (webSearchMode) => {
		const profile = ApiProfile.create({ id: "profile-1", webSearchMode })
		const jsonRoundTrip = ApiProfile.fromJSON(ApiProfile.toJSON(profile))
		const binaryRoundTrip = ApiProfile.decode(ApiProfile.encode(profile).finish())

		expect(jsonRoundTrip.webSearchMode).toBe(webSearchMode)
		expect(binaryRoundTrip.webSearchMode).toBe(webSearchMode)
	})
})
