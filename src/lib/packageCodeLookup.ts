import { supabase } from '@/integrations/supabase/client';

export type PackageCodeOption = {
  code?: string | null;
  name?: string | null;
  label?: string | null;
};

const CODE_PATTERN = '[A-Z]{1,4}\\d{2,4}[A-Z]*(?:MH)?';

export const normalizePackageLookupValue = (value?: string | null) =>
  String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export const derivePackageCodeFromName = (packageName?: string | null) => {
  const value = String(packageName || '').trim();
  if (!value) return null;

  const leadingCodes = value.match(new RegExp(`^(${CODE_PATTERN}(?:(?:\\s*[,|]\\s*)${CODE_PATTERN})*)\\b`, 'i'))?.[1];
  if (leadingCodes) {
    return leadingCodes
      .split(/[,|]/)
      .map((part) => part.trim().toUpperCase())
      .filter(Boolean)
      .join(' | ');
  }

  return null;
};

export const buildPackageCodeLookupMap = (packages: PackageCodeOption[]) => {
  const byName = new Map<string, string>();
  packages.forEach((pkg) => {
    const name = pkg.name || '';
    const key = normalizePackageLookupValue(name);
    if (!key || byName.has(key)) return;
    const code = String(pkg.code || derivePackageCodeFromName(name) || '').trim();
    if (code) byName.set(key, code);
  });
  return byName;
};

export const resolvePackageCodeFromOptions = (
  packageName?: string | null,
  packages: PackageCodeOption[] | Map<string, string> = [],
) => {
  const derived = derivePackageCodeFromName(packageName);
  if (derived) return derived;

  const key = normalizePackageLookupValue(packageName);
  if (!key) return null;

  if (packages instanceof Map) return packages.get(key) || null;
  return buildPackageCodeLookupMap(packages).get(key) || null;
};

async function fetchPackageCodeFromMasters(packageName: string): Promise<string | null> {
  const search = packageName.trim();
  if (!search) return null;

  const [pmjayExact, yojanaPackageExact, yojanaProcedureExact, yojanaLabelExact] = await Promise.all([
    supabase
      .from('pmjay_mjpjay_packages' as any)
      .select('treatment_code, treatment_plan')
      .ilike('treatment_plan', search)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle(),
    supabase
      .from('yojana_mh_procedures' as any)
      .select('procedure_code, package_code, package_name, procedure_name, procedure_label')
      .ilike('package_name', search)
      .limit(1)
      .maybeSingle(),
    supabase
      .from('yojana_mh_procedures' as any)
      .select('procedure_code, package_code, package_name, procedure_name, procedure_label')
      .ilike('procedure_name', search)
      .limit(1)
      .maybeSingle(),
    supabase
      .from('yojana_mh_procedures' as any)
      .select('procedure_code, package_code, package_name, procedure_name, procedure_label')
      .ilike('procedure_label', search)
      .limit(1)
      .maybeSingle(),
  ]);

  const errors = [pmjayExact.error, yojanaPackageExact.error, yojanaProcedureExact.error, yojanaLabelExact.error].filter(Boolean);
  if (errors.length) throw errors[0];

  const rows = [
    pmjayExact.data ? { code: (pmjayExact.data as any).treatment_code } : null,
    yojanaPackageExact.data,
    yojanaProcedureExact.data,
    yojanaLabelExact.data,
  ].filter(Boolean) as any[];

  for (const row of rows) {
    const code = String(row.procedure_code || row.package_code || row.code || '').trim();
    if (code) return code;
  }

  return null;
}

async function fetchPackageCodeFromPortalRegistration(registrationId?: string | null): Promise<string | null> {
  const normalized = String(registrationId || '').trim();
  if (!normalized) return null;

  const { data, error } = await supabase
    .from('government_portal_report_rows' as any)
    .select('procedure_code')
    .ilike('registration_id', normalized)
    .not('procedure_code', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return String((data as any)?.procedure_code || '').trim() || null;
}

export async function resolvePackageCodeFromSavedData({
  packageName,
  registrationId,
}: {
  packageName?: string | null;
  registrationId?: string | null;
}) {
  return (
    derivePackageCodeFromName(packageName) ||
    (packageName ? await fetchPackageCodeFromMasters(packageName) : null) ||
    (await fetchPackageCodeFromPortalRegistration(registrationId))
  );
}
