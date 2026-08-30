// Simplified Chinese InputQueue delivery prompts — key-value pairs only, no code logic.

const prompts: Record<string, string> = {
	auxiliaryAlignmentV1:
		"以下内容是用户在任务执行过程中追加的辅助对齐信息。请在后续执行中遵循这些信息。" +
		"除非用户明确要求改变方案，否则应保持已经对齐的方案，仅做必要的小范围调整。",
}

export default prompts
