import { act, renderHook } from "@testing-library/react"
import { useDebouncedInput } from "./useDebouncedInput"

describe("useDebouncedInput", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("does not persist the initial value on mount", () => {
		const onChange = vi.fn()
		renderHook(() => useDebouncedInput("initial", onChange))

		act(() => vi.advanceTimersByTime(100))

		expect(onChange).not.toHaveBeenCalled()
	})

	it("persists a user edit after the debounce delay", () => {
		const onChange = vi.fn()
		const { result } = renderHook(() => useDebouncedInput("initial", onChange))

		act(() => result.current[1]("edited"))
		act(() => vi.advanceTimersByTime(99))
		expect(onChange).not.toHaveBeenCalled()

		act(() => vi.advanceTimersByTime(1))
		expect(onChange).toHaveBeenCalledOnce()
		expect(onChange).toHaveBeenCalledWith("edited")
	})

	it("synchronizes an external value without persisting it back", () => {
		const onChange = vi.fn()
		const { result, rerender } = renderHook(({ initialValue }) => useDebouncedInput(initialValue, onChange), {
			initialProps: { initialValue: "initial" },
		})

		rerender({ initialValue: "external" })
		act(() => vi.advanceTimersByTime(100))

		expect(result.current[0]).toBe("external")
		expect(onChange).not.toHaveBeenCalled()
	})
})
