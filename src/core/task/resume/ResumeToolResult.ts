import { type AssembleToolTurnContentInput, assembleToolTurnContent } from "../continuation/ToolTurnContentAssembler"

export type CollectResumeTurnContentInput = AssembleToolTurnContentInput

/** Compatibility adapter for existing resume and context-transition callers. */
export const collectResumeTurnContent = assembleToolTurnContent
