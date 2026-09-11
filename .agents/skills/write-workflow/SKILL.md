---
name: write-workflow
description: Create or revise Dline workflows as concise ordered procedures with parser-valid metadata, stable capability-name references, explicit safety boundaries, and evidence-based verification; do not use it to author skills.
---

# Write a Workflow

Use this skill to create, replace, or revise a workflow that Dline can discover and load with `load_workflow`.

## Workflow vs. Skill

Choose the artifact before writing:

| Workflow | Skill |
| --- | --- |
| An ordered procedure for completing a recognizable operation | Reusable methods, domain expertise, constraints, and best practices |
| Loaded with `load_workflow` | Loaded with `load_skill` |
| Tells the agent what sequence to execute and where to stop | Teaches the agent how to reason and work in a domain |
| Stored as one Markdown or MDX workflow file | Stored in a named skill directory with `SKILL.md` |
| Should be short, operational, and outcome-oriented | May be broader and include patterns, examples, and diagnostic guidance |

Do not use this skill to create or revise a skill. If the requested content is primarily reusable knowledge rather than an ordered operation, stop and recommend skill authoring instead. Do not create a `SKILL.md` file from this procedure.

## 1. Confirm the Workflow Contract

Before editing, define:

- the operation and observable result;
- when the workflow should be loaded;
- required inputs and how they are discovered;
- preconditions and explicit stop conditions;
- ordered steps and dependencies;
- local and external side effects;
- authorization boundaries;
- verification and final reporting;
- behavior that belongs in an existing rule or skill instead.

A workflow should have one coherent operational goal. Do not combine unrelated procedures merely because they share tools.

## 2. Inspect Existing Capabilities

Search existing workflow names and descriptions before adding a new file. Reuse or revise an existing workflow when its operation and safety contract match.

Load relevant rules or skills by stable capability name. Do not embed their directory path or filename in prose. For example, write `Follow repository-and-release` or `Load use-e2e`, not a path under the capability directory.

Avoid duplicate redirect workflows. When an old workflow has been fully replaced and no compatibility consumer requires its name, remove it instead of advertising a deprecated stub.

## 3. Create Parser-Valid Metadata

Create the workflow as `.agents/workflows/<workflow-name>.md` or `.mdx` with leading YAML frontmatter:

```yaml
---
name: stable-workflow-name
description: One concise sentence explaining when and why to load this workflow.
---
```

Requirements:

- `name` uses lowercase kebab-case and matches the intended stable capability name;
- `description` is non-empty, specific, and operational;
- frontmatter starts at the first byte of the file and has a closing `---` block;
- metadata parses under the same JSON-schema YAML behavior used by Dline;
- the visible title may be human-friendly but must not redefine the stable name.

The runtime can fall back to a filename or empty description, but workflow authors must not rely on those fallbacks.

## 4. Write the Ordered Procedure

Use a small structure such as:

```markdown
# Human-Readable Title

One sentence describing the result.

## Preconditions

## 1. Discover inputs

## 2. Validate state

## 3. Perform the operation

## 4. Verify the result

## 5. Report
```

Each step should state:

- what evidence to read;
- what decision is made from that evidence;
- what action is allowed;
- when to stop;
- what result is passed to the next step.

Use placeholders such as `<repository>`, `<remote>`, `<base-ref>`, and `<target-version>` when values must be discovered. Explain the discovery source; never substitute a maintainer-specific repository, remote alias, URL, personal branch, or machine path.

## 5. Keep Safety and Authorization Explicit

Separate:

- read-only discovery;
- ordinary project-file edits;
- local Git writes;
- remote writes;
- review, merge, deployment, publication, messages, and other external writes.

Do not infer one authorization from another. A workflow may describe an operation that requires authorization, but it must stop before the side effect unless the current user instruction already grants that exact operation and scope.

Commands must be shell-neutral where possible. When shell-specific syntax is necessary, label the shell. Do not use repository-local temporary files, hidden fallback branches, guessed remotes, or destructive cleanup to make the procedure appear successful.

## 6. Reference Capabilities by Name

Cross-capability references must use stable names only:

```text
Follow repository-and-release.
Load create-pull-request when an ordinary PR is requested.
Load use-vitest for full-suite Vitest execution.
```

Do not write capability paths such as `.agents/rules/...`, `.agents/workflows/...`, or `.agents/skills/.../SKILL.md`. Names survive directory and extension changes; paths become stale implementation details.

## 7. Keep Workflow and Product Documentation Separate

A workflow is internal execution guidance, not user documentation or a project architecture specification.

- Put stable engineering contracts in rules.
- Put reusable methods and domain expertise in skills.
- Put user or developer documentation in the project documentation set.
- Put one ordered operational procedure in a workflow.

If the procedure needs extensive conceptual teaching before the steps make sense, move that knowledge to a skill and have the workflow load it by name.

## 8. Validate the Workflow

Before completion:

1. parse frontmatter with the production frontmatter parser;
2. confirm the name and description are present in the capability catalog;
3. confirm the workflow can be loaded by its stable name;
4. scan for stale capability paths, hard-coded repositories/remotes/URLs, obsolete commands, and cross-platform shell assumptions;
5. verify every referenced command and project path against current source;
6. test important stop conditions and unsafe counterexamples when the workflow controls Git, release, migration, deletion, or publication behavior;
7. run formatting and repository static-contract checks;
8. remove a superseded workflow when retaining it would create a duplicate catalog entry.

## Completion Checklist

- [ ] The artifact is truly an ordered workflow, not a skill or rule.
- [ ] Frontmatter has a stable kebab-case `name` and a non-empty `description`.
- [ ] Inputs, preconditions, steps, stop conditions, verification, and reporting are explicit.
- [ ] Side effects and authorization boundaries are separated.
- [ ] Cross-capability references use names, not paths.
- [ ] Commands are current, fork-safe where relevant, and shell-neutral or labeled.
- [ ] No deprecated duplicate workflow remains advertised.
- [ ] Production parser, catalog, load, static-contract, format, and focused behavior checks pass.
