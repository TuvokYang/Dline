export const SYSTEM_SECTION_IDS = [
	"agent-role",
	"tool-use",
	"todo",
	"task-progress",
	"editing-files",
	"act-vs-plan",
	"capabilities",
	"skills",
	"feedback",
	"rules",
	"system-info",
	"objective",
	"user-instructions",
] as const

export type SystemSectionId = (typeof SYSTEM_SECTION_IDS)[number]

export interface SystemTemplateDefinition {
	readonly id: string
	readonly sectionIds: readonly SystemSectionId[]
}

export interface SystemVariantDefinition {
	readonly id: string
	readonly compatibleTemplateIds: readonly string[]
}

export const NATIVE_NEXT_GEN_COMPATIBLE_TEMPLATE: SystemTemplateDefinition = {
	id: "native-next-gen-compatible",
	sectionIds: SYSTEM_SECTION_IDS,
}

export function defineSystemVariant(definition: SystemVariantDefinition): SystemVariantDefinition {
	return definition
}

export class SystemTemplateRegistry {
	private readonly templates: ReadonlyMap<string, SystemTemplateDefinition>

	public constructor(templates: readonly SystemTemplateDefinition[]) {
		this.templates = new Map(templates.map((template) => [template.id, template]))
	}

	public get(templateId: string): SystemTemplateDefinition {
		const template = this.templates.get(templateId)
		if (!template) {
			throw new Error(`Unknown system template: ${templateId}`)
		}
		return template
	}

	public requireCompatibleVariant(templateId: string, variant: SystemVariantDefinition): SystemVariantDefinition {
		if (!variant.compatibleTemplateIds.includes(templateId)) {
			throw new Error(`Variant ${variant.id} is not compatible with system template ${templateId}`)
		}
		return variant
	}
}

/** Frame a system section with a standard Markdown heading. */
export function frameSystemSection(sectionId: string, body: string): string {
	if (sectionId === "agent-role" || body.startsWith("#")) {
		return body
	}
	return body.replace(/^([^\r\n]+)(\r?\n|$)/, "# $1$2")
}

export function assembleSystemSections(
	sectionIds: readonly string[],
	sections: ReadonlyMap<string, string>,
	separator: string,
): string {
	return sectionIds
		.map((sectionId) => frameSystemSection(sectionId, sections.get(sectionId) ?? ""))
		.filter((body) => body.length > 0)
		.join(separator)
}
