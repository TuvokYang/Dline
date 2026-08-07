// English workflow prompts — key-value pairs only, no code logic.

const prompts: Record<string, string> = {
	standardCatalogGuidance:
		'Workflows provide reusable, ordered procedures for multi-step operations so required stages, checks, and handoffs are followed consistently. Use `load_workflow` once with the exact advertised name, then follow the returned steps in order. If `<explicit_instructions type="workflow">` is already present, follow those instructions directly and do not call `load_workflow` again.',
	liteCatalogGuidance:
		'Workflows provide reusable, ordered procedures for multi-step operations so required stages, checks, and handoffs are followed consistently. If `<explicit_instructions type="workflow">` is present, follow the provided steps in order.',
	catalogListIntroduction: "The Workflows available to the current task are listed below:",
}

export default prompts
