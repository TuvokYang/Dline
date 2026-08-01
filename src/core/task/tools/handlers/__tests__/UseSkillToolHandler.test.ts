import { createTaskCapabilityToggles } from "@shared/TaskCapabilityToggles"
import { ClineDefaultTool } from "@shared/tools"
import { describe, expect, it, vi } from "vitest"
import type { TaskConfig } from "../../types/TaskConfig"
import { UseSkillToolHandler } from "../UseSkillToolHandler"

describe("UseSkillToolHandler task capability scope", () => {
	it("does not load a remote skill disabled in the current task", async () => {
		const config = {
			cwd: "E:/workspace/project",
			capabilityToggles: createTaskCapabilityToggles({
				remoteSkillsToggles: { reviewer: false },
			}),
			taskState: { consecutiveMistakeCount: 0 },
			services: {
				stateManager: {
					getRemoteConfigSettings: vi.fn().mockReturnValue({
						remoteGlobalSkills: [
							{
								name: "reviewer",
								alwaysEnabled: false,
								contents: "---\nname: reviewer\ndescription: Review code\n---\nReview carefully.",
							},
						],
					}),
					getGlobalStateKey: vi.fn().mockReturnValue({ reviewer: true }),
				},
			},
		} as unknown as TaskConfig

		const result = await new UseSkillToolHandler().execute(config, {
			type: "tool_use",
			name: ClineDefaultTool.USE_SKILL,
			params: { skill_name: "reviewer" },
			partial: false,
			function_id: "skill_function",
			dline_tid: "skill_tid",
			ts: 1,
		})

		expect(result).toBe("Error: No skills are available. Skills may be disabled or not configured.")
	})
})
