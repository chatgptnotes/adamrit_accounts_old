# Corporate Claim Tracking - Rollback Documentation

**Version:** 1.0.0
**Last Updated:** 14 August 2026
**Author:** System Team

---

## Purpose

This document provides recovery procedures for the Corporate Claim Tracking feature, including rollback procedures for migrations, data restoration, and emergency recovery steps.

---

## Table of Contents

1. [Backup Procedures](#backup-procedures)
2. [Migration Rollback](#migration-rollback)
3. [Data Restoration](#data-restoration)
4. [Emergency Recovery](#emergency-recovery)
5. [Verification Steps](#verification-steps)
6. [Contact Information](#contact-information)

---

## Backup Procedures

### Before Any Changes

Always create backups before:

1. Applying new migrations
2. Modifying linkage table data
3. Bulk updating claim statuses
4. Changing validation rules

### Export Linkage Table

```sql
-- Export current patient-government linkages to CSV
COPY (
  SELECT
    id,
    hospital_name,
    patient_id,
    patients_id,
    government_id,
    government_program_id,
    matched_by,
    linked_at,
    created_at
  FROM patient_government_linkage
  ORDER BY linked_at DESC
) TO 'linkage_backup_YYYYMMDD.csv' CSV HEADER;
```

### Export Snapshots Metadata

```sql
-- Export snapshots table metadata
COPY (
  SELECT
    id,
    source_file_name,
    hospital_name,
    scheme_code,
    upload_date,
    content_hash,
    total_rows,
    valid_rows,
    invalid_rows,
    duplicate_status,
    created_at
  FROM corporate_claim_snapshots
  ORDER BY upload_date DESC
) TO 'snapshots_backup_YYYYMMDD.csv' CSV HEADER;
```

### Export Complete Snapshots with Data

```sql
-- For full backup (includes JSONB data)
-- Note: This may create a large file
COPY corporate_claim_snapshots TO 'snapshots_full_YYYYMMDD.csv' CSV;
```

---

## Migration Rollback

### Rollback Index Migration (20260814140000)

If the performance indexes cause issues:

```sql
-- Rollback: Drop performance indexes
DROP INDEX IF EXISTS idx_snapshots_hospital_scheme_date;
DROP INDEX IF EXISTS idx_snapshots_hospital_date;
DROP INDEX IF EXISTS idx_snapshots_hash;
DROP INDEX IF EXISTS idx_linkage_hospital_govt;
DROP INDEX IF EXISTS idx_linkage_patient;
DROP INDEX IF EXISTS idx_linkage_matched_by;
DROP INDEX IF EXISTS idx_snapshots_parsed_gin;
```

### Rollback Simplification Migration (20260814120000)

To restore the original 10-table structure:

**⚠️ WARNING: This is a DESTRUCTIVE operation. Ensure you have backups.**

1. Check current state:
```sql
-- Verify simplified tables exist
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name LIKE 'corporate_claim%';
```

2. If using simplified tables, you need to manually recreate original structure from pre-simplification backup.

### Rollback Linkage Table Migration (20260814130000)

```sql
-- Drop linkage table if needed
DROP TABLE IF EXISTS patient_government_linkage;

-- Note: This will break auto-match functionality
-- Only do this if migrating back to manual-only matching
```

---

## Data Restoration

### Restore Linkage Table from Backup

```sql
-- Step 1: Truncate existing data (use with caution)
TRUNCATE patient_government_linkage;

-- Step 2: Restore from backup
COPY patient_government_linkage FROM 'linkage_backup_YYYYMMDD.csv' CSV HEADER;

-- Step 3: Verify row count
SELECT COUNT(*) AS restored_rows
FROM patient_government_linkage;
```

### Restore Snapshots from Backup

```sql
-- For metadata-only restore
TRUNCATE corporate_claim_snapshots;
COPY corporate_claim_snapshots FROM 'snapshots_backup_YYYYMMDD.csv' CSV HEADER;

-- Verify
SELECT COUNT(*) FROM corporate_claim_snapshots;
```

---

## Emergency Recovery

### Scenario 1: Incorrect Linkage Applied

**Problem:** Auto-match linked wrong patients

**Recovery:**
```sql
-- 1. Identify recently added linkages
SELECT *
FROM patient_government_linkage
WHERE linked_at > 'YYYY-MM-DD HH:MM:SS'
ORDER BY linked_at DESC;

-- 2. Delete incorrect linkages
DELETE FROM patient_government_linkage
WHERE id IN ('uuid1', 'uuid2', 'uuid3'); -- Specify IDs from step 1

-- 3. Re-verify affected claims
-- Verification will re-run on next load
```

### Scenario 2: Duplicate Upload Issue

**Problem:** Valid file incorrectly marked as duplicate

**Recovery:**
```sql
-- 1. Check content hash
SELECT content_hash, source_file_name, duplicate_status
FROM corporate_claim_snapshots
WHERE source_file_name = 'problem_file.xlsx';

-- 2. If incorrectly marked, update status
UPDATE corporate_claim_snapshots
SET duplicate_status = 'original',
    original_file_id = NULL
WHERE id = 'snapshot_uuid';

-- 3. Verify file is now visible
```

### Scenario 3: Migration Failure Partway Through

**Problem:** Migration applied partially, system in inconsistent state

**Recovery:**
```sql
-- 1. Check migration status
SELECT version, applied_at
FROM supabase_migrations.schema_migrations
ORDER BY applied_at DESC;

-- 2. Identify what failed
-- Check Supabase logs and error messages

-- 3. Rollback to last known good state
-- Use the appropriate rollback SQL from above sections

-- 4. Re-apply migration after fixing issue
-- (Only after identifying root cause)
```

### Scenario 4: Data Loss

**Problem:** Accidental deletion of important data

**Recovery:**
```sql
-- 1. IMMEDIATELY: Stop all write operations to the affected table

-- 2. Check if you have a recent backup
-- Use the export procedures above

-- 3. Restore from most recent backup
-- See Data Restoration section above

-- 4. If no backup, check with:
-- - Supabase point-in-time-recovery (if enabled)
-- - Database backups from hosting provider
```

---

## Verification Steps

After any rollback or recovery, verify:

### 1. Check Data Integrity

```sql
-- Verify linkage table
SELECT
  COUNT(*) AS total_linkages,
  COUNT(DISTINCT patient_id) AS unique_patients,
  COUNT(DISTINCT government_id) AS unique_govt_ids
FROM patient_government_linkage;
```

### 2. Verify No Orphaned Data

```sql
-- Check for linkages pointing to non-existent patients
SELECT COUNT(*)
FROM patient_government_linkage l
LEFT JOIN patients p ON l.patient_id = p.id
WHERE p.id IS NULL;

-- Should return 0
```

### 3. Verify Snapshot Consistency

```sql
-- Check for snapshots without valid JSONB data
SELECT COUNT(*)
FROM corporate_claim_snapshots
WHERE parsed_data IS NULL;

-- Should return 0 (or only very recent uploads being processed)
```

### 4. Test Auto-Match Functionality

1. Upload a test file
2. Verify auto-match works
3. Check that linkage persists across page refreshes

### 5. Test UI Functionality

1. Load Corporate Claim Tracking page
2. Verify dashboard metrics display correctly
3. Verify filters work
4. Verify needs review shows only unmatched claims

---

## Pre-Rollback Checklist

Before performing ANY rollback:

- [ ] Have recent backups available (less than 24 hours old)
- [ ] Document current state (row counts, last migration, etc.)
- [ ] Inform users of potential downtime
- [ ] Perform during low-traffic period if possible
- [ ] Have rollback plan reviewed by another team member
- [ ] Test rollback procedure on non-production environment first

---

## Post-Rollback Checklist

After completing rollback:

- [ ] Verify all data is restored correctly
- [ ] Run verification steps above
- [ ] Test application functionality
- [ ] Document what went wrong and why
- [ ] Update procedures to prevent recurrence
- [ ] Inform users that system is restored

---

## Contact Information

### Primary Contacts

| Role | Name | Contact |
|------|------|---------|
| Database Lead | [Name] | [Email/Phone] |
| System Admin | [Name] | [Email/Phone] |
| Development Lead | [Name] | [Email/Phone] |

### Emergency Contacts

| Situation | Contact |
|-----------|---------|
| Data Loss Incident | Database Lead + System Admin |
| Migration Failure | Development Lead + Database Lead |
| Production Issues | System Admin + Development Lead |

---

## Change Log

| Date | Version | Changes | Author |
|------|---------|---------|--------|
| 14 Aug 2026 | 1.0.0 | Initial documentation | System Team |

---

## Appendix: Useful Queries

### Find All Duplicate Files

```sql
SELECT content_hash, COUNT(*) as count
FROM corporate_claim_snapshots
GROUP BY content_hash
HAVING COUNT(*) > 1;
```

### Find Recent Linkage Activity

```sql
SELECT
  matched_by,
  COUNT(*) as linkages_created,
  MAX(linked_at) as last_activity
FROM patient_government_linkage
WHERE linked_at > NOW() - INTERVAL '7 days'
GROUP BY matched_by
ORDER BY linkages_created DESC;
```

### Check Migration Version

```sql
SELECT * FROM supabase_migrations.schema_migrations
ORDER BY applied_at DESC
LIMIT 5;
```

---

**END OF DOCUMENT**
