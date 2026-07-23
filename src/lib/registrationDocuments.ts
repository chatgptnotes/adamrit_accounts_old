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

const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

export function getCorporateRegistrationDocuments(corporate: string): string[] {
  const normalizedCorporate = normalize(corporate);
  if (!normalizedCorporate) return [];

  for (const [name, documents] of Object.entries(CORPORATE_REGISTRATION_DOCUMENTS)) {
    const aliases = [name, ...(CORPORATE_NAME_ALIASES[name] || [])];
    if (aliases.some((alias) => normalize(alias) === normalizedCorporate)) {
      const uniqueDocuments = new Map<string, string>();
      for (const document of documents) {
        const key = normalize(document);
        if (!uniqueDocuments.has(key)) uniqueDocuments.set(key, document);
      }
      return [...uniqueDocuments.values()];
    }
  }
  return [];
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
