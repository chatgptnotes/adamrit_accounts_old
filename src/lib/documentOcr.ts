import Tesseract from 'tesseract.js';

export interface ExtractedPatientData {
  name?: string;
  age?: string;
  dob?: string;
  gender?: string;
  phone?: string;
  address?: string;
}

export async function extractTextFromImage(
  file: File,
  onProgress?: (pct: number) => void
): Promise<string> {
  const result = await Tesseract.recognize(file, 'eng', {
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    },
  });
  console.log('[OCR RAW TEXT]\n', result.data.text);
  return result.data.text;
}

export function parsePatientData(text: string): ExtractedPatientData {
  const data: ExtractedPatientData = {};
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // Phone — 10-digit Indian mobile
  const phoneMatch = text.match(/(?:^|\D)((?:6|7|8|9)\d{9})(?:\D|$)/m);
  if (phoneMatch) data.phone = phoneMatch[1];

  // DOB — DD/MM/YYYY or DD-MM-YYYY
  const dobMatch = text.match(/\b(\d{2})[\/\-](\d{2})[\/\-](\d{4})\b/);
  if (dobMatch) {
    data.dob = `${dobMatch[3]}-${dobMatch[2]}-${dobMatch[1]}`; // YYYY-MM-DD
    // Derive age from DOB
    const birthYear = parseInt(dobMatch[3]);
    const currentYear = new Date().getFullYear();
    if (birthYear > 1900 && birthYear <= currentYear) {
      data.age = String(currentYear - birthYear);
    }
  }

  // Age — standalone "Age: 34" or "34 Years"
  if (!data.age) {
    const ageMatch = text.match(/\bage[:\s]+(\d{1,3})\b/i) || text.match(/\b(\d{1,3})\s*(?:yrs?|years?)\b/i);
    if (ageMatch) data.age = ageMatch[1];
  }

  // Gender
  if (/\b(male|MALE|M)\b/.test(text) && !/female/i.test(text)) data.gender = 'Male';
  else if (/\b(female|FEMALE|F)\b/.test(text)) data.gender = 'Female';

  const BLACKLIST = [
    'government', 'india', 'unique', 'identification', 'authority', 'uidai',
    'aadhaar', 'aadhar', 'republic', 'income', 'tax', 'pan', 'card',
    'driving', 'licence', 'license', 'passport', 'voter', 'election',
    'commission', 'state', 'district', 'address', 'date', 'birth',
    'male', 'female', 'dob', 'year', 'valid', 'issue', 'expiry',
    'download', 'enrolment', 'enrollment', 'digitally', 'signed',
  ];

  const isBlacklisted = (line: string) =>
    BLACKLIST.some((w) => line.toLowerCase().includes(w));

  // A real name: 2-4 words, each word 3+ chars, no digits, not blacklisted
  const isValidName = (line: string) => {
    if (!line || line.length < 5 || line.length > 55) return false;
    if (/\d/.test(line)) return false;
    if (isBlacklisted(line)) return false;
    const words = line.trim().split(/\s+/);
    if (words.length < 2 || words.length > 4) return false;
    return words.every((w) => w.length >= 3);
  };

  // Strategy 1: explicit "Name:" label
  const nameLabelMatch = text.match(/(?:^|\n)\s*(?:name|patient\s*name)\s*[:\-]\s*([A-Za-z][A-Za-z\s\.]{4,40})/im);
  if (nameLabelMatch) {
    const candidate = cleanName(nameLabelMatch[1]);
    if (isValidName(candidate)) data.name = candidate;
  }

  // Strategy 2 (Aadhaar back): name sits just BEFORE "DOB:" line
  if (!data.name && dobMatch) {
    const dobRaw = `${dobMatch[1]}/${dobMatch[2]}/${dobMatch[3]}`;
    const dobIdx = lines.findIndex((l) => l.includes(dobRaw) || /dob|date of birth|जन्म/i.test(l));
    if (dobIdx > 0) {
      for (let i = dobIdx - 1; i >= Math.max(0, dobIdx - 4); i--) {
        const candidate = cleanName(lines[i]);
        if (isValidName(candidate)) {
          data.name = candidate;
          break;
        }
      }
    }
  }

  // Strategy 3 (Aadhaar front): name sits just BEFORE "S/O", "D/O", "W/O", "O/O", "C/O"
  if (!data.name) {
    const relIdx = lines.findIndex((l) => /^[SDWCO]\/O[:\s]/i.test(l));
    if (relIdx > 0) {
      for (let i = relIdx - 1; i >= Math.max(0, relIdx - 3); i--) {
        const candidate = cleanName(lines[i]);
        if (isValidName(candidate)) {
          data.name = candidate;
          break;
        }
      }
    }
  }

  // Strategy 4: first ALL-CAPS multi-word line (common on Aadhaar)
  if (!data.name) {
    for (const line of lines.slice(2)) {
      if (/^[A-Z]{3,}(?: [A-Z]{3,})+$/.test(line) && isValidName(line)) {
        data.name = cleanName(line);
        break;
      }
    }
  }

  // Address — everything after "Address:" keyword
  const addrMatch = text.match(/address[:\s]+(.+?)(?:\n\n|\bpin\b|\bphone\b|$)/is);
  if (addrMatch) data.address = addrMatch[1].replace(/\n/g, ', ').trim();

  return data;
}

function cleanName(raw: string): string {
  return raw
    .replace(/[^A-Za-z\s\.]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 60);
}
