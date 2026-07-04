import type { LanguageKey } from "@shared/Languages"
import * as fs from "fs"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"

type PromptModule = Record<string, string>
type LanguagePack = Record<string, PromptModule>

/**
 * Auto-load all .ts prompt modules from a language directory.
 * Scans the i18n/{lang}/ directory and requires each .ts file,
 * registering its default export as a prompt module.
 */
function autoLoadLangModules(lang: string): LanguagePack {
	const modules: LanguagePack = {}
	const langDir = path.join(__dirname, lang)

	try {
		const files = fs.readdirSync(langDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
		for (const file of files) {
			const moduleName = file.replace(".ts", "")
			try {
				// eslint-disable-next-line @typescript-eslint/no-require-imports
				const mod = require(`./${lang}/${file}`)
				modules[moduleName] = mod.default || mod
			} catch {
				// Skip files that can't be loaded
			}
		}
	} catch {
		// Directory doesn't exist — no modules for this language
	}

	return modules
}

const registry: Record<string, LanguagePack> = {
	en: autoLoadLangModules("en"),
	"zh-cn": autoLoadLangModules("zh-cn"),
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
	let prompts = registry[effectiveLang]?.[module]
	if (!prompts) {
		// Lazy-load: try to load the module for this language on demand
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const mod = require(`./${effectiveLang}/${module}.ts`)
			const loaded = mod.default || mod
			if (loaded && typeof loaded === "object") {
				registerPrompts(effectiveLang, module, loaded)
				prompts = loaded
			}
		} catch {
			// Module not found for this language
		}
	}

	// Fall back to English if still not found
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
