import type { LanguageKey } from "@shared/Languages"
import { Logger } from "@/shared/services/Logger"
import { englishPrompts } from "./en"

type PromptModule = Record<string, string>
type LanguagePack = Record<string, PromptModule>

const registry: Record<string, LanguagePack> = {
	en: englishPrompts,
}

/**
 * Validate that a non-English language pack has all the same modules
 * and keys as the English reference. Returns missing entries.
 */
export function validateLangCompleteness(lang: string): string[] {
	const enPack = registry.en
	const langPack = registry[lang]
	if (!langPack) {
		return [`Language '${lang}' not registered`]
	}

	const missing: string[] = []
	for (const [moduleName, enModule] of Object.entries(enPack)) {
		const langModule = langPack[moduleName]
		if (!langModule) {
			missing.push(`Missing module: ${moduleName}`)
			continue
		}
		for (const key of Object.keys(enModule)) {
			if (!(key in langModule)) {
				missing.push(`Missing key: ${moduleName}.${key}`)
			}
		}
	}
	return missing
}

export function registerPrompts(lang: string, moduleName: string, prompts: PromptModule): void {
	if (!registry[lang]) {
		registry[lang] = {}
	}
	registry[lang][moduleName] = prompts
}

export function getPrompt(module: string, key: string, params?: Record<string, unknown>, lang?: LanguageKey): string {
	const effectiveLang = lang ?? "en"

	// Try the requested language first, then fall back to English
	const prompts = registry[effectiveLang]?.[module]
	const enPrompts = registry.en[module] ?? prompts
	const missingKey = `[MISSING: ${module}.${key}]`
	if (!prompts?.[key] && !enPrompts?.[key]) {
		Logger.warn(`[i18n] Missing prompt: ${module}.${key}`)
	}
	let text = prompts?.[key] ?? enPrompts?.[key] ?? missingKey

	if (params) {
		text = text.replace(/\{(\w+)\}/g, (_, k: string) => {
			return params[k] !== undefined ? String(params[k]) : `{${k}}`
		})
	}

	return text
}
