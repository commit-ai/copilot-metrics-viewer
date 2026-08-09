---
name: Test Before Commit
description: Quick validation prompt for code changes — run tests and report results
---

# Test Before Commit

Use this prompt to validate code changes are ready to commit.

**Run these commands and show the output:**

1. `npm run build` — must succeed with no new errors
2. `npm test` — must show "97 passed"
3. `npm run lint` — report any new errors (existing errors are acceptable)

**Then report:**
- ✅ All three commands succeeded → ready to commit
- ❌ Any command failed → show error, do not commit
- ⚠️ New lint errors → fix before commit (use `npm run lint:fix` for formatting only)

**Evidence required:** Paste full terminal output showing command completion.
