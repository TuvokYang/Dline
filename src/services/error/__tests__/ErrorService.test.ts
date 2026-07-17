import { describe, expect, it, vi } from "vitest"
import { Logger } from "@/shared/services/Logger"
import { ErrorService } from "../ErrorService"
import type { IErrorProvider } from "../providers/IErrorProvider"

vi.mock("@/shared/services/Logger", () => ({ Logger: { error: vi.fn() } }))
vi.mock("../ErrorProviderFactory", () => ({ ErrorProviderFactory: {} }))

function provider(): IErrorProvider {
	return {
		captureException: vi.fn(async () => undefined),
		logException: vi.fn(),
		logMessage: vi.fn(),
		isEnabled: vi.fn(() => true),
		getSettings: vi.fn(() => ({ enabled: true, hostEnabled: true, level: "all" as const })),
		dispose: vi.fn(async () => undefined),
	}
}

describe("ErrorService", () => {
	it("passes the error object to Logger without double JSON serialization", () => {
		const errorProvider = provider()
		const service = new ErrorService(errorProvider)
		const error = new Error("Invalid task phase transition")

		service.logException(error, { modelId: "gpt-test" })

		expect(errorProvider.logException).toHaveBeenCalledWith(error, { modelId: "gpt-test" })
		expect(Logger.error).toHaveBeenCalledWith("[ErrorService] Logging exception", error)
	})
})
