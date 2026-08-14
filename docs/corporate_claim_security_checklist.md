# Corporate Claim Tracking - Security Review Checklist

**Version:** 1.0.0
**Date:** 14 August 2026
**Review Type:** Pre-Production Security Audit
**Reviewer:** _________________

---

## Executive Summary

| Section | Status | Findings | Risk Level |
|---------|--------|----------|------------|
| RLS Policies | [ ] Pass [ ] Fail | ___ | ___ |
| Authentication | [ ] Pass [ ] Fail | ___ | ___ |
| Authorization | [ ] Pass [ ] Fail | ___ | ___ |
| Input Validation | [ ] Pass [ ] Fail | ___ | ___ |
| Data Protection | [ ] Pass [ ] Fail | ___ | ___ |
| Audit Logging | [ ] Pass [ ] Fail | ___ | ___ |
| Error Handling | [ ] Pass [ ] Fail | ___ | ___ |
| Code Security | [ ] Pass [ ] Fail | ___ | ___ |

---

## 1. Row Level Security (RLS) Policies

### 1.1 Corporate Claim Snapshots Table

- [ ] **RLS is enabled** on the table
  ```sql
  SELECT relrowsecurity FROM pg_class WHERE relname = 'corporate_claim_snapshots';
  -- Expected: true
  ```

- [ ] **Super Admin** can view all hospitals' data
  ```sql
  -- Policy: Enable read for super_admin role
  ```

- [ ] **Admin** can only view their assigned hospital(s)
  ```sql
  -- Policy: Filter by hospital_name using user_hospitals table
  ```

- [ ] **Billing** users can only view their own hospital
  ```sql
  -- Policy: Filter by hospital_name = user's hospital
  ```

- [ ] **Viewer** role can read but not write
  ```sql
  -- Policy: SELECT only, no INSERT/UPDATE/DELETE
  ```

- [ ] **No policies** allow unauthenticated access

### 1.2 Patient Government Linkage Table

- [ ] **RLS is enabled** on the table
- [ ] **Insert policy** only allows service role or authenticated users
- [ ] **Update policy** restricts who can modify linkages
- [ ] **Delete policy** restricts to admins only
- [ ] **Read policy** follows same hospital-based restrictions

**Reviewer Notes:** ___________________________________________________________________

---

## 2. Authentication & Authorization

### 2.1 Authentication

- [ ] All API endpoints require authentication
- [ ] Session tokens are validated on each request
- [ ] Tokens expire after reasonable timeout
- [ ] No hardcoded credentials in code
- [ ] JWT claims include user role and hospital assignment

### 2.2 Authorization Checks

- [ ] UI elements are hidden based on user role
- [ ] Server-side validation enforces role-based access
- [ ] Edge Functions (if used) validate user identity
- [ ] Direct API access is protected
- [ ] Role hierarchy is enforced: Super Admin > Admin > Billing > Viewer

### 2.3 Hospital-Based Access Control

- [ ] Users can only see data from their assigned hospital
- [ ] Hospital assignment cannot be spoofed
- [ ] Cross-hospital queries are blocked for non-admin users
- [ ] User's hospital context is validated from session, not client input

**Reviewer Notes:** ___________________________________________________________________

---

## 3. Input Validation

### 3.1 File Upload Validation

- [ ] File type validation (only allowed formats)
- [ ] File size limits enforced
- [ ] Content validation (malware check if available)
- [ ] Filename sanitization (prevent path traversal)

### 3.2 Data Validation

- [ ] All user inputs are validated before processing
- [ ] SQL injection protection (parameterized queries)
- [ ] XSS protection (input sanitization)
- [ ] CSRF protection (token validation)
- [ ] Type validation (numbers, dates, enums)

### 3.3 API Parameter Validation

- [ ] Pagination limits (max results enforced server-side)
- [ ] Date range limits (prevent unbounded queries)
- [ ] Search query length limits
- [ ] Filter parameter validation (whitelist approach)

**Reviewer Notes:** ___________________________________________________________________

---

## 4. Data Protection

### 4.1 Sensitive Data Handling

- [ ] No sensitive data in URLs
- [ ] No sensitive data in client-side storage (except session tokens)
- [ ] Patient data is not exposed to unauthorized users
- [ ] Government IDs are masked where appropriate
- [ ] Financial data (amounts) is accurate and protected

### 4.2 Data at Rest

- [ ] Database encryption is enabled (Supabase default)
- [ ] Backup encryption is configured
- [ ] No plaintext passwords anywhere

### 4.3 Data in Transit

- [ ] HTTPS is enforced in production
- [ ] API calls use secure endpoints
- [ ] No plaintext data transmission

**Reviewer Notes:** ___________________________________________________________________

---

## 5. Audit Logging

### 5.1 Completeness

- [ ] All file uploads are logged with:
  - [ ] User who uploaded
  - [ ] Timestamp
  - [ ] File metadata (name, size, hash)
  - [ ] Validation results

- [ ] All manual linkages are logged with:
  - [ ] User who linked
  - [ ] Timestamp
  - [ ] Claim ID and Patient ID
  - [ ] Match type (manual)

- [ ] All verification changes are logged:
  - [ ] Previous state
  - [ ] New state
  - [ ] User who made change
  - [ ] Timestamp

### 5.2 Immutability

- [ ] Audit logs cannot be modified by application users
- [ ] Audit logs cannot be deleted by application users
- [ ] Audit trail is append-only

### 5.3 Access to Audit Logs

- [ ] Only admins can view audit logs
- [ ] Audit log access is itself logged

**Reviewer Notes:** ___________________________________________________________________

---

## 6. Error Handling

### 6.1 Error Messages

- [ ] No sensitive data in error messages
- [ ] No stack traces exposed to users
- [ ] No database schema information leaked
- [ ] No API key/secret exposure
- [ ] Errors are logged securely server-side

### 6.2 Edge Cases

- [ ] Graceful handling of missing files
- [ ] Graceful handling of malformed data
- [ ] Graceful handling of network failures
- [ ] No crashes on unexpected input

**Reviewer Notes:** ___________________________________________________________________

---

## 7. Code Security

### 7.1 Secrets Management

- [ ] No API keys in source code
- [ ] No database credentials in source code
- [ ] Environment variables used for all secrets
- [ ] `.env` files are in `.gitignore`
- [ ] No secrets in client-side JavaScript

### 7.2 Dependencies

- [ ] Dependencies are up to date
- [ ] No known vulnerable dependencies
- [ ] `npm audit` shows no high/critical vulnerabilities

### 7.3 Code Quality

- [ ] No `console.log` with sensitive data
- [ ] No commented-out credentials
- [ ] No hardcoded test data in production code
- [ ] No debug endpoints exposed

**Reviewer Notes:** ___________________________________________________________________

---

## 8. OWASP Top 10 (2021) Coverage

| # | Category | Status | Notes |
|---|----------|--------|-------|
| A01 | Broken Access Control | [ ] Pass [ ] Fail | |
| A02 | Cryptographic Failures | [ ] Pass [ ] Fail | |
| A03 | Injection | [ ] Pass [ ] Fail | |
| A04 | Insecure Design | [ ] Pass [ ] Fail | |
| A05 | Security Misconfiguration | [ ] Pass [ ] Fail | |
| A06 | Vulnerable Components | [ ] Pass [ ] Fail | |
| A07 | Auth Failures | [ ] Pass [ ] Fail | |
| A08 | Data Integrity Failures | [ ] Pass [ ] Fail | |
| A09 | Logging Failures | [ ] Pass [ ] Fail | |
| A10 | SSRF | [ ] Pass [ ] Fail | N/A (no external HTTP) |

**Reviewer Notes:** ___________________________________________________________________

---

## 9. Supabase-Specific Security

### 9.1 Authentication

- [ ] Supabase Auth is properly configured
- [ ] Email verification is enabled (if required)
- [ ] Password strength requirements are set
- [ ] Rate limiting is configured

### 9.2 Database

- [ ] `service_role` key is only used server-side
- [ ] `anon` key has restricted permissions
- [ ] No bypass of RLS policies
- [ ] Connection pooling is secure

### 9.3 Storage

- [ ] Storage buckets have appropriate RLS
- [ ] File uploads are validated
- [ ] Public access is appropriately restricted

**Reviewer Notes:** ___________________________________________________________________

---

## 10. Testing Results

### 10.1 Penetration Testing

- [ ] SQL injection test: Passed
- [ ] XSS test: Passed
- [ ] CSRF test: Passed
- [ ] Authentication bypass test: Passed
- [ ] Authorization bypass test: Passed

### 10.2 Role Testing

- [ ] Viewer cannot edit: Passed
- [ ] Billing cannot see other hospitals: Passed
- [ ] Admin can see assigned hospitals: Passed
- [ ] Super Admin can see all: Passed

### 10.3 Input Testing

- [ ] Malicious file upload blocked: Passed
- [ ] Oversized file rejected: Passed
- [ ] Invalid input sanitized: Passed
- [ ] Boundary conditions handled: Passed

**Reviewer Notes:** ___________________________________________________________________

---

## Findings Summary

### Critical Issues (Must Fix Before Go-Live)

| ID | Issue | Location | Fix |
|----|-------|----------|-----|
| | | | |

### High Priority Issues (Should Fix Before Go-Live)

| ID | Issue | Location | Fix |
|----|-------|----------|-----|
| | | | |

### Medium Priority Issues (Fix in Next Sprint)

| ID | Issue | Location | Fix |
|----|-------|----------|-----|
| | | | |

### Low Priority Issues (Nice to Have)

| ID | Issue | Location | Fix |
|----|-------|----------|-----|
| | | | |

---

## Sign-Off

### Reviewer

I have completed the security review as per this checklist.

**Reviewer Name:** ___________________

**Signature:** ___________________

**Date:** _______

**Overall Assessment:** [ ] Pass [ ] Fail (with conditions)

**Comments:** _________________________________________________

---

### Approver

I have reviewed the security findings and approve/deploy accordingly.

**Approver Name:** ___________________

**Signature:** ___________________

**Date:** _______

**Decision:** [ ] Approved for Go-Live [ ] Approved with Conditions [ ] Not Approved

**Conditions (if applicable):** _________________________________________________

---

## Appendix: Security Test Commands

### Check RLS Status

```sql
-- Check if RLS is enabled
SELECT
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE tablename IN ('corporate_claim_snapshots', 'patient_government_linkage');
```

### Check RLS Policies

```sql
-- Get all RLS policies
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename LIKE 'corporate_claim%' OR tablename = 'patient_government_linkage';
```

### Check for Hardcoded Secrets

```bash
# Search for potential secrets in code
grep -r "sk_" src/
grep -r "password" src/
grep -r "api_key" src/
grep -r "secret" src/
```

### Run Security Audit

```bash
# Run npm audit
npm audit

# Run with fix (if safe)
npm audit fix
```

---

**END OF SECURITY CHECKLIST**
