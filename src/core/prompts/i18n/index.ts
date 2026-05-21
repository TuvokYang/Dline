import type { LanguageKey } from "@shared/Languages"
import enResponses from "./en/responses"

type PromptModule = Record<string, string>
type LanguagePack = Record<string, PromptModule>

const registry: Record<string, LanguagePack> = {
	en: {},
	"zh-CN": {},
}

// Register English modules
registry.en.responses = enResponses

export function registerPrompts(lang: string, moduleName: string, prompts: PromptModule): void {
	if (!registry[lang]) {
		registry[lang] = {}
	}
	registry[lang][moduleName] = prompts
}

export function getPrompt(module: string, key: string, params?: Record<string, any>, lang?: LanguageKey): string {
	const effectiveLang = lang ?? "en"
	const prompts = registry[effectiveLang]?.[module] ?? registry.en[module]
	let text = prompts?.[key] ?? registry.en[module]?.[key] ?? `[MISSING: ${module}.${key}]`

	if (params) {
		text = text.replace(/\{(\w+)\}/g, (_, k: string) => {
			return params[k] !== undefined ? String(params[k]) : `{${k}}`
		})
	}

	return text
}
