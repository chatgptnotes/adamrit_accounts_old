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
    if (normalize(name) === normalizedCorporate) {
      return [...documents];
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
