import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useChatState } from "./useChatState"

describe("useChatState task ownership", () => {
	it("reenables Welcome submission after the active task is closed", async () => {
		const { result, rerender } = renderHook(({ taskId }: { taskId?: string }) => useChatState([], taskId), {
			initialProps: { taskId: "task-1" as string | undefined },
		})

		act(() => result.current.setSendingDisabled(true))
		expect(result.current.sendingDisabled).toBe(true)

		rerender({ taskId: undefined })

		await waitFor(() => expect(result.current.sendingDisabled).toBe(false))
	})
})
