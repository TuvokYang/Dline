/**
 * Provider model data — individual model entries extracted from api.ts.
 * Each provider file exports a ModelInfo[] array.
 * This index aggregates all providers into a single Record for seed data export.
 */
import type { ProviderModelsConfig } from "../../../../shared/providers/types"

import { anthropicModels } from "./anthropic"
import { askSageModels } from "./asksage"
import { basetenModels } from "./baseten"
import { bedrockModels } from "./bedrock"
import { cerebrasModels } from "./cerebras"
import { claudeCodeModels } from "./claude-code"
import { deepSeekModels } from "./deepseek"
import { doubaoModels } from "./doubao"
import { fireworksModels } from "./fireworks"
import { geminiModels } from "./gemini"
import { groqModels } from "./groq"
import { huaweiCloudMaasModels } from "./huawei-cloud-maas"
import { huggingFaceModels } from "./huggingface"
import { minimaxModels } from "./minimax"
import { mistralModels } from "./mistral"
import { moonshotModels } from "./moonshot"
import { nebiusModels } from "./nebius"
import { nousResearchModels } from "./nousresearch"
import { openAiCodexModels } from "./openai-codex"
import { openAiNativeModels } from "./openai-native"
import { mainlandQwenModels } from "./qwen-cn"
import { qwenCodeModels } from "./qwen-code"
import { internationalQwenModels } from "./qwen-intl"
import { sambanovaModels } from "./sambanova"
import { sapAiCoreModels } from "./sapaicore"
import { vertexModels } from "./vertex"
import { wandbModels } from "./wandb"
import { xaiModels } from "./xai"
import { mainlandZAiModels } from "./zai-cn"
import { internationalZAiModels } from "./zai-intl"

// Helper: empty models fallback for dynamic providers
const emptyModels: Record<string, any> = {}
// Helper: pick the first model ID as default
const firstKey = <T extends Record<string, unknown>>(obj: T): string => Object.keys(obj)[0] || ""

export const allProviderModels: Record<string, ProviderModelsConfig> = {
	anthropic: {
		provider: "anthropic",
		providerName: "Anthropic",
		baseUrl: "https://api.anthropic.com",
		billingMode: "token",
		models: anthropicModels,
		defaultModelId: firstKey(anthropicModels),
	},
	"claude-code": {
		provider: "claude-code",
		providerName: "Claude Code",
		billingMode: "token",
		models: claudeCodeModels,
		defaultModelId: firstKey(claudeCodeModels),
	},
	bedrock: {
		provider: "bedrock",
		providerName: "AWS Bedrock",
		billingMode: "token",
		models: bedrockModels,
		defaultModelId: firstKey(bedrockModels),
	},
	vertex: {
		provider: "vertex",
		providerName: "Google Vertex AI",
		billingMode: "token",
		models: vertexModels,
		defaultModelId: firstKey(vertexModels),
	},
	gemini: {
		provider: "gemini",
		providerName: "Google Gemini",
		baseUrl: "https://generativelanguage.googleapis.com",
		billingMode: "token",
		models: geminiModels,
		defaultModelId: firstKey(geminiModels),
	},
	"openai-native": {
		provider: "openai-native",
		providerName: "OpenAI Native",
		baseUrl: "https://api.openai.com/v1",
		billingMode: "token",
		models: openAiNativeModels,
		defaultModelId: firstKey(openAiNativeModels),
	},
	"openai-codex": {
		provider: "openai-codex",
		providerName: "OpenAI Codex",
		billingMode: "token",
		models: openAiCodexModels,
		defaultModelId: firstKey(openAiCodexModels),
	},
	deepseek: {
		provider: "deepseek",
		providerName: "DeepSeek",
		baseUrl: "https://api.deepseek.com",
		billingMode: "token",
		models: deepSeekModels,
		defaultModelId: "deepseek-v4-pro",
	},
	huggingface: {
		provider: "huggingface",
		providerName: "Hugging Face",
		baseUrl: "https://router.huggingface.co/v1",
		billingMode: "token",
		models: huggingFaceModels,
		defaultModelId: firstKey(huggingFaceModels),
	},
	qwen: {
		provider: "qwen",
		providerName: "Qwen (International)",
		baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
		billingMode: "token",
		models: internationalQwenModels,
		defaultModelId: firstKey(internationalQwenModels),
	},
	"qwen-cn": {
		provider: "qwen-cn",
		providerName: "Qwen (Mainland China)",
		baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
		billingMode: "token",
		models: mainlandQwenModels,
		defaultModelId: firstKey(mainlandQwenModels),
	},
	doubao: {
		provider: "doubao",
		providerName: "Doubao",
		baseUrl: "https://ark.cn-beijing.volces.com/api/v3/",
		billingMode: "token",
		models: doubaoModels,
		defaultModelId: firstKey(doubaoModels),
	},
	mistral: {
		provider: "mistral",
		providerName: "Mistral",
		baseUrl: "https://api.mistral.ai",
		billingMode: "token",
		models: mistralModels,
		defaultModelId: firstKey(mistralModels),
	},
	asksage: {
		provider: "asksage",
		providerName: "AskSage",
		baseUrl: "https://api.asksage.ai/server",
		billingMode: "token",
		models: askSageModels,
		defaultModelId: firstKey(askSageModels),
	},
	nebius: {
		provider: "nebius",
		providerName: "Nebius",
		baseUrl: "https://api.studio.nebius.ai/v1",
		billingMode: "token",
		models: nebiusModels,
		defaultModelId: firstKey(nebiusModels),
	},
	wandb: {
		provider: "wandb",
		providerName: "Weights & Biases",
		baseUrl: "https://api.inference.wandb.ai/v1",
		billingMode: "token",
		models: wandbModels,
		defaultModelId: firstKey(wandbModels),
	},
	xai: {
		provider: "xai",
		providerName: "xAI",
		baseUrl: "https://api.x.ai/v1",
		billingMode: "token",
		models: xaiModels,
		defaultModelId: firstKey(xaiModels),
	},
	sambanova: {
		provider: "sambanova",
		providerName: "SambaNova",
		baseUrl: "https://api.sambanova.ai/v1",
		billingMode: "token",
		models: sambanovaModels,
		defaultModelId: firstKey(sambanovaModels),
	},
	cerebras: {
		provider: "cerebras",
		providerName: "Cerebras",
		baseUrl: "https://api.cerebras.ai/v1",
		billingMode: "token",
		models: cerebrasModels,
		defaultModelId: firstKey(cerebrasModels),
	},
	groq: {
		provider: "groq",
		providerName: "Groq",
		baseUrl: "https://api.groq.com/openai/v1",
		billingMode: "token",
		models: groqModels,
		defaultModelId: firstKey(groqModels),
	},
	sapaicore: {
		provider: "sapaicore",
		providerName: "SAP AI Core",
		billingMode: "token",
		models: sapAiCoreModels,
		defaultModelId: firstKey(sapAiCoreModels),
	},
	moonshot: {
		provider: "moonshot",
		providerName: "Moonshot",
		baseUrl: "https://api.moonshot.cn/v1",
		billingMode: "token",
		models: moonshotModels,
		defaultModelId: firstKey(moonshotModels),
	},
	"huawei-cloud-maas": {
		provider: "huawei-cloud-maas",
		providerName: "Huawei Cloud MaaS",
		baseUrl: "https://api.modelarts-maas.com/v1/",
		billingMode: "token",
		models: huaweiCloudMaasModels,
		defaultModelId: firstKey(huaweiCloudMaasModels),
	},
	baseten: {
		provider: "baseten",
		providerName: "Baseten",
		baseUrl: "https://inference.baseten.co/v1",
		billingMode: "token",
		models: basetenModels,
		defaultModelId: firstKey(basetenModels),
	},
	"zai-intl": {
		provider: "zai-intl",
		providerName: "ZAi (International)",
		baseUrl: "https://api.z.ai/api/paas/v4",
		billingMode: "token",
		models: internationalZAiModels,
		defaultModelId: firstKey(internationalZAiModels),
	},
	"zai-cn": {
		provider: "zai-cn",
		providerName: "ZAi (Mainland China)",
		baseUrl: "https://open.bigmodel.cn/api/paas/v4",
		billingMode: "token",
		models: mainlandZAiModels,
		defaultModelId: firstKey(mainlandZAiModels),
	},
	fireworks: {
		provider: "fireworks",
		providerName: "Fireworks",
		baseUrl: "https://api.fireworks.ai/inference/v1",
		billingMode: "token",
		models: fireworksModels,
		defaultModelId: firstKey(fireworksModels),
	},
	"qwen-code": {
		provider: "qwen-code",
		providerName: "Qwen Code",
		baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
		billingMode: "token",
		models: qwenCodeModels,
		defaultModelId: firstKey(qwenCodeModels),
	},
	minimax: {
		provider: "minimax",
		providerName: "MiniMax",
		baseUrl: "https://api.minimax.chat/v1",
		billingMode: "token",
		models: minimaxModels,
		defaultModelId: firstKey(minimaxModels),
	},
	nousResearch: {
		provider: "nousResearch",
		providerName: "Nous Research",
		baseUrl: "https://inference-api.nousResearch.com/v1",
		billingMode: "token",
		models: nousResearchModels,
		defaultModelId: firstKey(nousResearchModels),
	},
	openrouter: {
		provider: "openrouter",
		providerName: "OpenRouter",
		baseUrl: "https://openrouter.ai/api/v1",
		billingMode: "token",
		models: emptyModels,
	},
	openai: {
		provider: "openai",
		providerName: "OpenAI Compatible",
		baseUrl: "https://api.openai.com/v1",
		billingMode: "token",
		models: emptyModels,
	},
	ollama: {
		provider: "ollama",
		providerName: "Ollama",
		baseUrl: "http://localhost:11434",
		billingMode: "free",
		models: emptyModels,
	},
	lmstudio: {
		provider: "lmstudio",
		providerName: "LM Studio",
		baseUrl: "http://localhost:1234",
		billingMode: "free",
		models: emptyModels,
	},
	requesty: {
		provider: "requesty",
		providerName: "Requesty",
		baseUrl: "https://router.requesty.ai/v1",
		billingMode: "token",
		models: emptyModels,
	},
	together: {
		provider: "together",
		providerName: "Together",
		baseUrl: "https://api.together.xyz/v1",
		billingMode: "token",
		models: emptyModels,
	},
	"vscode-lm": {
		provider: "vscode-lm",
		providerName: "VS Code LM",
		billingMode: "free",
		models: emptyModels,
	},
	cline: {
		provider: "cline",
		providerName: "Cline",
		billingMode: "token",
		models: emptyModels,
	},
	litellm: {
		provider: "litellm",
		providerName: "LiteLLM",
		baseUrl: "http://localhost:4000",
		billingMode: "token",
		models: emptyModels,
	},
	dify: {
		provider: "dify",
		providerName: "Dify",
		billingMode: "token",
		models: emptyModels,
	},
	"vercel-ai-gateway": {
		provider: "vercel-ai-gateway",
		providerName: "Vercel AI Gateway",
		baseUrl: "https://ai-gateway.vercel.sh/v1",
		billingMode: "token",
		models: emptyModels,
	},
	oca: {
		provider: "oca",
		providerName: "OCA",
		billingMode: "token",
		models: emptyModels,
	},
	aihubmix: {
		provider: "aihubmix",
		providerName: "AIHubMix",
		baseUrl: "https://aihubmix.com",
		billingMode: "token",
		models: emptyModels,
	},
	hicap: {
		provider: "hicap",
		providerName: "HiCap",
		baseUrl: "https://api.hicap.ai/v2/openai",
		billingMode: "token",
		models: emptyModels,
	},
}
