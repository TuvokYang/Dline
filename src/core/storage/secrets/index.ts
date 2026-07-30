/**
 * SecretsManager — unified entry point for all secret storage operations.
 */
import * as AccountStore from "./AccountStore"
import * as ApiKeyStore from "./ApiKeyStore"
import * as McpOAuthStore from "./McpOAuthStore"
import * as OcaTokenStore from "./OcaTokenStore"
import * as OpenAiCodexAuthStore from "./OpenAiCodexAuthStore"
import * as ProviderSecretStore from "./ProviderSecretStore"
import * as WandbStore from "./WandbStore"

export type { ApiKeyEntry } from "./ApiKeyStore"
export type { McpOAuthServerData } from "./McpOAuthStore"
export type { OcaTokenData } from "./OcaTokenStore"
export type { OpenAiCodexAuthData } from "./OpenAiCodexAuthStore"
export type { ProviderSecretEntry } from "./ProviderSecretStore"

// API Keys — keyed by profile.id (uuid)
export const getApiKey = ApiKeyStore.getApiKey
export const setApiKey = ApiKeyStore.setApiKey
export const deleteApiKey = ApiKeyStore.deleteApiKey
export const getAllApiKeys = ApiKeyStore.getAllApiKeys
export const migrateApiKey = ApiKeyStore.migrateApiKey
export const setApiKeysBatch = ApiKeyStore.setApiKeysBatch

// Provider-specific credentials that do not fit the single ApiProfile.apiKey field
export const getProviderSecret = ProviderSecretStore.getProviderSecret
export const getAllProviderSecrets = ProviderSecretStore.getAllProviderSecrets
export const setProviderSecretsBatch = ProviderSecretStore.setProviderSecretsBatch

// OpenAI Codex OAuth
export const getOpenAiCodexAuth = OpenAiCodexAuthStore.getOpenAiCodexAuth
export const saveOpenAiCodexAuth = OpenAiCodexAuthStore.saveOpenAiCodexAuth
export const clearOpenAiCodexAuth = OpenAiCodexAuthStore.clearOpenAiCodexAuth

// MCP OAuth
export const getAllMcpOAuthSecrets = McpOAuthStore.getAllMcpOAuthSecrets
export const getMcpOAuthServer = McpOAuthStore.getMcpOAuthServer
export const saveMcpOAuthServer = McpOAuthStore.saveMcpOAuthServer
export const deleteMcpOAuthServer = McpOAuthStore.deleteMcpOAuthServer
export const setAllMcpOAuthSecrets = McpOAuthStore.setAllMcpOAuthSecrets

// OCA Tokens
export const getOcaAccessToken = OcaTokenStore.getOcaAccessToken
export const getOcaRefreshToken = OcaTokenStore.getOcaRefreshToken
export const getOcaTokens = OcaTokenStore.getOcaTokens
export const saveOcaTokens = OcaTokenStore.saveOcaTokens
export const setOcaAccessToken = OcaTokenStore.setOcaAccessToken
export const setOcaRefreshToken = OcaTokenStore.setOcaRefreshToken
export const clearOcaTokens = OcaTokenStore.clearOcaTokens

// Account credentials
export const getAccountApiKey = AccountStore.getAccountApiKey
export const setAccountApiKey = AccountStore.setAccountApiKey
export const getAccountId = AccountStore.getAccountId
export const setAccountId = AccountStore.setAccountId
export const getFirebaseAccountId = AccountStore.getFirebaseAccountId
export const setFirebaseAccountId = AccountStore.setFirebaseAccountId

// Wandb
export const getWandbApiKey = WandbStore.getWandbApiKey
export const setWandbApiKey = WandbStore.setWandbApiKey

// Testing
export function resetAllStores(): void {
	AccountStore.resetAccountStore()
	ApiKeyStore.resetApiKeyStore()
	McpOAuthStore.resetMcpOAuthStore()
	OcaTokenStore.resetOcaTokenStore()
	OpenAiCodexAuthStore.resetOpenAiCodexAuthStore()
	ProviderSecretStore.resetProviderSecretStore()
	WandbStore.resetWandbStore()
}
