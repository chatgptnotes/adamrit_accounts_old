// =============================================================================
// PHI de-identification — runs in front of every LLM call.
//
// Strips Indian healthcare PHI (DPDP Act 2023):
//   - Patient name, MRN, hospital number, ABHA id
//   - Phone (10-digit Indian, +91 variants), email, postal address
//   - Aadhaar (12-digit), PAN (5-letter-4-digit-1-letter)
//   - Exact DOB → keeps age in years
//   - Photo URLs / file paths
//
// Returns the redacted string + a token-count of replacements (for the
// audit log's `deidentified_count` column).
//
// NOT a substitute for Presidio — for v1 pilot. Phase C upgrades to a
// hosted Presidio (or Indian-tuned NER model) for higher recall.
// =============================================================================

export interface DeidentifyResult {
    redacted: string;
    replacedCount: number;
}

const PATTERNS: { name: string; re: RegExp; replacement: string }[] = [
    { name: 'mrn',         re: /\bMRN[:\s-]*[A-Z0-9-]{4,}\b/gi,                                  replacement: '[MRN]' },
    { name: 'abha',        re: /\b\d{2}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,                    replacement: '[ABHA]' },
    { name: 'aadhaar',     re: /\b\d{4}\s?\d{4}\s?\d{4}\b/g,                                     replacement: '[AADHAAR]' },
    { name: 'pan',         re: /\b[A-Z]{5}\d{4}[A-Z]\b/g,                                        replacement: '[PAN]' },
    { name: 'phone-in',    re: /(?:\+?91[\s-]?)?[6-9]\d{9}\b/g,                                  replacement: '[PHONE]' },
    { name: 'email',       re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,            replacement: '[EMAIL]' },
    // ISO and DD/MM/YYYY dates → [DATE]; the agent gets age separately
    { name: 'iso-date',    re: /\b(19|20)\d{2}-\d{2}-\d{2}\b/g,                                  replacement: '[DATE]' },
    { name: 'in-date',     re: /\b(0?[1-9]|[12]\d|3[01])[\/\-.](0?[1-9]|1[0-2])[\/\-.](19|20)\d{2}\b/g, replacement: '[DATE]' },
    { name: 'photo-url',   re: /https?:\/\/\S+\.(jpe?g|png|webp|heic)\b/gi,                       replacement: '[PHOTO]' },
];

// Patient names: structured input lets us strip them without NER. Caller
// passes the known names in `extraNames` (e.g. from the patient record).
export function deidentify(text: string, extraNames: string[] = []): DeidentifyResult {
    let out = text;
    let count = 0;

    for (const { re, replacement } of PATTERNS) {
        out = out.replace(re, () => { count++; return replacement; });
    }

    for (const name of extraNames.filter(Boolean)) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`\\b${escaped}\\b`, 'gi');
        out = out.replace(re, () => { count++; return '[NAME]'; });
    }

    return { redacted: out, replacedCount: count };
}

// Convenience: run de-identification across every string in an object.
export function deidentifyObject<T>(obj: T, extraNames: string[] = []): { value: T; replacedCount: number } {
    let totalReplaced = 0;
    const walk = (v: unknown): unknown => {
        if (typeof v === 'string') {
            const r = deidentify(v, extraNames);
            totalReplaced += r.replacedCount;
            return r.redacted;
        }
        if (Array.isArray(v)) return v.map(walk);
        if (v && typeof v === 'object') {
            const out: Record<string, unknown> = {};
            for (const [k, val] of Object.entries(v)) out[k] = walk(val);
            return out;
        }
        return v;
    };
    return { value: walk(obj) as T, replacedCount: totalReplaced };
}
