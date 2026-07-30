# E2E Tests

This directory contains the end-to-end tests for the Cline VS Code extension using Playwright. These tests simulate user interactions with the extension in a real VS Code environment.

## Test Structure

The E2E test suite consists of several key components:

### Test Files

- **`auth.test.ts`** - Tests API key setup, provider selection, and navigation to settings
- **`chat.test.ts`** - Tests chat functionality including message sending, mode switching (Plan/Act), slash commands, and @ mentions
- **`editor.test.ts`** - Tests code actions, editor panel integration, and code selection features

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
npm run e2e -- auth.test.ts
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
- `DLINE_E2E_PROFILE` - Select `auto`, `mock-openai`, `deepseek`, `openai-codex`, or `openai-compatible`

Each test uses a temporary `DLINE_DIR`. When `~/.dline/data` exists, preprocessing copies only `secrets.json`,
`secrets/**`, and `settings/api_profiles.json` into that directory. The source settings file is read only to retain the
active profile name. The temporary directory is deleted after the test, so profile edits never write back to the user's
default data directory.

Generated live profiles use `high` reasoning effort. GitHub Actions creates only profiles whose corresponding credential
is configured:

- DeepSeek secret: `DLINE_E2E_DEEPSEEK_API_KEY`; optional vars: `DLINE_E2E_DEEPSEEK_BASE_URL`, `DLINE_E2E_DEEPSEEK_MODEL_ID`
- OpenAI Codex secret: `DLINE_E2E_OPENAI_CODEX_CREDENTIALS_JSON`; optional var: `DLINE_E2E_OPENAI_CODEX_MODEL_ID`
- OpenAI-compatible secret: `DLINE_E2E_OPENAI_COMPATIBLE_API_KEY`; optional vars: `DLINE_E2E_OPENAI_COMPATIBLE_BASE_URL`, `DLINE_E2E_OPENAI_COMPATIBLE_MODEL_ID`

Pull requests and the regular three-platform smoke job use the local mock OpenAI-compatible profile. Live provider tests
run only on trusted push or manual workflow events and are skipped when their credential is absent.
