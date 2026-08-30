import { createRuntimeContract } from "../../helpers/create-contract"
import { defineLegacyModule } from "../../helpers/define-legacy-module"

import agentRole from "./agentRole"
import capabilities from "./capabilities"
import capabilityCatalog from "./capabilityCatalog"
import contextManagement from "./contextManagement"
import editingFiles from "./editingFiles"
import feedback from "./feedback"
import focusChain from "./focusChain"
import inputQueue from "./inputQueue"
import mcp from "./mcp"
import objective from "./objective"
import responses from "./responses"
import resumeProvenance from "./resumeProvenance"
import rules from "./rules"
import runtimeEnvironment from "./runtimeEnvironment"
import skills from "./skills"
import systemInfo from "./systemInfo"
import taskProgress from "./taskProgress"
import toolUseExamples from "./toolUseExamples"
import toolUseFormatting from "./toolUseFormatting"
import toolUseGuidelines from "./toolUseGuidelines"
import toolUseIndex from "./toolUseIndex"
import toolUseTools from "./toolUseTools"
import userInstructions from "./userInstructions"
import workflows from "./workflows"

export const systemPromptModules = [
	defineLegacyModule("agentRole", "system", agentRole),
	defineLegacyModule("capabilities", "system", capabilities, {
		main: createRuntimeContract("BROWSER_SUPPORT", "YOLO_ASK_TEXT", "CWD", "BROWSER_CAPABILITIES", "WEB_TOOLS_CAPABILITIES"),
	}),
	defineLegacyModule("capabilityCatalog", "system", capabilityCatalog, {
		entry: createRuntimeContract("NAME", "DESCRIPTION"),
		group: createRuntimeContract("TITLE", "GUIDANCE", "ENTRIES"),
	}),
	defineLegacyModule("contextManagement", "system", contextManagement, {
		summarizeMain: createRuntimeContract(
			"CWD",
			"MULTI_ROOT_HINT",
			"FOCUS_CHAIN_PARAM",
			"FOCUS_CHAIN_USAGE",
			"FOCUS_CHAIN_EXAMPLE",
			"SUMMARY_DECISION",
			"COMPACTION_WINDOW_BUDGET",
		),
		continuationPrompt: createRuntimeContract("SUMMARY_TEXT"),
	}),
	defineLegacyModule("editingFiles", "system", editingFiles, { main: createRuntimeContract("AUTO_FORMATTING_SECTION") }),
	defineLegacyModule("feedback", "system", feedback),
	defineLegacyModule("focusChain", "system", focusChain, {
		planModeReminder: createRuntimeContract("REMINDER"),
		recommended: createRuntimeContract("LIST_INSTRUCTIONS_RECOMMENDED"),
		apiRequestCount: createRuntimeContract("API_REQUEST_COUNT", "REMINDER"),
	}),
	defineLegacyModule("inputQueue", "system", inputQueue),
	defineLegacyModule("mcp", "system", mcp),
	defineLegacyModule("objective", "system", objective),
	defineLegacyModule("runtimeEnvironment", "system", runtimeEnvironment, {
		multiRootWorkingDirectory: createRuntimeContract("ROOTS", "CWD"),
		multiRootHint: createRuntimeContract("ROOTS"),
		connectedMcpServers: createRuntimeContract("NAMES"),
	}),
	defineLegacyModule("responses", "system", responses, {
		fileSizeKb: createRuntimeContract("SIZE"),
		fileLineCount: createRuntimeContract("COUNT"),
		checkpointRestoreAct: createRuntimeContract("EDITED_TEXT"),
		checkpointRestorePlan: createRuntimeContract("EDITED_TEXT"),
		clineIgnoreInstructions: createRuntimeContract("LOCK_SYMBOL", "CONTENT"),
		clineRulesGlobalDirInstructions: createRuntimeContract("CONTENT"),
		clineRulesLocalDirInstructions: createRuntimeContract("WORKSPACE_NAME", "CONTENT"),
		clineRulesLocalFileInstructions: createRuntimeContract("WORKSPACE_NAME", "CONTENT"),
		windsurfRulesLocalFileInstructions: createRuntimeContract("CWD", "CONTENT"),
		cursorRulesLocalFileInstructions: createRuntimeContract("CWD", "CONTENT"),
		cursorRulesLocalDirInstructions: createRuntimeContract("CWD", "CONTENT"),
		agentsRulesLocalFileInstructions: createRuntimeContract("CWD", "CONTENT"),
	}),
	defineLegacyModule("resumeProvenance", "system", resumeProvenance, {
		missingToolResult: createRuntimeContract("TOOL_NAME"),
		continuationWithUserText: createRuntimeContract("PROVENANCE", "USER_TEXT"),
	}),
	defineLegacyModule("rules", "system", rules),
	defineLegacyModule("skills", "system", skills),
	defineLegacyModule("systemInfo", "system", systemInfo, {
		main: createRuntimeContract("OS", "IDE", "SHELL", "HOME_DIR", "WORKSPACE_TITLE", "WORKING_DIR"),
	}),
	defineLegacyModule("taskProgress", "system", taskProgress),
	defineLegacyModule("toolUseExamples", "system", toolUseExamples, {
		main: createRuntimeContract("FOCUS_CHAIN_EXAMPLE_BASH", "FOCUS_CHAIN_EXAMPLE_NEW_FILE", "FOCUS_CHAIN_EXAMPLE_EDIT"),
	}),
	defineLegacyModule("toolUseFormatting", "system", toolUseFormatting, {
		main: createRuntimeContract("FOCUS_CHATIN_FORMATTING"),
	}),
	defineLegacyModule("toolUseGuidelines", "system", toolUseGuidelines),
	defineLegacyModule("toolUseIndex", "system", toolUseIndex, {
		main: createRuntimeContract(
			"TOOL_USE_FORMATTING_SECTION",
			"TOOLS_SECTION",
			"TOOL_USE_EXAMPLES_SECTION",
			"TOOL_USE_GUIDELINES_SECTION",
		),
	}),
	defineLegacyModule("toolUseTools", "system", toolUseTools),
	defineLegacyModule("workflows", "system", workflows),
	defineLegacyModule("userInstructions", "system", userInstructions, { main: createRuntimeContract("CUSTOM_INSTRUCTIONS") }),
] as const
