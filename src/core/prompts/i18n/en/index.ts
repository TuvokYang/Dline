import accessMcpResource from "./accessMcpResource"
import actModeRespond from "./actModeRespond"
import actVsPlanMode from "./actVsPlanMode"
import agentRole from "./agentRole"
import applyPatch from "./applyPatch"
import askFollowupQuestion from "./askFollowupQuestion"
import attemptCompletion from "./attemptCompletion"
import browserAction from "./browserAction"
import capabilities from "./capabilities"
import commands from "./commands"
import compactSystemPrompt from "./compactSystemPrompt"
import contextManagement from "./contextManagement"
import deepPlanning5Step from "./deepPlanning5Step"
import deepPlanningGeneric from "./deepPlanningGeneric"
import devstralOverrides from "./devstralOverrides"
import editingFiles from "./editingFiles"
import executeCommand from "./executeCommand"
import feedback from "./feedback"
import findReferences from "./findReferences"
import focusChain from "./focusChain"
import gemini3Overrides from "./gemini3Overrides"
import generateExplanation from "./generateExplanation"
import generateReport from "./generateReport"
import glmOverrides from "./glmOverrides"
import gpt5Legacy from "./gpt5Legacy"
import hermesOverrides from "./hermesOverrides"
import listCodeDefinitionNames from "./listCodeDefinitionNames"
import listFiles from "./listFiles"
import loadCapability from "./loadCapability"
import loadMcpDocumentation from "./loadMcpDocumentation"
import loadMcpDocumentationTool from "./loadMcpDocumentationTool"
import mcp from "./mcp"
import nativeGpt51Overrides from "./nativeGpt51Overrides"
import nativeNextGenActVsPlan from "./nativeNextGenActVsPlan"
import nativeNextGenObjective from "./nativeNextGenObjective"
import newTask from "./newTask"
import nextGenTemplate from "./nextGenTemplate"
import objective from "./objective"
import planModeRespond from "./planModeRespond"
import qnaRespond from "./qnaRespond"
import readFile from "./readFile"
import rename from "./rename"
import replaceInFile from "./replaceInFile"
import replaceText from "./replaceText"
import responses from "./responses"
import rules from "./rules"
import searchFiles from "./searchFiles"
import skills from "./skills"
import spawnTask from "./spawnTask"
import statusUpdate from "./statusUpdate"
import subagent from "./subagent"
import systemInfo from "./systemInfo"
import taskProgress from "./taskProgress"
import toolHandlers from "./toolHandlers"
import toolUseExamples from "./toolUseExamples"
import toolUseFormatting from "./toolUseFormatting"
import toolUseGuidelines from "./toolUseGuidelines"
import toolUseIndex from "./toolUseIndex"
import toolUseTools from "./toolUseTools"
import trinityOverrides from "./trinityOverrides"
import useMcpTool from "./useMcpTool"
import userInstructions from "./userInstructions"
import useSkill from "./useSkill"
import webFetch from "./webFetch"
import webSearch from "./webSearch"
import writeToFile from "./writeToFile"
import xsOverrides from "./xsOverrides"

export const englishPrompts = {
	accessMcpResource,
	actModeRespond,
	actVsPlanMode,
	agentRole,
	applyPatch,
	askFollowupQuestion,
	attemptCompletion,
	browserAction,
	capabilities,
	commands,
	compactSystemPrompt,
	contextManagement,
	deepPlanning5Step,
	deepPlanningGeneric,
	devstralOverrides,
	editingFiles,
	executeCommand,
	feedback,
	findReferences,
	focusChain,
	gemini3Overrides,
	generateExplanation,
	generateReport,
	glmOverrides,
	gpt5Legacy,
	hermesOverrides,
	listCodeDefinitionNames,
	listFiles,
	loadCapability,
	loadMcpDocumentation,
	loadMcpDocumentationTool,
	mcp,
	nativeGpt51Overrides,
	nativeNextGenActVsPlan,
	nativeNextGenObjective,
	newTask,
	nextGenTemplate,
	objective,
	planModeRespond,
	qnaRespond,
	readFile,
	rename,
	replaceInFile,
	replaceText,
	responses,
	rules,
	searchFiles,
	skills,
	spawnTask,
	statusUpdate,
	subagent,
	systemInfo,
	taskProgress,
	toolHandlers,
	toolUseExamples,
	toolUseFormatting,
	toolUseGuidelines,
	toolUseIndex,
	toolUseTools,
	trinityOverrides,
	useMcpTool,
	userInstructions,
	useSkill,
	webFetch,
	webSearch,
	writeToFile,
	xsOverrides,
} satisfies Record<string, Record<string, string>>
