import { ClineDefaultTool } from "@shared/tools"
import { describe, expect, it } from "vitest"
import { AutoApprove } from "../autoApprove"

function autoApprove(generateImages?: boolean): AutoApprove {
	return new AutoApprove({
		getGlobalSettingsKey: (key: string) => {
			if (key === "yoloModeToggled" || key === "autoApproveAllToggled") return false
			if (key === "autoApprovalSettings") return { actions: { generateImages } }
			return undefined
		},
	} as never)
}

describe("AutoApprove generate_image", () => {
	it("defaults to manual approval when the dedicated field is absent", () => {
		expect(autoApprove().shouldAutoApproveTool(ClineDefaultTool.GENERATE_IMAGE)).toBe(false)
	})

	it("uses only the dedicated generateImages permission", () => {
		expect(autoApprove(true).shouldAutoApproveTool(ClineDefaultTool.GENERATE_IMAGE)).toBe(true)
		expect(autoApprove(false).shouldAutoApproveTool(ClineDefaultTool.GENERATE_IMAGE)).toBe(false)
	})
})
