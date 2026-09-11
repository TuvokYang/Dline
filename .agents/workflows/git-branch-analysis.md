---
name: git-branch-analysis
description: Analyze a branch against an explicitly discovered integration base and report commits, behavior, architecture impact, workspace drift, and verification gaps.
---

# Git Branch Analysis

Analyze a branch against its real integration base without assuming a repository, remote alias, or branch.

Follow `repository-and-release` first.

## 1. Resolve the comparison base

Collect read-only state:

```text
git branch --show-current
git status --short
git remote -v
git branch -vv
git rev-parse HEAD
```

Resolve `<base-ref>` in this order:

1. an explicit ref in the user's request;
2. the base ref from an associated PR/MR;
3. a confirmed upstream/merge base for the current branch;
4. a user decision when the evidence is ambiguous.

Never fall back to `HEAD`, `main`, `master`, or a conventional remote alias merely because discovery failed.

## 2. Gather bounded Git evidence

Run separate, reviewable commands rather than a shell-specific compound script:

```text
git --no-pager log <base-ref>..HEAD --oneline --decorate
git --no-pager diff --stat <base-ref>...HEAD
git --no-pager diff --name-status <base-ref>...HEAD
git --no-pager diff <base-ref>...HEAD
```

If the full diff is large, inspect it by file or bounded range. Do not create a repository-local temporary file. Use the task's normal output/artifact mechanism when output must be persisted.

## 3. Inspect affected architecture

Use repository file tools to read:

- changed implementation and tests;
- public contracts and consumers;
- state, protocol, storage, or release paths affected by the diff;
- current workspace changes that are not part of the branch commits.

Continue until the user question and likely blast radius are supported by evidence. Do not use arbitrary context-window percentages as a substitute for scope judgment.

## 4. Report

Summarize:

- branch, HEAD, and resolved base with discovery evidence;
- commit and file scope;
- behavior added, changed, fixed, or removed;
- compatibility, migration, security, release, and test impact;
- unrelated or unknown workspace changes;
- verification already present and verification still required.

Keep analysis read-only unless the user separately requests implementation or a Git write.
