import { litePromptModule } from "./lite"
import { nativePromptModule } from "./native"

export const variantPromptModules = [nativePromptModule, litePromptModule] as const
