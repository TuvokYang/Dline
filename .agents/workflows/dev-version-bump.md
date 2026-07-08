# Dev Version Bump

Update the development version, curate changelog entries, and create branch-specific local release tags.

## Overview

This workflow helps you:
1. Confirm the source range since the previous version
2. Decide whether the new release has Features, Changed, and Fixed entries
3. Update `CHANGELOG.md` and `docs/changelog/CHANGELOG_en.md`
4. Update `package.json` to the target version
5. Validate, commit, and create branch-specific local tags

## Process

### 1) Confirm current branch and version

```bash
git status --short
git --no-pager log --oneline --decorate -20
cat package.json | grep '"version"'
```

Confirm the target version with the maintainer, for example `0.9.1`.

### 2) Compare changes since the previous version

Use the previous version commit or tag as the base:

```bash
git --no-pager log --oneline <previous-version-ref>..HEAD
git --no-pager diff --stat <previous-version-ref>..HEAD
```

Classify user-visible changes:
- `Features`: only include real new features. If there are no new features, do not write this section.
- `Changed`: behavior, architecture, configuration, workflow, or performance changes.
- `Fixed`: bug fixes, stability fixes, and recovery/state-correction fixes.

### 3) Update changelog files

Add the new version entry at the top of both changelog files:
- `CHANGELOG.md`
- `docs/changelog/CHANGELOG_en.md`

Follow the existing format:

```markdown
## [X.Y.Z]

### Features
- New feature description

### Changed
- Behavior change description

### Fixed
- Bug fix description
```

If the version has no feature additions, omit `### Features` completely instead of adding placeholder text.

### 4) Update package version

Update `package.json`:

```json
"version": "X.Y.Z"
```

Only update lockfiles when the project convention or package manager output requires it. Do not change unrelated dependency versions.

### 5) Validate changes

Run the project checks before committing:

```bash
npm run lint
npx tsc --noEmit --pretty false
```

Then review the final diff:

```bash
git status --short
git --no-pager diff --stat
git --no-pager diff --cached --stat
```

### 6) Commit version changes

Stage exactly the intended release files and any explicitly approved companion changes:

```bash
git add CHANGELOG.md docs/changelog/CHANGELOG_en.md package.json <approved-extra-files>
git commit -m "Bump dev version to X.Y.Z"
```

Do not include unrelated work unless the maintainer explicitly asks to include it.

### 7) Create local release tags

Create local tags after the release commit exists. Use `dev-` tags on `dev`; use plain `vX.Y.Z` tags on `main`.

```bash
# On dev
git tag dev-<previous-version> <previous-version-ref>
git tag dev-<new-version> HEAD

# On main
git tag v<previous-version> <previous-version-ref>
git tag v<new-version> HEAD
```

Only push tags when the maintainer separately authorizes push.

### 8) Final summary

Present to the user:
- New version and commit hash
- Created local tags and branch-specific tag prefix
- Validation commands and results
- Any remaining uncommitted or unpushed work
