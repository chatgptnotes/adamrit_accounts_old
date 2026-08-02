
export const ayushmanRMOFields = [
  { key: 'name', label: 'Name', type: 'text' as const, required: true },
  { key: 'daily_remuneration', label: 'Daily Remuneration (₹)', type: 'number' as const },
  { key: 'morning_rate', label: 'Morning Shift Rate (₹)', type: 'number' as const },
  { key: 'evening_rate', label: 'Evening Shift Rate (₹)', type: 'number' as const },
  { key: 'night_rate', label: 'Night Shift Rate (₹)', type: 'number' as const },
  { key: 'specialty', label: 'Specialty', type: 'text' as const },
  { key: 'department', label: 'Department', type: 'text' as const },
  { key: 'contact_info', label: 'Contact Info', type: 'text' as const },
  { key: 'tpa_rate', label: 'TPA Rate', type: 'number' as const },
  { key: 'non_nabh_rate', label: 'Non-NABH Rate', type: 'number' as const },
  { key: 'nabh_rate', label: 'NABH Rate', type: 'number' as const },
  { key: 'private_rate', label: 'Private Rate', type: 'number' as const }
];
