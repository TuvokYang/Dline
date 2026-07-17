import { ApiProfile } from "@shared/proto/dline/profile"
import { describe, expect, it } from "vitest"
import { applyProfileUpdate, buildProfileSettings, shouldUseTaskProfileSettings } from "./useApiProfiles"

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

	it("preserves an explicit profile name that starts with the provider prefix", () => {
		const profile = ApiProfile.create({
			id: "profile-1",
			name: "openai:model-a",
			provider: "openai",
			modelId: "model-a",
		})
		const profiles = [profile]

		const result = applyProfileUpdate(profiles, "profile-1", { name: "openai:custom" })

		expect(result.changed).to.equal(true)
		expect(result.profiles[0]?.name).to.equal("openai:custom")
	})
})

describe("buildProfileSettings", () => {
	it("builds both mode profile settings for unified selection", () => {
		const result = buildProfileSettings("deepseek-selected", ["plan", "act"])

		expect(result).to.deep.equal({
			planModeProfile: "deepseek-selected",
			actModeProfile: "deepseek-selected",
		})
	})

	it("builds only the target mode profile setting for split selection", () => {
		const result = buildProfileSettings("anthropic-plan", ["plan"])

		expect(result).to.deep.equal({ planModeProfile: "anthropic-plan" })
	})
})

describe("shouldUseTaskProfileSettings", () => {
	it("keeps profile selection task-scoped before the history item id is available", () => {
		expect(shouldUseTaskProfileSettings(undefined, true)).to.equal(true)
	})

	it("uses global profile settings when no task exists", () => {
		expect(shouldUseTaskProfileSettings(undefined, false)).to.equal(false)
	})
})
