---
name: Test Before Commit
description: Quick validation prompt for code changes — run tests and report results
---

# Test Before Commit

Use this prompt to validate code changes are ready to commit.

**Run these commands and show the output:**

1. `npm run build` — must succeed with no new errors
2. `npm test` — must show "97 passed"
3. `npm run lint` — review touched-file regressions only (the repo has existing baseline lint failures)

**Then report:**
- ✅ Build and tests succeeded, and lint output shows no new touched-file regressions → ready to commit
- ❌ Build or tests failed → show error, do not commit
- ⚠️ Lint still reports the repo's known baseline failures; only fix new issues introduced by the change (use `npm run lint:fix` for formatting only)

**Evidence required:** Paste full terminal output showing command completion.
