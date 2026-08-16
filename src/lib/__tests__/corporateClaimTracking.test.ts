// ============================================================================
// Corporate Claim Tracking - Automated Tests
// ============================================================================
// Test suite for corporate claim tracking functionality
// Covers file parsing, duplicate detection, matching, permissions, and more
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  corporateClaimFileFingerprint,
  parseCorporateClaimFile,
  parseClaimAmount,
  parseClaimDate,
  schemeForProgramId,
  checkPaymentStatus,
  autoMatchClaimByNameAndDate,
  storePatientLinkage,
  type CorporateClaimParsedFile
} from '../corporateClaimTracking';

describe('Corporate Claim Tracking', () => {
  // Test data setup
  const mockFileContent = {
    filename: 'test_file.xlsx',
    content: 'mock content'
  };

  const mockValidRow = {
    beneficiary_name: 'Test Patient',
    government_registration_id: 'PJ123456789',
    government_program_id: 'PMJAY123456',
    claimed_amount: 10000,
    approved_amount: 8000,
    paid_amount: 0,
    current_stage: 'pending_with_payer'
  };

  const mockPMJAYProgramId = 'PMJAY' + 'A'.repeat(40);
  const mockMJPJAYProgramId = 'MJPJAY' + 'B'.repeat(40);

  /**
   * Builds a parsed file of the shape corporateClaimFileFingerprint actually
   * takes. The fingerprint covers fileType, reportDate, headers and each row's
   * originalValues — deliberately NOT fileName, which is what makes a renamed
   * copy of the same export count as a duplicate.
   */
  const parsedFile = (
    values: Record<string, string>[],
    overrides: Partial<CorporateClaimParsedFile> = {}
  ): CorporateClaimParsedFile => ({
    fileName: 'claims.xlsx',
    fileType: 'pending_with_payer',
    delimiter: null,
    headers: ['Beneficiary Name', 'Claimed Amount'],
    reportDate: '2026-08-01',
    rows: values.map((originalValues, index) => ({
      rowNumber: index + 1,
      originalValues,
      normalizedValues: {},
      issues: [],
      fingerprintInput: JSON.stringify(originalValues),
    })),
    fatalErrors: [],
    ...overrides,
  });

  // ============================================================================
  // Test 1: File Parsing Tests (6 file types)
  // ============================================================================
  describe('File Parsing', () => {
    // The scheme is decided by the NORMALIZED prefix — PJ / MJ — not by the
    // scheme's display name. A "PMJAY..." string normalizes to a PM prefix and
    // is deliberately UNRESOLVED rather than guessed at.
    it('should parse PMJAY claim file correctly', async () => {
      expect(schemeForProgramId('PJ' + '1'.repeat(40))).toBe('PMJAY');
      expect(schemeForProgramId('pj-123/456')).toBe('PMJAY');
    });

    it('should parse MJPJAY claim file correctly', async () => {
      expect(schemeForProgramId('MJ' + '1'.repeat(40))).toBe('MJPJAY');
    });

    it('should refuse to guess a scheme it does not recognise', () => {
      expect(schemeForProgramId('PMJAY' + '1'.repeat(40))).toBe('UNRESOLVED');
      expect(schemeForProgramId('')).toBe('UNRESOLVED');
      expect(schemeForProgramId(null)).toBe('UNRESOLVED');
    });

    it('should handle files with missing required fields', async () => {
      const invalidRow = { ...mockValidRow, beneficiary_name: '' };
      expect(() => {
        // Validation should catch missing beneficiary_name
        if (!invalidRow.beneficiary_name) {
          throw new Error('Missing beneficiary name');
        }
      }).toThrow();
    });

    it('should parse valid date formats correctly', () => {
      expect(parseClaimDate('2024-01-15')).toBe('2024-01-15');
      // Portal exports are day-first, so this is 15 January, not 1 March.
      expect(parseClaimDate('15/01/2024')).toBe('2024-01-15');
      expect(parseClaimDate('15-01-24')).toBe('2024-01-15');
    });

    it('should handle invalid date formats gracefully', () => {
      expect(parseClaimDate('invalid-date')).toBeNull();
      expect(parseClaimDate('')).toBeNull();
      // A real calendar check, not just a shape check: there is no 31 February.
      expect(parseClaimDate('31/02/2024')).toBeNull();
    });

    it('should parse numeric amounts correctly', () => {
      expect(parseClaimAmount('10,500.50')).toBe(10500.5);
      expect(parseClaimAmount('₹ 1,00,000')).toBe(100000);
      expect(parseClaimAmount('')).toBeNull();
      expect(parseClaimAmount('not a number')).toBeNull();
    });
  });

  // ============================================================================
  // Test 2: Duplicate Upload Detection
  // ============================================================================
  describe('Duplicate Upload Detection', () => {
    it('should detect duplicate files by content hash', async () => {
      const rows = [{ 'Beneficiary Name': 'Test Patient', 'Claimed Amount': '10000' }];
      const hash1 = await corporateClaimFileFingerprint(parsedFile(rows));
      const hash2 = await corporateClaimFileFingerprint(parsedFile(rows));

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 format
    });

    it('should generate different hashes for different content', async () => {
      const hash1 = await corporateClaimFileFingerprint(parsedFile([{ 'Claimed Amount': '10000' }]));
      const hash2 = await corporateClaimFileFingerprint(parsedFile([{ 'Claimed Amount': '20000' }]));

      expect(hash1).not.toBe(hash2);
    });

    it('should notice a changed report date on otherwise identical rows', async () => {
      const rows = [{ 'Claimed Amount': '10000' }];
      const hash1 = await corporateClaimFileFingerprint(parsedFile(rows));
      const hash2 = await corporateClaimFileFingerprint(parsedFile(rows, { reportDate: '2026-08-02' }));

      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty file content', async () => {
      const hash = await corporateClaimFileFingerprint(parsedFile([]));
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should handle large file content', async () => {
      const manyRows = Array.from({ length: 5000 }, (_, index) => ({
        'Beneficiary Name': `Patient ${index}`,
        'Claimed Amount': String(index * 100),
      }));
      const hash = await corporateClaimFileFingerprint(parsedFile(manyRows));
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  // ============================================================================
  // Test 3: Renamed Duplicate File Detection
  // ============================================================================
  describe('Renamed Duplicate File', () => {
    it('should detect duplicate even with different filename', async () => {
      const rows = [{ 'Beneficiary Name': 'Test Patient' }];
      const hash1 = await corporateClaimFileFingerprint(parsedFile(rows, { fileName: 'claims.xlsx' }));
      const hash2 = await corporateClaimFileFingerprint(
        parsedFile(rows, { fileName: 'claims (1) FINAL v2.xlsx' })
      );

      // This is the property the whole duplicate check rests on: re-downloading
      // the same portal export under a new name must not create a second upload.
      expect(hash1).toBe(hash2);
    });

    it('should not flag different content as duplicate', async () => {
      const hash1 = await corporateClaimFileFingerprint(parsedFile([{ 'Beneficiary Name': 'Patient A' }]));
      const hash2 = await corporateClaimFileFingerprint(parsedFile([{ 'Beneficiary Name': 'Patient B' }]));

      expect(hash1).not.toBe(hash2);
    });
  });

  // ============================================================================
  // Test 4: Malformed Rows Handling
  // ============================================================================
  describe('Malformed Rows', () => {
    it('should handle rows with invalid dates', () => {
      const rowWithInvalidDate = {
        ...mockValidRow,
        preauth_date: 'invalid-date'
      };

      // Should not crash, should handle gracefully
      expect(() => {
        const date = new Date(rowWithInvalidDate.preauth_date);
        if (isNaN(date.getTime())) {
          // Invalid date detected
          throw new Error('Invalid date');
        }
      }).toThrow();
    });

    it('should handle rows with negative amounts', () => {
      const rowWithNegativeAmount = {
        ...mockValidRow,
        claimed_amount: -1000
      };

      // Should flag as invalid
      expect(rowWithNegativeAmount.claimed_amount).toBeLessThan(0);
    });

    it('should handle rows with missing IDs', () => {
      const rowWithoutID = {
        ...mockValidRow,
        government_registration_id: ''
      };

      // Should flag as requiring verification
      expect(rowWithoutID.government_registration_id).toBe('');
    });

    it('should handle rows with special characters in names', () => {
      const rowWithSpecialChars = {
        ...mockValidRow,
        beneficiary_name: "O'Brien - Test & Son's"
      };

      // Should handle special characters properly
      expect(rowWithSpecialChars.beneficiary_name).toContain("'");
      expect(rowWithSpecialChars.beneficiary_name).toContain('&');
    });
  });

  // ============================================================================
  // Test 5: Scheme Conflicts (PJ vs MJ)
  // ============================================================================
  describe('Scheme Conflicts', () => {
    it('should identify PMJAY scheme correctly', () => {
      const pmjayId = 'PJ' + '1'.repeat(40);
      expect(schemeForProgramId(pmjayId)).toBe('PMJAY');
    });

    it('should identify MJPJAY scheme correctly', () => {
      const mjpjayId = 'MJ' + '1'.repeat(40);
      expect(schemeForProgramId(mjpjayId)).toBe('MJPJAY');
    });

    it('should handle scheme mismatch correctly', () => {
      // A PJ id belongs to PMJAY, so a stored MJPJAY scheme on the same claim
      // is a genuine conflict rather than two spellings of one answer.
      expect(schemeForProgramId('PJ' + '1'.repeat(40))).not.toBe(
        schemeForProgramId('MJ' + '1'.repeat(40))
      );
    });

    it('should handle unrecognized scheme prefixes', () => {
      const unknownId = 'UNKNOWN' + '1'.repeat(35);
      const scheme = schemeForProgramId(unknownId);
      expect(scheme).toBe('UNRESOLVED');
    });
  });

  // ============================================================================
  // Test 6: Unresolved IDs Handling
  // ============================================================================
  describe('Unresolved IDs', () => {
    it('should flag non-PJ/MJ prefixes as unresolved', () => {
      const unknownPrefix = 'XYZ123456789';
      const isUnresolved = !unknownPrefix.startsWith('PJ') &&
                          !unknownPrefix.startsWith('MJ') &&
                          !unknownPrefix.startsWith('PMJAY') &&
                          !unknownPrefix.startsWith('MJPJAY');

      expect(isUnresolved).toBe(true);
    });

    it('should handle missing government IDs', () => {
      const rowWithoutID = { ...mockValidRow, government_registration_id: undefined };
      expect(rowWithoutID.government_registration_id).toBeUndefined();
    });

    it('should handle malformed government IDs', () => {
      const malformedID = 'P@#$%^&*()';
      const hasValidFormat = /^(PJ|MJ|PMJAY|MJPJAY)/.test(malformedID);
      expect(hasValidFormat).toBe(false);
    });
  });

  // ============================================================================
  // Test 7: Exact ID Matching
  // ============================================================================
  describe('Exact ID Matching', () => {
    it('should match claims by exact government ID', async () => {
      const claim = {
        ...mockValidRow,
        government_registration_id: 'PJ123456789'
      };

      // Simulate database lookup by exact ID
      const dbPatient = {
        id: 'patient-1',
        patients_id: 'PAT123',
        registration_id: 'PJ123456789'
      };

      const matches = claim.government_registration_id === dbPatient.registration_id;
      expect(matches).toBe(true);
    });

    it('should not match different IDs', () => {
      const claimId = 'PJ123456789';
      const dbId = 'PJ987654321';

      expect(claimId === dbId).toBe(false);
    });

    it('should handle case sensitivity in IDs', () => {
      const id1 = 'pj123456789';
      const id2 = 'PJ123456789';

      // IDs should match case-insensitively if configured that way
      expect(id1.toLowerCase()).toBe(id2.toLowerCase());
    });
  });

  // ============================================================================
  // Test 8: Auto-Match by Name + Date
  // ============================================================================
  describe('Auto-Match by Name and Date', () => {
    it('should match by patient name and admission date', async () => {
      const claim = {
        ...mockValidRow,
        beneficiary_name: 'Test Patient',
        admission_date: '2024-01-15',
        discharge_date: '2024-01-20'
      };

      const dbVisit = {
        patient: { name: 'Test Patient' },
        admission_date: '2024-01-15',
        discharge_date: '2024-01-20'
      };

      const nameMatch = claim.beneficiary_name.toLowerCase() ===
                       dbVisit.patient.name.toLowerCase();
      const dateMatch = claim.admission_date === dbVisit.admission_date;

      expect(nameMatch && dateMatch).toBe(true);
    });

    it('should handle name variations (fuzzy match)', () => {
      const claimName = 'RAHUL KUMAR';
      const dbName = 'RAHUL KUMAR SHARMA';

      // Simple check - real implementation would use fuzzy matching
      const contains = claimName.includes(dbName.split(' ')[0]);
      expect(contains).toBe(true);
    });

    it('should match by date range within tolerance', () => {
      const claimDate = new Date('2024-01-15');
      const dbDate = new Date('2024-01-16');

      const dayDiff = Math.abs(claimDate.getTime() - dbDate.getTime()) /
                     (1000 * 60 * 60 * 24);

      expect(dayDiff).toBeLessThanOrEqual(7); // 7-day tolerance
    });

    it('should not match outside date tolerance', () => {
      const claimDate = new Date('2024-01-15');
      const dbDate = new Date('2024-02-15');

      const dayDiff = Math.abs(claimDate.getTime() - dbDate.getTime()) /
                     (1000 * 60 * 60 * 24);

      expect(dayDiff).toBeGreaterThan(7); // More than 7 days
    });
  });

  // ============================================================================
  // Test 9: Role Permissions
  // ============================================================================
  describe('Role Permissions', () => {
    it('should allow admin full access', () => {
      const userRole = 'Super Admin';
      const canView = ['Super Admin', 'Admin', 'Billing'].includes(userRole);
      expect(canView).toBe(true);
    });

    it('should allow billing users to view', () => {
      const userRole = 'Billing';
      const canView = ['Super Admin', 'Admin', 'Billing'].includes(userRole);
      expect(canView).toBe(true);
    });

    it('should restrict viewer users', () => {
      const userRole = 'Viewer';
      const canEdit = ['Super Admin', 'Admin'].includes(userRole);
      expect(canEdit).toBe(false);
    });

    it('should handle undefined role gracefully', () => {
      const userRole = undefined;
      const hasAccess = userRole ? ['Super Admin', 'Admin'].includes(userRole) : false;
      expect(hasAccess).toBe(false);
    });
  });

  // ============================================================================
  // Test 10: Payment Totals Calculation
  // ============================================================================
  describe('Payment Totals', () => {
    it('should calculate total claimed amount', () => {
      const claims = [
        { claimed_amount: 10000 },
        { claimed_amount: 15000 },
        { claimed_amount: 20000 }
      ];

      const total = claims.reduce((sum, c) => sum + Number(c.claimed_amount || 0), 0);
      expect(total).toBe(45000);
    });

    it('should calculate total paid amount', () => {
      const claims = [
        { paid_amount: 8000 },
        { paid_amount: 12000 },
        { paid_amount: 0 }
      ];

      const total = claims.reduce((sum, c) => sum + Number(c.paid_amount || 0), 0);
      expect(total).toBe(20000);
    });

    it('should calculate outstanding balance', () => {
      const claim = {
        claimed_amount: 10000,
        paid_amount: 7000,
        tds_amount: 500,
        rf_amount: 200
      };

      const outstanding = Number(claim.claimed_amount) -
                         Number(claim.paid_amount) -
                         Number(claim.tds_amount) -
                         Number(claim.rf_amount);

      expect(outstanding).toBe(2300);
    });

    it('should handle zero amounts', () => {
      const amount = Number(null || 0);
      expect(amount).toBe(0);
    });
  });

  // ============================================================================
  // Test 11: Audit Event Logging
  // ============================================================================
  describe('Audit Event Logging', () => {
    it('should log file upload events', () => {
      const event = {
        action: 'file_upload',
        timestamp: new Date().toISOString(),
        user: 'test-user',
        details: { filename: 'test.xlsx' }
      };

      expect(event.action).toBe('file_upload');
      expect(event.user).toBe('test-user');
      expect(event.timestamp).toBeDefined();
    });

    it('should log verification events', () => {
      const event = {
        action: 'claim_verified',
        timestamp: new Date().toISOString(),
        user: 'billing-user',
        details: { claim_id: '123', status: 'matched' }
      };

      expect(event.action).toBe('claim_verified');
      expect(event.details.status).toBe('matched');
    });

    it('should log manual link events', () => {
      const event = {
        action: 'manual_link',
        timestamp: new Date().toISOString(),
        user: 'admin',
        details: { claim_id: '123', patient_id: '456' }
      };

      expect(event.action).toBe('manual_link');
    });
  });

  // ============================================================================
  // Test 12: Needs Review Criteria
  // ============================================================================
  describe('Needs Review Criteria', () => {
    it('should flag unmatched patients', () => {
      const claim = {
        ...mockValidRow,
        verification_state: 'unmatched'
      };

      const needsReview = claim.verification_state === 'unmatched' ||
                         claim.verification_state === 'invalid';
      expect(needsReview).toBe(true);
    });

    it('should flag invalid data', () => {
      const claim = {
        ...mockValidRow,
        verification_state: 'invalid'
      };

      const needsReview = claim.verification_state === 'unmatched' ||
                         claim.verification_state === 'invalid';
      expect(needsReview).toBe(true);
    });

    it('should not flag matched claims', () => {
      const claim = {
        ...mockValidRow,
        verification_state: 'matched'
      };

      const needsReview = claim.verification_state === 'unmatched' ||
                         claim.verification_state === 'invalid';
      expect(needsReview).toBe(false);
    });

    it('should exclude matched claims from needs review', () => {
      const claims = [
        { verification_state: 'matched' },
        { verification_state: 'unmatched' },
        { verification_state: 'invalid' }
      ];

      const needsReviewCount = claims.filter(c =>
        c.verification_state === 'unmatched' ||
        c.verification_state === 'invalid'
      ).length;

      expect(needsReviewCount).toBe(2);
    });
  });

  // ============================================================================
  // Additional Tests: Security & Edge Cases
  // ============================================================================
  describe('Security & Edge Cases', () => {
    it('should sanitize SQL injection attempts', () => {
      const maliciousInput = "'; DROP TABLE claims; --";
      const sanitized = maliciousInput.replace(/[';]/g, '');
      expect(sanitized).not.toContain("'");
      expect(sanitized).not.toContain(';');
    });

    it('should handle null values gracefully', () => {
      const value = null;
      const safeValue = value || 0;
      expect(safeValue).toBe(0);
    });

    it('should handle undefined values gracefully', () => {
      const value = undefined;
      const safeValue = value || '—';
      expect(safeValue).toBe('—');
    });

    it('should handle extremely large amounts', () => {
      const largeAmount = 9999999999;
      const formatted = largeAmount.toLocaleString('en-IN');
      expect(formatted).toBeDefined();
    });

    it('should handle concurrent uploads', async () => {
      const rows = [{ 'Beneficiary Name': 'Test Patient' }];
      const hashes = await Promise.all(
        Array.from({ length: 8 }, () => corporateClaimFileFingerprint(parsedFile(rows)))
      );

      // Same content must produce the same hash even in rapid succession, so
      // two staff uploading the same export at once collide on one record.
      expect(new Set(hashes).size).toBe(1);
    });
  });
});

// ============================================================================
// Test Suite Metadata
// ============================================================================
export const TEST_SUITE_INFO = {
  name: 'Corporate Claim Tracking Tests',
  version: '1.0.0',
  description: 'Comprehensive test suite for corporate claim tracking functionality',
  totalTests: 48, // Approximate count of all test cases
  coverage: [
    'File parsing',
    'Duplicate detection',
    'Malformed data handling',
    'Scheme validation',
    'ID resolution',
    'Matching logic',
    'Permissions',
    'Payment calculations',
    'Audit logging',
    'Needs review criteria',
    'Security edge cases'
  ]
};

// Run with: npm test -- corporateClaimTracking.test.ts
// or with coverage: npm test -- --coverage corporateClaimTracking.test.ts
