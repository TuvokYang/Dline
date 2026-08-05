import { resolveWebSearchRoutingPlan } from "@core/api/server-tools"
import { ApiFormat, ServerTool } from "@shared/proto/dline/models/metadata"
import { WebSearchMode } from "@shared/proto/dline/provider/common"

export const LOCAL_WEB_SEARCH_ROUTING_PLAN = resolveWebSearchRoutingPlan({
	enabled: true,
	mode: WebSearchMode.WEB_SEARCH_MODE_AUTO,
	modelInfo: undefined,
	selectedApiFormat: ApiFormat.OPENAI_CHAT,
	localAvailable: true,
	remoteAdapterAvailable: false,
})

export const HOSTED_WEB_SEARCH_ROUTING_PLAN = resolveWebSearchRoutingPlan({
	enabled: true,
	mode: WebSearchMode.WEB_SEARCH_MODE_AUTO,
	modelInfo: { capabilities: { tools: [ServerTool.WEB_SEARCH] } },
	selectedApiFormat: ApiFormat.OPENAI_RESPONSES,
	localAvailable: true,
	remoteAdapterAvailable: true,
})

export const DISABLED_WEB_SEARCH_ROUTING_PLAN = resolveWebSearchRoutingPlan({
	enabled: true,
	mode: WebSearchMode.WEB_SEARCH_MODE_FORCE_OFF,
	modelInfo: { capabilities: { tools: [ServerTool.WEB_SEARCH] } },
	selectedApiFormat: ApiFormat.OPENAI_RESPONSES,
	localAvailable: true,
	remoteAdapterAvailable: true,
})
