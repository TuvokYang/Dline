import { ApiProfile } from "@shared/proto/dline/profile"
import { fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { ImageGenerationProfileSettingsEditor } from "./ImageGenerationProfileSettingsEditor"

vi.mock("../common/DebouncedTextField", () => ({
	DebouncedTextField: ({ children, initialValue, onChange }: { children: ReactNode; initialValue: string; onChange: (value: string) => void }) => (
		<label>
			{children}
			<input defaultValue={initialValue} onChange={(event) => onChange(event.target.value)} />
		</label>
	),
}))

describe("ImageGenerationProfileSettingsEditor", () => {
	it("updates task budget, timeout, and concurrency without changing chat or image model IDs", () => {
		const profile = ApiProfile.create({
			id: "profile-1",
			modelId: "gpt-chat",
			imageModelId: "gpt-image-2",
			imageGeneration: { taskBudgetUsd: 1, requestTimeoutMs: 120_000, maxConcurrentRequests: 1 },
		})
		const onUpdate = vi.fn()
		render(<ImageGenerationProfileSettingsEditor onUpdate={onUpdate} profile={profile} />)

		fireEvent.change(screen.getByLabelText("Task budget (USD)"), { target: { value: "2.5" } })
		fireEvent.change(screen.getByLabelText("Request timeout (ms)"), { target: { value: "90000" } })
		fireEvent.change(screen.getByLabelText("Max concurrent requests"), { target: { value: "2" } })

		expect(onUpdate).toHaveBeenNthCalledWith(1, {
			imageGeneration: { taskBudgetUsd: 2.5, requestTimeoutMs: 120_000, maxConcurrentRequests: 1 },
		})
		expect(onUpdate).toHaveBeenNthCalledWith(2, {
			imageGeneration: { taskBudgetUsd: 1, requestTimeoutMs: 90_000, maxConcurrentRequests: 1 },
		})
		expect(onUpdate).toHaveBeenNthCalledWith(3, {
			imageGeneration: { taskBudgetUsd: 1, requestTimeoutMs: 120_000, maxConcurrentRequests: 2 },
		})
		expect(profile.modelId).toBe("gpt-chat")
		expect(profile.imageModelId).toBe("gpt-image-2")
	})
})
