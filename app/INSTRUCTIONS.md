---
description: Vue component and shared code conventions for copilot-metrics-viewer frontend
---

# App Development

This directory contains Vue 3 Composition API components, utilities, models, and pages for the Nuxt 3 metrics viewer.

## Patterns

**Components** (`.vue` files):
- Use Composition API with `<script setup>`
- Extract complex logic into composables in the same directory or `/utils`
- Keep components focused: one responsibility per component
- Name files in PascalCase (e.g., `MetricsViewer.vue`)
- Provide TypeScript interfaces for props using `defineProps` with typed `as const`

**Utilities** (`.ts` files):
- Pure functions, no side effects
- Testable: used by components and other utilities
- Named in camelCase (e.g., `dateUtils.ts`)
- Export named functions, not default exports
- Add unit tests alongside: `dateUtils.spec.ts`

**Models** (`.ts` in `/model`):
- TypeScript interfaces for data shapes (API responses, state)
- Immutable by convention (no mutation)
- No business logic — only type definitions

**Pages** (`.vue` in `/pages`):
- Route entry points managed by Nuxt auto-routing
- Route dynamic parameters via file names (e.g., `[org].vue`)
- Delegate UI to components, data fetching to composables

## Error Handling

Always handle errors at trust boundaries (API calls, user input):
- Catch and log errors from API calls
- Return user-friendly error messages, not raw exceptions
- Validate input types with TypeScript + runtime guards where needed

## Testing

- Unit test files: `tests/unit/*.spec.ts` using Vitest
- Test utilities and components that have >5 lines of logic
- Mocked GitHub API is built-in; no real tokens needed for tests
- Run with `npm test` — all 97 tests must pass before commit
