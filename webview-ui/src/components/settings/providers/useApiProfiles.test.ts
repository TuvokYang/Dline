import { ApiProfile } from "@shared/proto/dline/profile"
import { describe, expect, it } from "vitest"
import { applyProfileUpdate } from "./useApiProfiles"

describe("applyProfileUpdate", () => {
	it("returns unchanged profiles when an update is a no-op", () => {
		const profile = ApiProfile.create({
			id: "profile-1",
			name: "openai:model-a",
			provider: "openai",
			modelId: "model-a",
		})
		const profiles = [profile]

		const result = applyProfileUpdate(profiles, "profile-1", { modelId: "model-a" })

		expect(result.changed).to.equal(false)
		expect(result.profiles).to.equal(profiles)
	})

	it("returns changed profiles when an update modifies a profile", () => {
		const profile = ApiProfile.create({
			id: "profile-1",
			name: "openai:model-a",
			provider: "openai",
			modelId: "model-a",
		})
		const profiles = [profile]

		const result = applyProfileUpdate(profiles, "profile-1", { modelId: "model-b" })

		expect(result.changed).to.equal(true)
		expect(result.profiles).not.to.equal(profiles)
		expect(result.profiles[0]?.modelId).to.equal("model-b")
	})
})
