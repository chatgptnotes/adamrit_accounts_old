# Adamrit Project Instructions

- After completing and verifying code changes, push the commit to `main` and deploy production by default.
- Before pushing, run the relevant checks for the change. For frontend changes, use `npm run typecheck` and `npm run build` unless the user says otherwise.
- Keep commits focused on the requested change and do not stage unrelated untracked files.
- When deployment completes, report the commit hash and production URL.
- Advance Statement Yojana package matching must support patient-name-only fallback. Matching priority is saved visit values, then Yojana/Thumb Registration ID, then normalized patient name + preauth/intimation date, then normalized patient name alone using the newest stored Government Portal row.
