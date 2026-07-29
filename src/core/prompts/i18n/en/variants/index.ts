import { litePromptModule } from "./lite"
import { standardPromptModule } from "./standard"

export const variantPromptModules = [standardPromptModule, litePromptModule] as const
