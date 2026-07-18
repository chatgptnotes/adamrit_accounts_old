---
name: adamrit-release-workflow
description: Use for Adamrit HMIS repository changes when the user asks to implement, fix, push, deploy, or release work. Encodes the project preference to push and deploy completed verified changes by default.
---

# Adamrit Release Workflow

For `/Users/murali/adamrit/adamrit`:

1. Make the requested code change using the existing project patterns.
2. Verify with `npm run typecheck` and `npm run build` for frontend/runtime changes unless a narrower check is clearly sufficient.
3. Stage only files related to the requested change.
4. Commit with a concise, specific message.
5. Push to `main`.
6. Deploy production with Vercel.
7. Confirm the final production URL and mention any pre-existing warnings separately from new failures.

Do not include unrelated untracked files in commits.
