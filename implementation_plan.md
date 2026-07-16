# Implementation Plan

[Overview]
完成 REVIEW-012 的通过结论处置并将 TASK-006、KS-06 与 WS-001 的权威 Memory 状态一致关闭，同时保留当前未提交代码和 Git 授权边界。

本次工作不是新的产品功能实现，而是对已经实现、验证并通过独立审查的 PromptProfile 上游解析改动执行最终门禁闭环。当前代码工作树在 `8bd3a15d6786929096ceea9ae9026c7dcdddcc66` 上包含 15 个 tracked modified 与 2 个 untracked added；生产合同已经由共享 resolver、三处上游 ingress 和 Prompt Domain 必选 profile 构成，相关 Vitest UI 定向验证、TypeScript、Biome、build 与 diff 检查均已有成功证据。

`REVIEW-012` 对 `RC-012` 冻结范围给出合法 `pass`，并明确将 `F-010-001` 标记为 `closed`，没有 required finding 或 advisory。实施阶段只需记录该 disposition、新增 closure event，并把 Enterprise Memory Bank 中仍停留在 `review`、`open`、`rework` 或 `review_pending` 的 TASK-006、KS-06、WS-001 与 verification 记录原子地推进到 `completed` / `closed`。所有语义或状态 revision 必须按文件现有规则人工递增，文档正文继续使用中文。

边界严格限定在 `.memory-bank/workstreams/WS-001-prompt-i18n-recovery/**` 的 closure 记录与最终只读 Git 核验；不得读取、修改或管理 WS-007 Memory，不得修改 Webview、Proto、settings 或其他 Task Runtime 行为，不得重跑已经完成的测试，除非 closure 意外触及代码（按本计划不应发生）。Vitest 如确需运行，只能先通过 `npm run vitest:ui -- status` 确认现有服务在线，再使用 `scripts/vitest-ui` wrapper 定向执行；禁止 full/direct Vitest、`rerun all`、`rerun failed` 以及服务生命周期操作。不得执行 `git add`、`git commit`、`merge`、`push`、`reset` 或 `amend`；提交必须等待 My lord 对本轮 commit 的单独授权。

[Types]
不引入新的生产 TypeScript 类型；仅更新现有 Memory 状态、revision、review disposition 与 verification 枚举值。

- `.memory-bank/workstreams/WS-001-prompt-i18n-recovery/tasks/TASK-006-matrix/progress.yaml`
  - `status`: `review` → `completed`。
  - `state_revision`: `35` → `36`。
  - `base_state_revision`: 更新为 `35`。
  - `current_step`: 描述 `REVIEW-012 pass`、`F-010-001 closed` 与 TASK 完成。
  - `next_action`: 仅保留“等待 My lord 单独授权 Git commit；不得 amend/reset/push”。
  - `blocked_by`: `[]`。
  - `last_event_id`: 指向新 closure event `EVT-006-000025`。
  - `last_evidence_id`: `EVD-006-021`。
  - `last_review_context_id`: `RC-012`。
  - `last_review`: `REVIEW-012`。
  - `review_disposition`: `review_id: REVIEW-012`、`context_id: RC-012`、`result: pass`、`status: accepted`、`output_read: true`，记录 `F-010-001` closure 与无 required findings。
  - `finding_dispositions`: 追加或更新 `{id: F-010-001, status: closed, verified_by: REVIEW-012, evidence: [EVD-006-021]}`；保留既有历史 dispositions。
- `.memory-bank/workstreams/WS-001-prompt-i18n-recovery/tasks/TASK-006-matrix/goals.yaml`
  - `status`: `active` → `completed`；合同内容与 `contract_revision: 8` 不变，因为需求语义未变化。
  - 仅更新时间字段。
- `.memory-bank/workstreams/WS-001-prompt-i18n-recovery/keystones/KS-06-matrix/goals.yaml`
  - `status`: `active` → `closed`。
  - `revision`: `6` → `7`，记录阶段状态事实变化。
- `.memory-bank/workstreams/WS-001-prompt-i18n-recovery/keystones/KS-06-matrix/gate.yaml`
  - `status`: `open` → `closed`。
  - `revision`: `6` → `7`。
  - 新增关闭事实，引用 TASK-006、`RC-012`、`REVIEW-012 pass`、`EVT-006-000025` 与 `EVD-006-021`。
- `.memory-bank/workstreams/WS-001-prompt-i18n-recovery/manifest.yaml`
  - `status`: `rework` → `completed`。
  - `revision`: `12` → `13`；`state_revision`: `24` → `25`。
  - 保留 `final_closure_task_id` 与 superseded Task/Keystone 清单。
  - 将 `reconcile_reason` 改为最终 closure 摘要或新增明确 closure 字段，避免继续把已解决重开原因呈现为当前状态。
- `.memory-bank/workstreams/WS-001-prompt-i18n-recovery/verification/traceability.yaml`
  - `revision`: `18` → `19`。
  - `AC-009`、`AC-010`、`AC-011`: `review_pending` → `completed`。
  - 证据追加 `EVD-006-021`；审查依据记录 `RC-012` / `REVIEW-012 pass`；blockers 保持空。
- `.memory-bank/workstreams/WS-001-prompt-i18n-recovery/verification/regression.yaml`
  - `revision`: `16` → `17`。
  - `review_context.result`: `pending` → `pass`；`review: REVIEW-012`；`context: RC-012`；删除 pending blocker。
  - 记录 `F-010-001: closed`、定向 `321/321 pass` 与未使用禁止测试模式。
- `.memory-bank/workstreams/WS-001-prompt-i18n-recovery/verification/full-suite.yaml`
  - `revision`: `16` → `17`。
  - `status`: `review_pending` → `completed`。
  - `checks.review_context`: `review012_pass`。
  - `blockers`: `[]`。
  - evidence 追加 `EVD-006-021`，summary 改为最终完成结论。

[Files]
本次只创建一个 WS-001 closure event，并修改九个既有 Memory 状态文件与两个最终叙述文件；不修改生产代码、测试、依赖或共享 WS-007 导航。

- 新建文件：
  - `.memory-bank/workstreams/WS-001-prompt-i18n-recovery/tasks/TASK-006-matrix/events/EVT-006-000025-review012-pass-and-closure.yaml`
    - 记录 My lord 的“审查完成”通知、单次回收 `REVIEW-012`、合法 baseline、`pass` conclusion、`F-010-001 closed`、无 required findings、TASK/Keystone/Workstream closure 和 Git 未提交事实。
- 修改文件：
  - `.memory-bank/workstreams/WS-001-prompt-i18n-recovery/tasks/TASK-006-matrix/progress.yaml`：最终 Review disposition、finding closure、completed 状态和下一 Git 动作。
  - `.memory-bank/workstreams/WS-001-prompt-i18n-recovery/tasks/TASK-006-matrix/goals.yaml`：Task 状态改为 completed。
  - `.memory-bank/workstreams/WS-001-prompt-i18n-recovery/tasks/TASK-006-matrix/handoff.md`：`content_revision: 6` → `7`，重写为最终 closure handoff，保留最终 resolver/cache 合同、验证、REVIEW-012 pass、未提交状态与 WS-007 排除边界。
  - `.memory-bank/workstreams/WS-001-prompt-i18n-recovery/keystones/KS-06-matrix/goals.yaml`：Keystone closed。
  - `.memory-bank/workstreams/WS-001-prompt-i18n-recovery/keystones/KS-06-matrix/gate.yaml`：exit criteria 已满足并关闭 gate。
  - `.memory-bank/workstreams/WS-001-prompt-i18n-recovery/keystones/KS-06-matrix/progress.md`：`content_revision: 17` → `18`，`review_lifecycle_revision: 11` → `12`，状态改为 closed，追加 REVIEW-010/011/012 生命周期与最终 closure 历史。
  - `.memory-bank/workstreams/WS-001-prompt-i18n-recovery/manifest.yaml`：Workstream completed，但不归档。
  - `.memory-bank/workstreams/WS-001-prompt-i18n-recovery/progress.md`：`content_revision: 23` → `24`，`review_lifecycle_revision: 14` → `15`，状态改为 completed，说明无 downstream Task/Keystone，当前只等待可选 Git 集成授权。
  - `.memory-bank/workstreams/WS-001-prompt-i18n-recovery/verification/traceability.yaml`：AC-009/010/011 completed。
  - `.memory-bank/workstreams/WS-001-prompt-i18n-recovery/verification/regression.yaml`：Review gate pass 与 finding closed。
  - `.memory-bank/workstreams/WS-001-prompt-i18n-recovery/verification/full-suite.yaml`：最终 completed，blockers 清空。
- 不修改文件：
  - `src/**`：实现与测试已经通过 REVIEW-012，本次 closure 不触碰代码。
  - `.memory-bank/active.yaml`、`.memory-bank/status.yaml`、`.memory-bank/indexes/**`、`.memory-bank/project/**`：这些共享投影或 Project 文件同时涉及 WS-007，本次不读取、不修改、不重建。
  - `.memory-bank/workstreams/WS-007-task-runtime-rearchitecture/**`：严格排除。
- 删除或移动：无。
- 配置更新：无。

[Functions]
不新增、修改或移除生产函数；实施只更新结构化 Memory 与 Markdown 状态。

- 新函数：无。
- 修改函数：无。
- 删除函数：无。
- 必须保留且不再改动的已实现函数：
  - `resolvePromptProfile(input: ResolvePromptProfileInput): PromptProfile`，`src/shared/resolve-prompt-profile.ts`。
  - `requirePromptProfile(profile: PromptProfile): PromptProfile`，`src/core/prompts/profiles/types.ts`。
  - `getDeepPlanningPrompt(promptProfile: PromptProfile, focusChainSettings?, providerInfo?, enableNativeToolCalls?): string`，`src/core/prompts/commands/deep-planning/index.ts`。
  - `parseSlashCommands(...)`，`src/core/slash-commands/index.ts`。
  - `Task.buildPromptContext(): Promise<SystemPromptContext>`，`src/core/task/index.ts`。
  - Subagent system-prompt 构造路径，`src/core/task/tools/subagent/SubagentRunner.ts`。

[Classes]
不新增、修改或移除任何类。

- 新类：无。
- 修改类：无。
- 删除类：无。
- `SystemPromptCacheService`、`Task` 与 `SubagentRunner` 的当前实现保持原样；Memory closure 不改变其接口或行为。

[Dependencies]
不新增、删除或升级任何依赖。

- `package.json`、`package-lock.json`、`webview-ui/package.json` 和 lockfile 均不修改。
- 继续使用现有 TypeScript、Vitest UI wrapper、Biome 与 esbuild 工具链；本 closure 默认不重跑这些工具，因为已有 `EVD-006-020`、`EVD-006-021` 与 `REVIEW-012` 证据。

[Testing]
采用 Memory 结构一致性与只读 Git 现场核验，不重复执行已完成的产品测试。

- 不新增测试文件，不修改现有测试。
- Memory 校验：
  - 复读所有被修改的 WS-001 文件，确认 revision 单调递增、状态链一致：TASK-006 `completed` → KS-06 `closed` → WS-001 `completed`。
  - 确认 `REVIEW-012`、`RC-012`、`EVD-006-021`、`EVT-006-000025` 引用一致。
  - 确认 `F-010-001` 仅记录为 `closed`，没有伪造新的 finding 或 review。
  - 确认 AC-001～AC-011 全部 `completed`，full-suite blockers 为空。
  - 确认 handoff 明确本轮未提交、未 push、未管理 WS-007。
- Git 只读校验：
  - `git --no-pager rev-parse HEAD` 仍为 `8bd3a15d6786929096ceea9ae9026c7dcdddcc66`。
  - `git --no-pager status --short` 仍显示原 15 个 tracked modified 与 2 个 untracked added，不应因 Memory closure 改变 tracked 源码集合。
  - `git --no-pager diff --check` 必须 exit 0。
- 已有验证作为完成证据，不默认重跑：
  - Vitest UI：目标文件定向执行，最终 `321/321 pass`、idle。
  - `npx tsc --noEmit`：exit 0。
  - scoped Biome：pass。
  - `node esbuild.mjs`：exit 0。
  - `git diff --check`：exit 0。
  - `REVIEW-012`：`pass`，`F-010-001 closed`。
- 如果任何 Memory 编辑意外修改 `src/**`，立即停止并报告，不以重跑测试掩盖越界修改。

[Implementation Order]
先落盘独立 Review disposition，再自下而上关闭 Task、Keystone、Workstream，最后执行只读一致性核验并等待 Git 授权。

1. 以当前 HEAD、`REVIEW-012` 与现有 15 modified/2 untracked 工作树为 baseline，确认不读取或修改 WS-007 Memory。
2. 新建 `EVT-006-000025-review012-pass-and-closure.yaml`，记录 REVIEW-012 pass、F-010-001 closed 与 closure 决定。
3. 更新 TASK-006 `progress.yaml`、`goals.yaml` 与 `handoff.md`：写 disposition，清 blocker，状态 completed，保留未提交 Git 后续动作。
4. 更新 KS-06 `goals.yaml`、`gate.yaml` 与 `progress.md`：确认 exit criteria、关闭 gate、记录 REVIEW-010 → REVIEW-011 → REVIEW-012 生命周期。
5. 更新 verification 的 `traceability.yaml`、`regression.yaml` 与 `full-suite.yaml`：AC-009/010/011 completed、review012 pass、F-010-001 closed、blockers 清空。
6. 更新 WS-001 `manifest.yaml` 与 `progress.md`：状态 completed、不归档、无 downstream Task/Keystone，并保留 shared projection/WS-007 排除说明。
7. 复读全部修改文件，检查 revision、引用、状态与中文正文一致；若发现不一致，仅在 WS-001 closure 边界内修正。
8. 执行只读 `git rev-parse HEAD`、`git status --short` 与 `git diff --check`，确认代码工作树未被 closure 改写且 diff 检查通过。
9. 向 My lord 报告 WS-001 已完成但代码仍未提交；等待对 `git add` / `git commit` 的单独明确授权，不自动 amend/reset/push。
