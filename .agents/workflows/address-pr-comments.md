---
name: address-pr-comments
description: Review all feedback on an explicitly resolved pull request, validate each finding, apply only approved changes, and keep commit, push, replies, and merge as separate authorizations.
---

# Address Pull Request Comments

Review PR feedback, determine which findings are valid, and address only the items approved by the user.

Follow `repository-and-release` first.

## 1. Resolve the PR explicitly

Use an explicit `<repository>` and `<pr-number>`, or discover them from the current independent branch. Do not assume the current directory, remote alias, or default branch identifies the PR.

Read at least:

```text
gh pr view <pr-number> --repo <repository> --json number,title,body,url,state,isDraft,author,baseRefName,headRefName,headRepository,headRepositoryOwner,files,commits,reviews,comments,statusCheckRollup
```

Confirm that the local branch/worktree corresponds to the PR head before proposing edits. If the PR comes from a fork, resolve the writable head repository separately from the base repository.

## 2. Build the review context

- Read the PR diff against its actual `baseRefName`.
- Read modified files and relevant consumers, tests, contracts, and data flow.
- Retrieve inline review comments through the repository-qualified API path.
- Separate human findings from CI status, release bots, resolved threads, and duplicate comments.
- Treat reviewer suggestions as input, not as requirements. Validate them against the user request, project contracts, and current code.

## 3. Produce a disposition table

For every actionable thread report:

- comment/thread identifier and author;
- affected path and line when available;
- finding summary;
- evidence-based assessment;
- proposed disposition: `accept`, `reject_with_reason`, `needs_user_decision`, or `already_resolved`;
- expected files and verification if accepted.

Ask for approval before modifying code when the findings change behavior, scope, public contracts, or architecture. Independent low-risk corrections may be grouped only when their write boundaries are clear.

## 4. Apply approved changes

Code edits do not authorize any Git or remote write. After editing:

- run focused verification for each accepted finding;
- run related regression checks for shared contracts;
- re-read the final diff and confirm no unrelated changes were included;
- report rejected findings with reasons rather than silently ignoring them.

## 5. Separate external writes

Obtain separate authorization for each applicable operation:

1. commit;
2. push to the dynamically resolved PR head repository;
3. reply to review threads or post a summary comment;
4. resolve conversations when the platform supports it.

Never push a contributor branch to the base repository by assumption. Never combine "address comments" with merge authorization.

## 6. Final report

Report dispositions, changed files, verification evidence, remaining threads, and the exact Git/remote operations that were or were not performed.
