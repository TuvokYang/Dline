<!--
Thank you for contributing to Dline.

Before opening the PR:
- Use an independent feature, bugfix, docs, refactor, chore, or task branch.
- Target the integration branch `dev`; ordinary PRs must not use `dev` or `main` as the source branch.
- Link the issue or discussion that defines the change when one exists.
- Keep small fixes focused. Larger behavior or architecture changes should have prior agreement on scope and contracts.
-->

### Related Issue or Discussion

<!--
Use `Related: #123` when the PR is associated with an issue but should not close it.
Use `Fixes #123` only when this PR fully resolves that issue and merge should close it automatically.
Cross-repository references should include the repository identity.
-->

Related: N/A

### Description

<!-- Explain the problem, the behavior being changed, the approach, and anything intentionally kept unchanged. -->

### Architecture and Compatibility

<!-- Describe affected modules/contracts, compatibility impact, migration or recovery behavior, and important risks. Write "Not applicable" when appropriate. -->

### Verification

<!-- List the exact checks run and their results. Include focused tests first, then broader type, lint, build, E2E, packaging, or manual checks that match the blast radius. -->

- [ ] Focused tests
- [ ] Type checking
- [ ] Lint/format checks
- [ ] Relevant Webview, E2E, package, or release checks

### Type of Change

- [ ] Bug fix
- [ ] Feature
- [ ] Breaking change
- [ ] Refactor
- [ ] Documentation
- [ ] Test or CI/workflow
- [ ] Maintenance/chore

### Pre-flight Checklist

- [ ] The PR has one primary intent and excludes unrelated changes.
- [ ] The source is an independent branch and the base is `dev`.
- [ ] New or changed behavior has appropriate tests, or the reason tests are not applicable is documented.
- [ ] Generated files and snapshots were updated only through their owning generators.
- [ ] User data, secrets, tokens, and private diagnostics are not exposed.
- [ ] I reviewed the local [contributor guidelines](../CONTRIBUTING.md).

### Screenshots or Recordings

<!-- Required for user-visible UI changes when a visual comparison or workflow recording helps reviewers verify the result. -->

### Additional Notes

<!-- Add rollout, follow-up, unresolved risk, reviewer guidance, or other relevant context. -->
