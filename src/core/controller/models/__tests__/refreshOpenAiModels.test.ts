import { OpenAiModelsRequest } from "@shared/proto/dline/models"
import axios from "axios"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Controller } from "../.."
import { refreshOpenAiModels } from "../refreshOpenAiModels"

vi.mock("axios", () => ({ default: { get: vi.fn() } }))
vi.mock("@/shared/net", () => ({ getAxiosSettings: () => ({}) }))

describe("refreshOpenAiModels", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(axios.get).mockResolvedValue({ data: { data: [{ id: "gpt-e2e" }] } })
	})

	it("requests baseUrl/v1/models when the configured URL has no API version", async () => {
		await refreshOpenAiModels(
			{} as Controller,
			OpenAiModelsRequest.create({ baseUrl: "https://gateway.example.test", apiKey: "secret" }),
		)

		expect(axios.get).toHaveBeenCalledWith("https://gateway.example.test/v1/models", {
			headers: { Authorization: "Bearer secret" },
		})
	})

	it("does not duplicate v1 when the configured URL already includes it", async () => {
		await refreshOpenAiModels(
			{} as Controller,
			OpenAiModelsRequest.create({ baseUrl: "https://gateway.example.test/v1/", apiKey: "secret" }),
		)

		expect(axios.get).toHaveBeenCalledWith("https://gateway.example.test/v1/models", {
			headers: { Authorization: "Bearer secret" },
		})
	})
})
