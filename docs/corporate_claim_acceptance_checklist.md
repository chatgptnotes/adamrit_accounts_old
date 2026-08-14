# Corporate Claim Tracking - Acceptance Checklist

**Version:** 1.0.0
**Date:** 14 August 2026
**Project:** Adamrit Hospital Management System

---

## Purpose

This checklist serves as the final acceptance criteria for the Corporate Claim Tracking Phase 3 implementation. All items must be verified and signed off before going live.

---

## Phase 3 Features: Acceptance Checklist

### User Additions (Priority Items)

#### 1. Hide Dashboard Cards
- [ ] **Sent To Bank** card is NOT displayed on dashboard
- [ ] **Payment Initiated** card is NOT displayed on dashboard
- [ ] **Ambiguous** card is NOT displayed on dashboard
- [ ] **Conflict/Invalid** card is NOT displayed on dashboard
- [ ] **Total Claims** card is displayed and shows correct count
- [ ] **Matched** card is displayed and shows correct count
- [ ] **Active IPD** card is displayed and shows correct count
- [ ] **Discharged** card is displayed and shows correct count
- [ ] **Unmatched** card is displayed and shows correct count
- [ ] **Needs Review** card is displayed and shows correct count

**Tested by:** _________________  **Date:** _________

---

#### 2. Admission/Discharge Dates in Needs Review
- [ ] Claim detail drawer shows **Admission Date** when patient matched
- [ ] Claim detail drawer shows **Discharge Date** when patient matched
- [ ] Claim detail drawer shows **Days Pending** calculation
- [ ] Days pending is calculated from discharge date to today
- [ ] When patient not found in HMIS, admission/discharge shows "—"
- [ ] Government file dates are still visible for unmatched patients
- [ ] Date format is Indian standard (DD-MMM-YYYY)

**Tested by:** _________________  **Date:** _________

---

#### 3. Stale Claim Warning (>120 days)
- [ ] Claims pending >120 days since discharge show **⚠️ warning icon**
- [ ] Stale claims are highlighted with **amber background color** in table
- [ ] Stale claims are highlighted with **amber border** in drawer
- [ ] Warning badge shows "Stale Claim" text
- [ ] Days pending shows "(⚠️ Over 4 months)" when stale
- [ ] Non-stale claims (<120 days) do NOT show warning
- [ ] Stale indicator appears in both table row and detail drawer

**Tested by:** _________________  **Date:** _________

---

### Original Phase 3 Features

#### 4. CSV/Excel Export
- [ ] **Export** button is visible on main tracking page
- [ ] Export dropdown shows CSV and Excel options
- [ ] Filter dialog appears before export
- [ ] Can filter by scheme (PMJAY/MJPJAY/All)
- [ ] Can filter by stage
- [ ] Can filter by date range
- [ ] Can filter by hospital
- [ ] Can filter by payment state
- [ ] Exported CSV/Excel file downloads successfully
- [ ] Exported filename includes timestamp
- [ ] Exported data includes all relevant fields
- [ ] Export handles empty results gracefully

**Tested by:** _________________  **Date:** _________

---

#### 5. Reconciliation Report
- [ ] **Reconciliation Report** button is available
- [ ] Report compares Claimed vs Approved vs Paid amounts
- [ ] Report shows TDS deducted
- [ ] Report shows RF amount
- [ ] Report calculates Outstanding Balance correctly
- [ ] Report flags discrepancies
- [ ] Discrepancies include: Paid > Approved, Missing UTR, Overpayment
- [ ] Report can be exported to Excel
- [ ] Summary sheet shows totals
- [ ] Details sheet shows individual claims
- [ ] Discrepancies sheet shows only problematic claims

**Tested by:** _________________  **Date:** _________

---

#### 6. Payment/UTR Reconciliation
- [ ] **Payment/UTR Check** feature is available
- [ ] Identifies **missing UTRs** (paid claims without UTR)
- [ ] Identifies **duplicate UTRs** (same UTR on multiple claims)
- [ ] Identifies **partial payments** (paid < approved)
- [ ] Identifies **amount mismatches** (payment doesn't match approved)
- [ ] Identifies **overpayments**
- [ ] Results are categorized by severity (critical/warning/info)
- [ ] Results can be exported to Excel
- [ ] Summary shows total issues found

**Tested by:** _________________  **Date:** _________

---

#### 7. Management Summaries
- [ ] **Summaries** section or tab is available
- [ ] Shows **aging analysis** by stage
- [ ] Shows **pending with payer ageing** (how long claims stuck)
- [ ] Shows **rejection trends** (rejection reasons)
- [ ] Shows **query ageing** (unresolved queries by age)
- [ ] Shows **approval to payment time** metrics
- [ ] Shows **summary metrics**: approval rate, payment rate, rejection rate
- [ ] Summaries can be exported to PDF/Excel
- [ ] Charts/tables are readable and accurate

**Tested by:** _________________  **Date:** _________

---

#### 8. Import History Screen
- [ ] **Import History** page is accessible
- [ ] Lists all uploaded files
- [ ] Shows **filename** for each upload
- [ ] Shows **upload date/time** for each upload
- [ ] Shows **row counts** (total, valid, invalid)
- [ ] Shows **validation result** (passed/failed/errors)
- [ ] Shows **duplicate status** (original/duplicate/renamed)
- [ ] Shows **fingerprint hash** (first 8 characters)
- [ ] Shows **which user uploaded** the file
- [ ] Can click to view parsed data
- [ ] Can download original files

**Tested by:** _________________  **Date:** _________

---

#### 9. Print-Friendly Reports
- [ ] **Print** button is available on claim details
- [ ] Printed report shows **clean layout** (no navigation/sidebar)
- [ ] Printed report shows **hospital name**
- [ ] Printed report shows **print date/time**
- [ ] Printed report shows **printed by** user name
- [ ] Printed report shows **all claim details**
- [ ] Printed report shows **audit trail** (if applicable)
- [ ] Printed report can be saved as PDF
- [ ] Print styles are readable (black text on white background)

**Tested by:** _________________  **Date:** _________

---

#### 10. Pagination
- [ ] Large datasets (>1000 claims) load efficiently
- [ ] **50-100 rows per page** setting is available
- [ ] **Next/Previous** navigation works
- [ ] **Page size selector** is available
- [ ] **Server-side filtering** is implemented
- [ ] **Total pages** is displayed
- [ ] **Current page** is highlighted
- [ ] Can jump to specific page
- [ ] Pagination works with all filters
- [ ] No performance degradation with large datasets

**Tested by:** _________________  **Date:** _________

---

#### 11. Database Indexes
- [ ] Index migration has been applied to production
- [ ] Queries are faster after index application
- [ ] Pagination works smoothly
- [ ] No errors in Supabase logs related to indexes
- [ ] Index names follow naming convention

**Tested by:** _________________  **Date:** _________

---

#### 12. Automated Tests
- [ ] **All 12 test suites pass**
- [ ] File parsing tests pass (6 file types)
- [ ] Duplicate upload detection test passes
- [ ] Renamed duplicate file test passes
- [ ] Malformed rows test passes
- [ ] Scheme conflicts test passes
- [ ] Unresolved IDs test passes
- [ ] Exact ID matching test passes
- [ ] Auto-match by name+date test passes
- [ ] Role permissions test passes
- [ ] Payment totals calculation test passes
- [ ] Audit event logging test passes
- [ ] Needs Review criteria test passes
- [ ] Test coverage is ≥80%

**Tested by:** _________________  **Date:** _________

---

#### 13. Rollback Documentation
- [ ] Rollback documentation exists and is complete
- [ ] Backup procedures are documented
- [ ] Migration rollback steps are documented
- [ ] Data restoration steps are documented
- [ ] Emergency recovery scenarios are covered
- [ ] Verification steps are documented
- [ ] Contact information is current

**Tested by:** _________________  **Date:** _________

---

#### 14. Security Review
- [ ] **RLS policies** are enabled on corporate_claim_snapshots
- [ ] **RLS policies** are enabled on patient_government_linkage
- [ ] Only **Super Admin** can view all hospitals
- [ ] Only **Admin** can view assigned hospitals
- [ ] **Billing** users can only view/edit their hospital
- [ ] **Viewer** role can only view, not edit
- [ ] **Audit trail** is complete and immutable
- [ ] No **sensitive data** in console.logs
- [ ] No **hardcoded secrets** in code
- [ ] **Error messages** do not leak sensitive data

**Tested by:** _________________  **Date:** _________

---

#### 15. General Functionality
- [ ] Upload all 6 government file types successfully
- [ ] Duplicate upload is rejected correctly
- [ ] Renamed duplicate is detected correctly
- [ ] Auto-match by name+date works accurately
- [ ] Manual patient matching works
- [ ] Linkage persists across sessions
- [ ] Needs Review shows only unmatched + invalid claims
- [ ] Search by patient name works
- [ ] Search by government ID works
- [ ] PMJAY/MJPJAY separation works correctly
- [ ] Dashboard metrics update in real-time

**Tested by:** _________________  **Date:** _________

---

## Sign-Off Section

### Billing User Sign-Off

I have tested the features relevant to my role and verify they work as expected.

**Billing User Name:** ___________________

**Signature:** ___________________

**Date:** _______

**Comments:** _________________________________________________

---

### Admin Sign-Off

I have reviewed and tested the implementation and approve for production use.

**Admin Name:** ___________________

**Signature:** ___________________

**Date:** _______

**Comments:** _________________________________________________

---

### Super Admin Sign-Off

I have reviewed the entire implementation, security measures, and documentation. I approve for go-live.

**Super Admin Name:** ___________________

**Signature:** ___________________

**Date:** _______

**Comments:** _________________________________________________

---

## Deployment Record

| Item | Details |
|------|---------|
| **Deployment Date** | ___________________ |
| **Deployed By** | ___________________ |
| **Environment** | [ ] Production [ ] Staging |
| **Migration Version** | ___________________ |
| **Database Backup Taken** | [ ] Yes [ ] No |
| **Rollback Plan Verified** | [ ] Yes [ ] No |

---

## Post-Go-Live Monitor (First 7 Days)

| Day | Monitored By | Issues Found | Status |
|-----|--------------|--------------|--------|
| 1 | | | [ ] OK |
| 2 | | | [ ] OK |
| 3 | | | [ ] OK |
| 4 | | | [ ] OK |
| 5 | | | [ ] OK |
| 6 | | | [ ] OK |
| 7 | | | [ ] OK |

---

## Known Issues (If Any)

| Issue # | Description | Severity | Workaround |
|---------|-------------|----------|------------|
| | | | |

---

**END OF CHECKLIST**

---

## Appendix: Test Data Reference

### Test File Formats
1. PMJAY Health Claim Pre-Authorization
2. PMJAY Health Claim Request for Approval
3. PMJAY Payment Detail Report
4. MJPJAY Health Claim Pre-Authorization
5. MJPJAY Health Claim Request for Approval
6. MJPJAY Payment Detail Report

### Test Scenarios
- Valid patient with exact ID match
- Valid patient with name+date match
- Patient not in HMIS database
- Duplicate file upload
- Renamed duplicate file upload
- File with malformed rows
- File with mixed PMJAY/MJPJAY schemes

### Test Users
- Super Admin: Can view/edit everything
- Admin: Can view/edit assigned hospitals
- Billing: Can view/edit own hospital
- Viewer: Read-only access

---

**Document Control**

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0.0 | 14 Aug 2026 | Initial release | System Team |
