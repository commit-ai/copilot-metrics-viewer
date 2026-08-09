---
name: Nuxt Validation
description: Validate Nuxt.js application changes with build, tests, and health checks before committing
---

# Nuxt Validation

Validates that changes to the Nuxt 3 application do not break the build, tests, or runtime health.

## Workflow

1. Run `npm run build` — if build fails, stop and show error
2. Run `npm test` — confirm all 97 tests pass (Vitest)
3. Start dev server: `npm run dev` — wait for "listening on http://localhost:3000"
4. Test health endpoints:
   - `curl http://localhost:3000/api/health` → expect JSON with status, timestamp, version
   - `curl http://localhost:3000/api/ready` → expect JSON with status and checks
   - `curl http://localhost:3000/api/live` → expect JSON with status and process info
5. Stop dev server (Ctrl+C)
6. Report: "Validation passed" with command outputs as evidence, or show failures

## Use When

- After adding/modifying TypeScript, Vue components, API endpoints, or server routes
- Before committing a fix or feature
- When refactoring shared types or utilities that may affect multiple components

## Known Issues

- ESLint has 43 existing errors (mostly `@typescript-eslint/no-explicit-any`); do not introduce new ones
- TypeScript has 18 existing errors; new errors must be resolved before commit
- Font provider warnings during build/dev are normal and non-blocking
