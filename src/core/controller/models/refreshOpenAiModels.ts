import { StringArray } from "@shared/proto/dline/common"
import { OpenAiModelsRequest } from "@shared/proto/dline/models"
import type { AxiosRequestConfig } from "axios"
import axios from "axios"
import { getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

interface OpenAiModelsResponse {
	data?: Array<{ id?: unknown }>
}

function getModelsUrl(baseUrl: string): string {
	const url = new URL(baseUrl)
	const pathName = url.pathname.replace(/\/+$/, "")
	if (/\/models$/i.test(pathName)) {
		url.pathname = pathName
	} else if (/\/v1$/i.test(pathName)) {
		url.pathname = `${pathName}/models`
	} else {
		url.pathname = `${pathName}/v1/models`
	}
	url.search = ""
	url.hash = ""
	return url.toString()
}

/**
 * Fetches available models from the OpenAI API
 * @param controller The controller instance
 * @param request Request containing the base URL and API key
 * @returns Array of model names
 */
export async function refreshOpenAiModels(_controller: Controller, request: OpenAiModelsRequest): Promise<StringArray> {
	try {
		if (!request.baseUrl) {
			return StringArray.create({ values: [] })
		}

		const config: AxiosRequestConfig = {}
		if (request.apiKey) {
			config.headers = { Authorization: `Bearer ${request.apiKey}` }
		}

		const response = await axios.get<OpenAiModelsResponse>(getModelsUrl(request.baseUrl), {
			...config,
			...getAxiosSettings(),
		})
		const modelsArray = (response.data?.data ?? [])
			.map((model) => (typeof model.id === "string" ? model.id : undefined))
			.filter((modelId): modelId is string => modelId !== undefined)
		const models = [...new Set<string>(modelsArray)]

		return StringArray.create({ values: models })
	} catch (error) {
		Logger.error("Error fetching OpenAI models:", error)
		return StringArray.create({ values: [] })
	}
}
