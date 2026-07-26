export const REGISTRATION_DOCUMENT_CATEGORY = "registration_document" as const;

export const REGISTRATION_DOCUMENT_SECTION_LABEL = "Registration Documents";

export const CORPORATE_REGISTRATION_DOCUMENTS = {
  CGHS: ["CGHS ID Card", "Referral Letter"],
  WCL: ["Referral Letter", "Sanction Order", "Aadhaar Card"],
  SECR: ["Referral Letter", "Umeed Card", "Aadhaar Card"],
  CR: ["Referral Letter", "Umeed Card", "Aadhaar Card"],
  ECHS: ["Referral Letter", "ECHS Card", "Aadhaar Card"],
  ESIC: [
    "Referral Letter from ESIC (Original Copy with IP Signature)",
    "ESIC e-Pehchan Card",
    "Aadhaar Card or Other ID Proof (PAN Card/Driving License)",
    "HITLABH or Entitlement Form",
    "Patient Satisfaction Certificate (P-VI)",
    "Approved Extension of Stay",
    "Approval for Listed/Unlisted Procedures",
    "Condonation/Delay Waiver",
    "P2 Form/Individual Bill Format with Patient Photo & Signature",
    "Patient Photographs",
  ],
  MPKAY: [
    "Police ID",
    "Aadhaar Card",
    "Ration Card",
    "Salary Slip",
    "Voter ID",
    "Referral Letter",
  ],
  "MP Police": [
    "PAR Form",
    "Police Membership Form",
    "Portal ID",
    "Referral Letter",
  ],
  "TPA & Insurance": [
    "Policy Paper",
    "Insurance Card",
    "Aadhaar Card",
    "PAN Card",
  ],
} as const;

const CORPORATE_NAME_ALIASES: Record<string, readonly string[]> = {
  CGHS: ["Central Government Health Scheme (CGHS)"],
  WCL: ["Western Coalfield Limited (WCL)"],
  SECR: ["South Eastern Central Railway (SECR)"],
  CR: ["Central Railway", "Central Railway (CR)"],
  ECHS: ["Ex Serviceman Contributory Health Scheme (ECHS)"],
  ESIC: ["Employees State Insurance Corporation (ESIC)"],
  MPKAY: [
    "Mukhyamantri Police Karmchari Arogya Yojana",
    "Maharashtra Police Kutumb Arogya Yojana",
    "Maharashtra Police Kutumb Arogya Yojana (MPKAY)",
    "Maharashtra Police Kutumb Arogya Yojna",
    "Maharashtra Police Kutumb Arogya Yojna (MPKAY)",
    "MPKAY Scheme",
  ],
  "MP Police": ["MP Police Scheme", "Madhya Pradesh Police"],
  "TPA & Insurance": ["Insurance", "TPA", "TPA and Insurance"],
};

export type RegistrationDocumentMetadata = {
  source: "patient_registration";
  corporate: string;
  documentName: string;
};

/** The nine panels that declare mandatory registration documents. */
export type RegistrationPanelName = keyof typeof CORPORATE_REGISTRATION_DOCUMENTS;

export const REGISTRATION_PANEL_NAMES = Object.keys(
  CORPORATE_REGISTRATION_DOCUMENTS,
) as RegistrationPanelName[];

const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Trim, collapse internal whitespace, lowercase. Exported because the panel
 * document RPC normalizes corporate names and document names the same way — if
 * the two implementations drift, documents stop matching their uploads.
 */
export function normalizeCorporateName(value: string): string {
  return normalize(value);
}

/** Every `patients.corporate` spelling that resolves to this panel. */
export function getPanelCorporateSpellings(panel: RegistrationPanelName): string[] {
  return [panel, ...(CORPORATE_NAME_ALIASES[panel] || [])];
}

/**
 * Resolve a free-text `patients.corporate` to its panel, or null when no alias
 * matches. Matching is exact (after normalizing), so an unlisted spelling
 * yields null rather than a near-miss — see findUnmappedPanelCorporates in
 * src/lib/panelDocumentsDb.ts for the diagnostic that surfaces those.
 */
export function resolveRegistrationPanel(corporate: string): RegistrationPanelName | null {
  const normalizedCorporate = normalize(corporate);
  if (!normalizedCorporate) return null;

  for (const panel of REGISTRATION_PANEL_NAMES) {
    const aliases = getPanelCorporateSpellings(panel);
    if (aliases.some((alias) => normalize(alias) === normalizedCorporate)) return panel;
  }
  return null;
}

export function getCorporateRegistrationDocuments(corporate: string): string[] {
  const panel = resolveRegistrationPanel(corporate);
  if (!panel) return [];

  const uniqueDocuments = new Map<string, string>();
  for (const document of CORPORATE_REGISTRATION_DOCUMENTS[panel]) {
    const key = normalize(document);
    if (!uniqueDocuments.has(key)) uniqueDocuments.set(key, document);
  }
  return [...uniqueDocuments.values()];
}

export function buildRegistrationDocumentNotes(metadata: RegistrationDocumentMetadata): string {
  return JSON.stringify(metadata);
}

export function parseRegistrationDocumentNotes(notes: string | null | undefined): RegistrationDocumentMetadata | null {
  if (!notes) return null;
  try {
    const parsed = JSON.parse(notes) as Partial<RegistrationDocumentMetadata>;
    if (
      parsed?.source === "patient_registration" &&
      typeof parsed.corporate === "string" &&
      typeof parsed.documentName === "string"
    ) {
      return {
        source: "patient_registration",
        corporate: parsed.corporate,
        documentName: parsed.documentName,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function getRegistrationDocumentDisplayName(
  category: string | null | undefined,
  fileName: string | null | undefined,
  notes: string | null | undefined,
): string {
  if (category === REGISTRATION_DOCUMENT_CATEGORY) {
    const parsed = parseRegistrationDocumentNotes(notes);
    if (parsed?.documentName) return parsed.documentName;
  }
  return fileName || "Document";
}
