---
name: pr-review
description: Perform an evidence-based, read-only pull request review and require separate authorization before submitting any review event or other external write.
---

# Pull Request Review

Perform an evidence-based review of an explicitly identified pull request. Review is read-only by default.

Follow `repository-and-release` first.

## 1. Resolve repository and PR

Require an explicit `<repository>` and `<pr-number>`, or discover them from trustworthy platform metadata. Do not assume the current directory, a conventional remote alias, or authentication state identifies the target.

Read the PR without changing the working tree:

```text
gh pr view <pr-number> --repo <repository> --json number,title,body,url,state,isDraft,author,baseRefName,headRefName,headRepository,headRepositoryOwner,files,commits,reviews,comments,statusCheckRollup,mergeable,mergeStateStatus

gh pr diff <pr-number> --repo <repository>
```

If the target hosting service is not GitHub, use the corresponding read-only platform API rather than mixing command sets.

## 2. Establish scope and contracts

Identify:

- requested behavior and non-goals;
- base/head repositories and refs;
- changed files and generated files;
- public API, protocol, storage, security, concurrency, release, and compatibility impact;
- applicable project rules and acceptance criteria;
- existing checks and tests.

Read the changed implementation, tests, consumers, and relevant architecture. Do not infer correctness from the PR description or green CI alone.

Checking out a PR modifies Git state and requires separate authorization. Prefer platform diff/content APIs or an already prepared isolated worktree for review.

## 3. Review by failure risk

Prioritize findings that can cause:

1. incorrect behavior or data loss;
2. security or permission failures;
3. protocol, persistence, release, or compatibility breaks;
4. lifecycle, cancellation, concurrency, or resource leaks;
5. missing validation or error handling;
6. regressions not covered by meaningful tests;
7. architecture boundary violations that materially increase risk.

Do not report style preferences as defects when the code follows project conventions. Every finding must cite a path and line/range when available, explain the user or system impact, and state the evidence.

## 4. Assess verification

Determine whether tests would fail if the target behavior were wrong. Check normal, boundary, failure, cancellation, and compatibility paths in proportion to risk.

Use PR check data only as evidence tied to the exact head SHA. If critical checks are missing, skipped, stale, or failing, report that explicitly.

Do not run state-changing commands, install dependencies, or modify files as part of a read-only review unless separately authorized.

## 5. Produce the review report

Order findings by severity. For each finding include:

- severity;
- path and line;
- observed behavior;
- expected contract;
- impact;
- recommended minimal correction.

Then provide:

- open questions or unverifiable assumptions;
- verification assessment;
- concise summary of the change;
- conclusion: `approve`, `comment`, `request_changes`, or `blocked`.

No findings means no fabricated concerns. State the remaining test or environment risks.

## 6. Draft before submitting

Prepare a concise review body for the user. Friendly wording is appropriate, but accuracy and actionable evidence take priority over a fixed conversational style.

Submitting an approval, comment, change request, inline comment, or thread reply is an external write. Show the exact repository, PR, event type, and body, then obtain separate authorization.

When authorized, qualify every command with the resolved repository:

```text
gh pr review <pr-number> --repo <repository> --approve --body <message>
gh pr review <pr-number> --repo <repository> --comment --body <message>
gh pr review <pr-number> --repo <repository> --request-changes --body <message>
```

For multiline bodies, use a shell-appropriate standard-input mechanism or an approved temporary location outside the repository. Do not introduce repository-local temporary files.

## 7. Keep merge separate

Review authorization never authorizes merge. Do not run a merge command from this workflow. If the user later requests merge, re-read the PR head SHA, checks, approvals, base branch, and repository contract before requesting merge authorization.

## 8. Final report

Report the reviewed repository/PR/head SHA, findings, verification evidence, drafted or submitted review event, and any action that remains unauthorized or blocked.
