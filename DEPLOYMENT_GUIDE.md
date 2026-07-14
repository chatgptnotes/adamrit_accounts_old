# Adamrit Deployment Guide

This project is a Vite/React application deployed through Vercel. The current Yojna bill update is implemented in `src/pages/CorporateBill.tsx`.

## Important Final Bill Lock

`src/pages/FinalBill.tsx` is protected by a SHA256 deploy lock. The lock prevents accidental changes to the financially sensitive `/final-bill/:visitId` page.

For the current Yojna bill change, `FinalBill.tsx` should remain unchanged. Do not update `scripts/finalbill-baseline.sha256` for this change.

If the deployment process requires the authorized temporary unlock, use the following PowerShell commands from the project root:

```powershell
$env:FINALBILL_UNLOCK="1"
npm run build
Remove-Item Env:FINALBILL_UNLOCK
npm run verify:finalbill-lock
```

The unlock variable is temporary. Do not add it to `.env`, `.env.local`, Vercel environment variables, or committed files.

If `src/pages/FinalBill.tsx` was intentionally changed, stop and obtain approval before updating the baseline. Only after approval should the baseline be updated:

```powershell
node scripts/check-finalbill-locked.cjs --update-baseline
npm run verify:finalbill-lock
```

## Before Deployment

1. Use Node.js 18 or newer.
2. Install dependencies:

   ```powershell
   npm install
   ```

3. Confirm the working tree contains only intended changes:

   ```powershell
   git status --short
   ```

4. Verify the Final Bill lock:

   ```powershell
   npm run verify:finalbill-lock
   ```

5. Run the production build using the temporary unlock/relock sequence above if required by the deployment process.

## Vercel Deployment

1. Push the approved changes to GitHub:

   ```powershell
   git add src/pages/CorporateBill.tsx DEPLOYMENT_GUIDE.md
   git commit -m "Update Yojna final bill layout and controls"
   git push origin main
   ```

2. Confirm the Vercel project is connected to the correct GitHub repository and production branch.
3. Confirm all required `VITE_*` Supabase environment variables are configured in Vercel.
4. Allow Vercel to run the production build.
5. Confirm the deployment build passes the Final Bill lock check.
6. Do not leave `FINALBILL_UNLOCK` configured in Vercel.

## Post-Deployment Smoke Test

Use a safe test patient or staging patient and verify:

- Login works.
- The Yojna bill route opens at `/yojna-bill/:visitId`.
- The main Yojna Final Bill is centered.
- The Final Bill minimize button hides the bill.
- The restore button brings the bill back without losing entered values.
- Implant Bill and Implant Sticker minimize controls still work independently.
- Printing includes the full Final Bill, even after minimizing it on screen.
- Save to Database still completes successfully.
- The existing `/final-bill/:visitId` page opens and behaves normally.
- Browser console has no new errors during the tested workflow.

## Tally Manual Refresh Deployment Checks

Tally synchronization is manual only. The application must not start a sync when the Tally tab opens, when switching companies, or while waiting on a timer.

Before deployment, verify:

```powershell
rg -n "auto.?sync|autoSync|setInterval|Refresh from Tally|Sync from Tally|Fetch from Tally" src\components\tally src\hooks\useTallyIntegration.ts
```

Expected behavior:

- The Tally right-rail **Refresh All** button is always visible and available.
- Clicking **Refresh All** runs the full sync for configured companies.
- Clicking it without a configured Tally company shows an error and does not fail silently.
- Cash Book, Bank Book, GST, and Reports display cached Supabase data only.
- No individual Tally screen starts a direct sync.
- Existing Tally company records are not required to have auto-sync settings enabled.

Manual Tally smoke test after deployment:

1. Open the Tally tab and confirm no sync starts automatically.
2. Switch between Dashboard, Ledgers, Vouchers, Cash Book, Bank Book, Stock, Reports, and GST; confirm no sync starts.
3. Click **Refresh All** once and confirm the progress state and success/failure toast appear.
4. Confirm the refreshed ledgers, vouchers, stock, reports, and sync history are visible afterward.
5. Open Cash Book, Bank Book, GST, and Reports and confirm they load cached data without their own Tally sync buttons.

## Rollback

If production verification fails:

1. In Vercel, open the project deployment history.
2. Select the last known-good deployment.
3. Choose **Promote to Production** or redeploy that deployment.
4. Re-run the post-deployment smoke test.
5. Investigate and fix the issue in a separate change before trying again.

## Final Lock Verification

Before closing the deployment task, run:

```powershell
Remove-Item Env:FINALBILL_UNLOCK -ErrorAction SilentlyContinue
npm run verify:finalbill-lock
```

The expected result is:

```text
All checks passed. Deploy gate is intact.
```
