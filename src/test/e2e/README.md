# E2E Tests

This directory contains the end-to-end tests for the Cline VS Code extension using Playwright. These tests simulate user interactions with the extension in a real VS Code environment.

## Test Structure

The E2E test suite consists of several key components:

### Test Files

- **`api-runtime-observability.test.ts`** - Runs each mock provider through multi-turn API, chat composer, and editor integration coverage
- **`settings-api-profiles.test.ts`** - Covers provider/profile configuration and persistence through the Webview
- **`task-*.test.ts`** - Covers task tools, lifecycle, checkpoint history, and prompt refresh behavior

### Test Infrastructure

- **`utils/helpers.ts`** - Core test utilities and fixtures including:
  - `e2e` - Main test fixture for single-root workspace tests
  - `E2E_WORKSPACE_TYPES` - Workspace variants for tests that cover both single-root and multi-root workspaces
  - `E2ETestHelper` - Helper class with utilities for VS Code interaction
- **`utils/common.ts`** - Common utility functions for UI interactions
- **`utils/global.setup.ts`** - Global test setup and cleanup
- **`utils/build.mjs`** - Build script for test environment preparation

### Test Fixtures

- **`fixtures/workspace/`** - Single-root workspace test files (HTML, TypeScript, etc.)
- **`fixtures/workspace_2/`** - Additional workspace with Python provider files
- **`fixtures/multiroots.code-workspace`** - Multi-root workspace configuration
- **`fixtures/server/`** - Mock API server for testing Cline's backend interactions

## Running Tests

### Basic Test Execution

To build the test environment and run all E2E tests:

```bash
npm run test:e2e
```

To run all E2E tests without re-building the test environment (e.g. only test files were updated):

```bash
npm run e2e
```

### Debug Mode

To run E2E tests in debug mode with Playwright's interactive debugger:

```bash
npm run test:e2e -- --debug
# Or only run the tests without re-building
npm run e2e -- --debug
```

In debug mode, Playwright will:
- Open a browser window showing the VS Code instance
- Pause execution at the beginning of each test
- Allow you to step through test actions
- Provide a console for inspecting elements and state

### Additional Options

Run specific test files:
```bash
npm run e2e -- api-runtime-observability.test.ts
```

Run tests with specific tags or patterns:
```bash
npm run e2e -- --grep "Chat"
```

Run tests in headed mode (visible browser):
```bash
npm run e2e -- --headed
```

## Writing Tests

### Basic Test Structure

Use the `e2e` fixture for single-root workspace tests:

```typescript
import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

e2e("Test description", async ({ sidebar, helper, page }) => {
  // Sign in to Cline
  await helper.signin(sidebar)
  
  // Test interactions
  const inputbox = sidebar.getByTestId("chat-input")
  await inputbox.fill("Hello, Cline!")
  await sidebar.getByTestId("send-button").click()
  
  // Assertions
  await expect(sidebar.getByText("API Request...")).toBeVisible()
})
```

For tests that must cover both workspace layouts, iterate over `E2E_WORKSPACE_TYPES`:

```typescript
import { E2E_WORKSPACE_TYPES, e2e } from "./utils/helpers"

E2E_WORKSPACE_TYPES.forEach(({ title, workspaceType }) => {
  e2e.extend({ workspaceType })(title, async ({ sidebar, helper }) => {
    // Test implementation
  })
})
```

### Available Fixtures

The test fixtures provide the following objects:

- **`sidebar`** - Playwright Frame object for the Cline extension's sidebar
- **`helper`** - E2ETestHelper instance with utility methods
- **`page`** - Playwright Page object for the main VS Code window
- **`app`** - ElectronApplication instance for VS Code
- **`server`** - Mock API server for backend testing

### Common Patterns

#### Authentication
```typescript
// Sign in with test API key
await helper.signin(sidebar)
```

#### Chat Interactions
```typescript
const inputbox = sidebar.getByTestId("chat-input")
await inputbox.fill("Your message")
await sidebar.getByTestId("send-button").click()
```

#### Mode Switching
```typescript
const actButton = sidebar.getByRole("switch", { name: "Act" })
const planButton = sidebar.getByRole("switch", { name: "Plan" })
await actButton.click() // Switch to Plan mode
```

#### File Operations
```typescript
// Open file explorer and select code
await openTab(page, "Explorer ")
await page.getByRole("treeitem", { name: "index.html" }).locator("a").click()
await addSelectedCodeToClineWebview(page)
```

#### Settings Navigation
```typescript
await sidebar.getByText("settings").click()
await sidebar.getByTestId("tab-api-config").click()
```

### Using the Recorder with Debug Mode

The `--debug` flag enables Playwright's interactive debugging features:

1. **Start debugging session:**
   ```bash
   npm run test:e2e -- --debug
   ```

2. **Playwright will open:**
   - A VS Code window with Cline extension loaded
   - Playwright Inspector for step-by-step debugging
   - Browser developer tools for element inspection

3. **Recording interactions:**
   - Use the "Record" button in Playwright Inspector
   - Interact with the VS Code interface
   - Playwright generates test code automatically
   - Copy the generated code into your test files

4. **Debugging existing tests:**
   - Set breakpoints in your test code
   - Use the "Step over" button to execute line by line
   - Inspect element selectors and page state
   - Modify selectors and retry actions

### Test Environment

The test environment includes:

- **VS Code Configuration:**
  - Disabled updates, workspace trust, and welcome screens
  - Extension development mode with Cline loaded
  - Temporary user data and extensions directories

- **Mock API Server:**
  - Binds to an available loopback port for each test
  - Provides mock responses for Cline API calls
  - Supports authentication, chat completions, and user management

- **Test Workspaces:**
  - Single-root workspace with HTML, TypeScript, and README files
  - Multi-root workspace with Python provider examples
  - Configurable through fixtures

### Best Practices

1. **Use semantic selectors:**
   ```typescript
   // Good - uses test IDs
   sidebar.getByTestId("chat-input")
   
   // Good - uses roles and accessible names
   sidebar.getByRole("button", { name: "Send" })
   
   // Avoid - brittle CSS selectors
   sidebar.locator(".chat-input-class")
   ```

2. **Wait for elements:**
   ```typescript
   await expect(sidebar.getByText("Loading...")).toBeVisible()
   await expect(sidebar.getByText("Complete")).toBeVisible()
   ```

3. **Clean up state:**
   ```typescript
   // Use helper functions for common cleanup
   await cleanChatView(page)
   ```

4. **Handle async operations:**
   ```typescript
   // Wait for API responses
   await expect(sidebar.getByText("API Request...")).toBeVisible()
   await expect(sidebar.getByText("Response received")).toBeVisible()
   ```

5. **Test both success and error cases:**
   ```typescript
   // Test successful flow
   await helper.signin(sidebar)
   
   // Test error handling
   await expect(sidebar.getByText("API Request Failed")).toBeVisible()
   ```

### Debugging Tips

- Use `page.pause()` to pause execution and inspect the current state
- Add `console.log()` statements to track test progress
- Use `--headed` flag to see the browser window during test execution
- Check video recordings in `test-results/` for failed tests
- Use browser developer tools to inspect element selectors

### Environment Variables

- `CLINE_E2E_TESTS_VERBOSE=true` - Enable verbose logging
- `CI=true` - Adjusts timeouts and reporting for CI environments
- `GRPC_RECORDER_ENABLED=true` - Enable gRPC recording for debugging
- `DLINE_E2E_PROFILE` - Select `auto`, `mock-openai`, `deepseek`, or `openai-compatible`
- `DLINE_E2E_WORKERS` - Override the default of 2 parallel Playwright workers
- `DLINE_E2E_CDP_PORT` - Set the first CDP port; each worker adds its worker index

Each Playwright worker prepares one reusable state template. Mock tests use only generated mock profiles and never read
`~/.dline/data` or live credential environment variables. `provider-live.test.ts` explicitly enables live preprocessing;
only that mode may copy `secrets/**` and `settings/api_profiles.json`. It never copies `secrets.json`, user settings,
provider registry files, task history, or other user state. Before each test, the selected template is copied to that
worker's `%TEMP%/.dline-e2e/worker-N` `DLINE_DIR`; `DLINE_HOME_DIR` uses the same path and `DLINE_DOCS_DIR` uses
`%TEMP%/dline-e2e/worker-N`. All three worker-owned temporary locations are reset between tests and removed during
worker teardown.

Generated live profiles use `high` reasoning effort. GitHub Actions creates only profiles whose corresponding credential
is configured:

- DeepSeek secret: `DLINE_E2E_DEEPSEEK_API_KEY`; optional vars: `DLINE_E2E_DEEPSEEK_BASE_URL`, `DLINE_E2E_DEEPSEEK_MODEL_ID`
- OpenAI-compatible secret: `DLINE_E2E_OPENAI_COMPATIBLE_API_KEY`; optional vars: `DLINE_E2E_OPENAI_COMPATIBLE_BASE_URL`, `DLINE_E2E_OPENAI_COMPATIBLE_MODEL_ID`

Pull requests and the regular three-platform smoke job use the local mock OpenAI-compatible profile. Live provider tests
run only on trusted push or manual workflow events and are skipped when their credential is absent.

## Required Coverage Matrix

Only tests that launch VS Code and operate the Dline Webview count as product E2E. Preprocessing tests validate the
isolated harness but do not count as product E2E coverage.

### Isolated State And Profiles

- [x] Use worker-owned subdirectories beneath `%TEMP%/.dline-e2e` for `DLINE_DIR` and `DLINE_HOME_DIR`, and beneath
  `%TEMP%/dline-e2e` for `DLINE_DOCS_DIR`.
- [x] Copy only `settings/api_profiles.json` and `secrets/**`; never copy root `secrets.json` or task/user state.
- [x] Remove the isolated state after each worker and test.
- [x] Seed mock, DeepSeek, and OpenAI-compatible profiles with `high` effort when credentials are available.
- [x] Launch VS Code with the isolated state and show the prepared profiles in Settings.

### Settings And Provider Profiles

- [x] Rename a profile through the Webview, verify `api_profiles.json`, reopen VS Code, and verify the renamed profile.
- [x] Modify `providers/deepseek.json` while VS Code is running, observe the new model in the provider selector, select it,
  and verify the selected model ID in `api_profiles.json`.
- [ ] Select every registered provider through the Webview and verify the provider/profile write.
- [ ] Persist each provider's API key through the Webview into `secrets/api_keys.json`, without embedding it in
  `api_profiles.json`.
- [ ] Persist structured Bedrock and SAP credentials into `secrets/provider_secrets.json` and verify them after reopen.
- [ ] Cover OpenAI-compatible custom base URL, model ID, API endpoint, service tier, thinking, prompt cache, context,
  output limit, pricing, custom headers, Azure options, and streaming usage settings.
- [ ] Verify each edited Settings value immediately, on disk, and after reopening VS Code.

### Task And Model Synchronization

- [x] Send a chat message through the Webview and assert the mock API response is rendered.
- [ ] Apply profile context/pricing changes to the active Task immediately.
- [ ] Rename the active Task profile and verify the Task model display follows the stable profile ID.
- [ ] Switch a Task-local profile and verify both the displayed profile and context limit change together.
- [x] Run an optional live minimal turn for a configured DeepSeek or OpenAI-compatible profile.

### Tools, Approval, And Continuation

- [x] Exercise `read_file` with auto-approve and with explicit Approve/Reject interaction.
- [x] Exercise `write_to_file` and `replace_in_file` through real tool calls and verify workspace files.
- [x] Exercise `execute_command` through real approval, verify command output, and verify completion state.
- [x] Cancel a running Task from the Webview and verify the Task can resume from the visible Resume interaction.
- [x] Verify approval, retry, cancel, and resume buttons perform their named action instead of only changing UI state.
