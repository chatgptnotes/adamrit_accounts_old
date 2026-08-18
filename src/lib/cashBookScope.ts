/**
 * Which transactions belong to which company, for the Cash Book.
 *
 * THE BUG THIS REPLACES. The screen turned the selected company into a hospital
 * name by reading `company_key` and using it as-is. But the keys are
 * `hope_pharmacy`, `drm_pvt_ltd`, `ayushman_nagpur`, `ml_enterprises`, while
 * every transaction table stores `hospital_name` as only ever `hope` or
 * `ayushman`. So choosing a company filtered on a value no row has ever held:
 * DRM Hope came back completely empty, and the only setting that showed
 * anything was "All Companies" -- which is why everything looked clubbed
 * together (reported by the owner 18-Aug with screenshots).
 *
 * A company is NOT a hospital. Two of them keep their books over the same
 * hospital's patients, and the pharmacy is its own company sharing Hope's
 * building, so the mapping has to say which SOURCES each company owns, not
 * just which hospital it sits in.
 */

export type CashBookScope = {
  /** The hospital_name transaction rows carry, or null when this company has none. */
  hospitalName: string | null;
  /** Advance / final payments and payment vouchers. */
  includeHospital: boolean;
  /** Pharmacy sales, credit settlements and refunds. */
  includePharmacy: boolean;
};

/** Both hospitals, every source — what "All Companies" means. */
export const ALL_COMPANIES_SCOPE: CashBookScope = {
  hospitalName: null,
  includeHospital: true,
  includePharmacy: true,
};

const BY_KEY: Readonly<Record<string, CashBookScope>> = {
  ayushman_nagpur: { hospitalName: 'ayushman', includeHospital: true, includePharmacy: false },
  // Hope's patients are billed by DRM Hope Pvt Ltd; the legacy partnership is
  // the same hospital's older book and is no longer active.
  drm_pvt_ltd: { hospitalName: 'hope', includeHospital: true, includePharmacy: false },
  hope_partnership: { hospitalName: 'hope', includeHospital: true, includePharmacy: false },
  // The pharmacy is its own company. Its rows carry hospital_name 'hope'
  // because it stands in Hope's building, which is exactly why it used to be
  // swallowed into Hope's totals -- so it takes the pharmacy sources and
  // explicitly none of the hospital ones.
  hope_pharmacy: { hospitalName: 'hope', includeHospital: false, includePharmacy: true },
  // No cash counter: M.L. Enterprises invoices and is paid through the books,
  // it never takes money over a counter.
  ml_enterprises: { hospitalName: null, includeHospital: false, includePharmacy: false },
};

/**
 * The scope for a selected company.
 *
 * @param companyKey  companies.company_key, or empty for "All Companies"
 * @param fallbackHospital the signed-in hospital, used when nothing is selected
 */
export function cashBookScope(
  companyKey: string | null | undefined,
  fallbackHospital: string,
): CashBookScope {
  const key = String(companyKey || '').trim().toLowerCase();
  if (!key) {
    return { hospitalName: fallbackHospital, includeHospital: true, includePharmacy: true };
  }
  return (
    BY_KEY[key] ?? {
      // An unknown company shows nothing rather than everything. A cash screen
      // that quietly widens its scope is how one company's takings get read as
      // another's.
      hospitalName: null,
      includeHospital: false,
      includePharmacy: false,
    }
  );
}

/**
 * The hospital name to hand the transaction queries.
 *
 * Returns a value that matches no row when this company owns no hospital
 * transactions, so the query comes back empty instead of being widened.
 */
export const NO_HOSPITAL_SENTINEL = '__no_hospital__';

export function hospitalFilterFor(scope: CashBookScope, fallbackHospital: string): string {
  if (!scope.includeHospital) return NO_HOSPITAL_SENTINEL;
  return scope.hospitalName ?? fallbackHospital;
}
