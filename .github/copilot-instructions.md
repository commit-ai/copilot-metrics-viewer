---
name: copilot-metrics-viewer
description: Nuxt 3 web application for GitHub Copilot usage metrics and analytics
stack: Vue.js, TypeScript, Nuxt 3, Vuetify, Chart.js
instructions_version: 5.0
# Note: this `instructions_version` tracks the instructions document itself.
# The app version lives in `package.json` — do not sync this field with it.
---

# GitHub Copilot Metrics Viewer

GitHub Copilot Metrics Viewer is a Nuxt 3 web application that displays GitHub Copilot usage metrics and analytics for organizations and enterprises. The application visualizes data from the GitHub Copilot Metrics API using Vue.js, TypeScript, Vuetify, and Chart.js.

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

## Security and Boundaries

### Critical Rules
- **NEVER commit secrets or credentials** to the repository (because they can be extracted from git history and abused)
- **NEVER modify `.env` file** - environment variables should only be documented, not changed (to prevent accidental commits of sensitive data)
- **DO NOT modify** the following without explicit approval (to prevent breaking CI/CD, security policies, and production configuration):
  - Production configuration files (azure.yaml, Dockerfile)
  - GitHub workflows in `.github/workflows/`
  - Security policies (SECURITY.md, CODE_OF_CONDUCT.md)
  - License files (LICENSE.txt)
- **ALWAYS validate** that changes don't introduce security vulnerabilities (to catch issues before they reach production)
- **ALWAYS run security scanning** before finalizing changes (to ensure no secrets or weak patterns are committed)

### Safe Modification Areas
- Application source code in `app/`, `server/`, `shared/`
- Tests in `tests/` and `e2e-tests/`
- Documentation files (README.md, CONTRIBUTING.md, DEPLOYMENT.md)
- Configuration files specific to your changes

## Working Effectively

### Initial Setup
- **Node.js requirement**: Uses Node.js 20+ (verified: v20.19.4 works) — pinning the version prevents toolchain drift that breaks builds on other machines
- Install dependencies: `npm install` 
  - **NEVER CANCEL**: Takes 3 minutes to complete. Set timeout to 5+ minutes. (to ensure all transitive dependencies are installed and postinstall scripts run)
  - Includes postinstall script that runs `nuxt prepare` (this generates TypeScript types needed by the editor and build)

### Build and Development
- **Development server**: `npm run dev`
  - Starts on http://localhost:3000/
  - **Font provider warnings are normal** - application works despite "Could not fetch fonts" errors
  - Supports hot reload and auto-refresh
- **Production build**: `npm run build`
  - **NEVER CANCEL**: Takes 30 seconds to complete. Set timeout to 2+ minutes.
  - Builds successfully despite font provider connection warnings
  - Outputs to `.output/` directory
- **Production preview**: Built server requires proper environment setup
  - After build: `NUXT_SESSION_PASSWORD=something_long_and_random_thats_at_least_32_characters node .output/server/index.mjs`
  - **NOTE**: Health endpoints may not work correctly in built mode in some environments
  - **Recommendation**: Use `npm run dev` for development and testing validation scenarios

### Testing
- **Unit tests**: `npm test` (using Vitest)
  - **NEVER CANCEL**: Takes 15 seconds to complete. Set timeout to 2+ minutes. (to ensure all test files are discovered and executed without race conditions)
  - Runs 97 tests, all should pass (if any fail, the code has a regression or is incomplete)
  - Uses mocked data environment (to avoid needing real GitHub tokens during development)
  - Test files are located in `tests/` directory
- **E2E tests**: `npm run test:e2e` (using Playwright)
  - **NOTE**: Playwright browser installation may fail in some environments due to download issues (try `npx playwright install` first if tests fail)
  - Uses mocked data for testing (to keep E2E tests fast and reproducible)
- **Type checking**: `npm run typecheck`
  - **KNOWN ISSUE**: Currently fails with 18 TypeScript errors (these are in existing code; fix only if your change introduces new errors)
  - Takes 10 seconds to complete
  - Errors are in existing codebase, not blocking for development

### Bug Fix Workflow (TDD)
When fixing any bug, **always follow this order**:
1. **Write a failing test first** that reproduces the bug — run `npm test` and confirm the new test fails
2. **Apply the fix** to the production code
3. **Run `npm test` again** and confirm the previously failing test now passes and no other tests regressed
4. Commit both the fix and the test together (or test first in a separate commit)

This ensures every bug has a regression guard before the fix lands.

### Code Quality
- **Linting**: `npm run lint`
  - **KNOWN ISSUE**: Currently fails with 43 ESLint errors (mostly @typescript-eslint/no-explicit-any)
  - Takes 3 seconds to complete
  - `npm run lint:fix` can fix some formatting issues but not the core errors
  - **Always run linting** but expect failures in current codebase

## Environment Configuration

### Required Environment Variables
- **NUXT_SESSION_PASSWORD**: Required, minimum 32 characters
  - Used for session encryption
  - Example: `NUXT_SESSION_PASSWORD=something_long_and_random_thats_at_least_32_characters`

### GitHub Integration
- **Mock mode (default)**: `NUXT_PUBLIC_IS_DATA_MOCKED=true`
  - Works without GitHub tokens
  - Uses sample data for development and testing
- **Real GitHub data**: Requires GitHub Personal Access Token
  - `NUXT_GITHUB_TOKEN=<your_token>`
  - Token needs permissions: Read access to members, organization copilot metrics, and organization copilot seat management

### Scope Configuration
- **NUXT_PUBLIC_SCOPE**: Sets default scope ('organization', 'enterprise', 'team-organization', 'team-enterprise')
- **NUXT_PUBLIC_GITHUB_ORG**: Target organization name
- **NUXT_PUBLIC_GITHUB_ENT**: Target enterprise name
- **NUXT_PUBLIC_GITHUB_TEAM**: Target team name (optional)

### OAuth Configuration (Optional)
- **NUXT_PUBLIC_USING_GITHUB_AUTH**: Enable GitHub OAuth (default: false)
- **NUXT_OAUTH_GITHUB_CLIENT_ID**: GitHub App client ID
- **NUXT_OAUTH_GITHUB_CLIENT_SECRET**: GitHub App client secret

## Validation

### Manual Testing Scenarios
Always test these scenarios after making changes (use development mode for reliable validation):

1. **Health Check Endpoints** (use dev server: `npm run dev`):
   - Test: `curl http://localhost:3000/api/health`
   - Expected: JSON response with status, timestamp, version, uptime
   - Test: `curl http://localhost:3000/api/ready`
   - Expected: JSON response with status, checks object
   - Test: `curl http://localhost:3000/api/live`
   - Expected: JSON response with status, memory usage, process info

2. **Mock Data Functionality**:
   - Start dev server: `npm run dev`
   - Navigate to: http://localhost:3000/orgs/mocked-org?mock=true
   - Verify: Page loads showing metrics dashboard with charts
   - Test language breakdown, seat analysis, and chat metrics tabs

3. **Different Scope URLs**:
   - Organizations: `http://localhost:3000/orgs/octodemo`
   - Enterprises: `http://localhost:3000/enterprises/octo-demo-ent`
   - Teams: `http://localhost:3000/orgs/octodemo/teams/the-a-team`

### Docker Support
- **Build**: `docker build -t copilot-metrics-viewer .`
  - **NOTE**: May fail in environments with certificate/proxy issues
  - Uses multi-stage build with Node.js Alpine images
- **Playwright mode**: `docker build -t copilot-metrics-pw --build-arg mode=playwright .`
- **Run**: See DEPLOYMENT.md for full Docker configuration examples

### Always Run Before Committing
1. **Build verification**: `npm run build` - Must complete successfully
2. **Unit tests**: `npm test` - All 97 tests must pass
3. **Basic functionality**: Start dev server and verify health endpoints respond
4. **Linting awareness**: Run `npm run lint` (expect existing errors, don't introduce new ones)
5. **Security check**: Ensure no secrets or credentials are committed
6. **Version bump**: If this PR is intended as a release, ensure `package.json` version is updated (see Release Process below)

## Release Process

### Version Bump Rule (CRITICAL for code review)
The CI release workflow **hard-fails** if the git tag does not match `package.json` version.

**During code review, flag a missing version bump if the PR:**
- Is labelled as a release or contains a changelog/release-notes update
- Bumps the git tag (e.g. `v1.0.0`) without a matching change to `"version"` in `package.json`

> The version numbers below are illustrative examples only. The real current
> version lives in `package.json` — always read it from there.

**The correct release workflow:**
1. In a commit on `main`, bump `package.json` **and** `package-lock.json` together — always use
   `npm version` (never edit `package.json` manually) so both files stay in sync:
   ```bash
   # Patch bump (e.g. 1.0.0 → 1.0.1):
   npm version patch --no-git-tag-version

   # Or set an explicit version:
   npm version 1.0.0 --no-git-tag-version

   git add package.json package-lock.json
   git commit -m "chore: bump version to 1.0.0"
   git push origin main
   ```
2. Push the matching release tag:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
3. The CI pipeline checks `tag == package.json version` and fails with a clear error if they differ.

**Version format:** `MAJOR.MINOR.PATCH` (semver, no `v` prefix in `package.json`).

## Common Tasks

### Code Style and Conventions
- **TypeScript**: Always use TypeScript for new code, with proper type annotations
- **Vue Components**: Follow Vue 3 Composition API patterns
- **File Naming**: 
  - Components: PascalCase (e.g., `MetricsViewer.vue`)
  - Utilities: camelCase (e.g., `dateUtils.ts`)
  - Tests: Match source file with `.spec.ts` or `.nuxt.spec.ts` suffix
- **Code Organization**:
  - Keep components focused and single-purpose
  - Extract reusable logic into composables or utilities
  - Use TypeScript interfaces for data models in `app/model/`
- **Comments**: Mark deliberate shortcuts with `// ponytail:` comments to track technical debt (e.g., `// ponytail: global lock, per-account locks if throughput matters`)
- **Error Handling**: Always handle errors gracefully with user-friendly messages

### Repo Structure
```
├── app/                 # Vue.js application source
│   ├── components/      # Vue components (MetricsViewer, SeatsAnalysisViewer, etc.)
│   ├── pages/          # Nuxt pages (index.vue)
│   ├── model/          # TypeScript data models
│   └── utils/          # Utility functions
├── server/             # Nuxt server-side code
│   ├── api/            # API endpoints (health.ts, metrics.ts, seats.ts)
│   ├── routes/         # Server routes (auth)
│   └── plugins/        # Server plugins (http-agent.ts)
├── tests/              # Unit tests (Vitest)
├── e2e-tests/          # End-to-end tests (Playwright)
├── .env                # Environment configuration
├── nuxt.config.ts      # Nuxt configuration
├── package.json        # Dependencies and scripts
└── Dockerfile          # Container configuration
```

### Key Files to Monitor
- **Health endpoints**: `/server/api/health.ts`, `/server/api/ready.ts`, `/server/api/live.ts`
- **Main metrics logic**: `/server/api/metrics.ts`, `/server/api/seats.ts`
- **Frontend components**: `/app/components/MetricsViewer.vue`, `/app/components/MainComponent.vue`
- **Configuration**: `/nuxt.config.ts`, `/.env`

### Debugging Tips
- **Font provider warnings**: Normal in restricted network environments, application functions correctly
- **Mock data**: Use `?mock=true` query parameter for testing without GitHub tokens
- **API debugging**: Check browser network tab for API call responses
- **Server logs**: Development server shows detailed request logs and errors

### Performance Notes
- **Development startup**: ~10 seconds with font provider retries
- **Build time**: ~30 seconds
- **Test execution**: ~15 seconds for full unit test suite
- **Hot reload**: Very fast in development mode

## Known Limitations
- **Linting**: 43 existing ESLint errors in codebase (mostly TypeScript any types)
- **Type checking**: 18 existing TypeScript errors 
- **Playwright**: Browser installation may fail in restricted environments
- **Docker**: Build may fail in environments with certificate/proxy restrictions
- **Font providers**: External font API calls fail in restricted networks (non-blocking)

Always validate your changes work in mock mode first, then test with real GitHub data if available.

## Overview

**GitHub Copilot Metrics Viewer** is a Nuxt 3 web application that displays GitHub Copilot usage metrics and analytics for organizations and enterprises. Key capabilities:

- View Copilot seat usage, adoption, and language breakdowns
- Filter by organization, enterprise, or team scope
- Analyze chat and completions metrics over time
- Support both mock data (development) and real GitHub API integration
- Deploy to Azure Container Instances or Kubernetes with OAuth support

The app is designed for DevOps, platform engineering, and enterprise administrators who need visibility into Copilot adoption and usage patterns.

## Tech Stack

- **Frontend**: Vue.js 3 (Composition API), TypeScript, Vuetify 3, Chart.js
- **Backend**: Nuxt 3 server middleware, Node.js 20+, undici HTTP client
- **Testing**: Vitest (unit tests), Playwright (end-to-end)
- **Styling**: SCSS with Vuetify components
- **Data**: GitHub Copilot Metrics API (REST), PostgreSQL (optional persistence)
- **Deployment**: Docker, Azure Container Instances, Kubernetes, nginx
- **Auth**: GitHub OAuth via nuxt-auth-utils, Microsoft MSAL (optional)

## Resources

- **GitHub Copilot Metrics API**: https://docs.github.com/en/rest/copilot/copilot-metrics
- **Nuxt 3 Documentation**: https://nuxt.com/docs/
- **Vue 3 Composition API**: https://vuejs.org/guide/extras/composition-api-faq.html
- **Vuetify Components**: https://vuetifyjs.com/
- **Chart.js**: https://www.chartjs.org/docs/latest/
- **Vitest**: https://vitest.dev/
- **Contributing**: See [CONTRIBUTING.md](../CONTRIBUTING.md)
- **Security**: See [SECURITY.md](../SECURITY.md)
- **Deployment**: See [DEPLOYMENT.md](../DEPLOYMENT.md)

## Evidence for Claims

When you claim a fix, feature, or change works — always show evidence from a tool run. Examples:

- **"Tests pass"** → paste the `npm test` output showing "✓ 97 passed"
- **"Build succeeds"** → paste the `npm run build` output showing no errors
- **"Health endpoints respond"** → paste the `curl` output for `/api/health`, `/api/ready`, `/api/live`
- **"Component renders"** → screenshot from `npm run dev` browser session or E2E test output
- **"No new lint errors"** → paste relevant lines from `npm run lint` output

Empty claims ("it works") are unverifiable; pasted output turns claims into facts.