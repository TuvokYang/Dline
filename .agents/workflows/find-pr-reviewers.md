---
name: find-pr-reviewers
description: Rank eligible pull request reviewers from actual PR metadata, domain ownership, file history, and recent architecture work without assuming a repository or remote.
---

# Find Pull Request Reviewers

Recommend reviewers from real repository and PR evidence without assuming a remote alias, repository owner, or default branch.

Follow `repository-and-release` first.

## 1. Resolve the change set

Prefer an explicit `<repository>` and `<pr-number>`. Otherwise, resolve the PR from the current independent branch and verify that the branch is neither `dev` nor `main`.

Read PR metadata including base/head repositories, base/head refs, author, changed files, commits, and requested reviewers. Use the actual PR base for comparisons.

If no PR exists, determine an explicit comparison base from the user's instruction or the branch upstream. If the base cannot be established, stop and ask instead of falling back to `HEAD` or `main`.

## 2. Identify the domain

Read the diff and related code to determine the conceptual areas affected, such as task runtime, prompt tooling, storage, host bridges, providers, Webview state, or release automation.

Use project search tools to find related files. Do not rely on POSIX-only `find`, `xargs`, or pipeline recipes in a cross-platform workflow.

## 3. Gather ownership evidence

For changed and closely related files, inspect:

- commit authorship and recency;
- direct file history;
- line-level blame where it is meaningful;
- authors of the relevant architecture or tests;
- current PR author and already requested reviewers.

Use the PR's base ref or merge base for blame and comparisons. Exclude the PR author, current authenticated user, bots, and accounts that cannot be requested when platform data exposes eligibility.

Commit count alone is not expertise. Weight evidence in this order:

1. ownership of the affected domain or contract;
2. recent work on related architecture and tests;
3. direct history on changed files;
4. line-level ownership;
5. raw commit count.

## 4. Report candidates

Return up to five candidates with:

- login/name;
- domain evidence;
- relevant files or commits;
- recency;
- confidence and limitations;
- whether request eligibility was confirmed.

Do not request reviewers automatically. Adding reviewers is an external write and requires separate authorization after the candidate list and target repository are shown.
