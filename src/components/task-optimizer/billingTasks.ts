export type TaskStatus = 'todo' | 'inprogress' | 'done';

export interface BillingTask {
  id: string;
  taskNo: number;
  emoji: string;
  title: string;
  desc: string;
  shift: 'night' | 'morning' | 'day' | 'evening';
}

export const BILLING_TASKS: BillingTask[] = [
  { id: '1',  taskNo: 1,  emoji: '🌙',   title: 'Last Night Admission',     desc: 'Verify night shift admissions, room allocation & initial billing',   shift: 'night'   },
  { id: '2',  taskNo: 2,  emoji: '📁',   title: 'Corporate Doc Collection', desc: 'Collect auth letters, ID proofs & insurance paperwork',              shift: 'morning' },
  { id: '3a', taskNo: 3,  emoji: '👍',   title: 'Dialysis Morning Verify',  desc: 'Biometric thumb auth for dialysis patients — morning session',       shift: 'morning' },
  { id: '4',  taskNo: 4,  emoji: '📨',   title: 'Corporate Intimation',     desc: 'Process new corporate referrals & notify departments',               shift: 'morning' },
  { id: '5',  taskNo: 5,  emoji: '🧾',   title: 'Discharge Billing',        desc: "Prepare & verify final bills for today's discharges",               shift: 'day'     },
  { id: '6',  taskNo: 6,  emoji: '🏥',   title: 'Yojana Preauth',           desc: 'Submit pre-auth requests with docs for Yojana patients',            shift: 'morning' },
  { id: '7',  taskNo: 7,  emoji: '📧',   title: 'Mail Check & Reply',       desc: 'Monitor official email, respond to billing & admission queries',    shift: 'day'     },
  { id: '8',  taskNo: 8,  emoji: '🔄',   title: 'Conservative Extension',   desc: 'Process extension requests for non-surgical conservative patients', shift: 'day'     },
  { id: '9',  taskNo: 9,  emoji: '💉',   title: 'Daily Dialysis Billing',   desc: 'Generate & verify daily dialysis bills with all charges',           shift: 'day'     },
  { id: '10', taskNo: 10, emoji: '🏨',   title: 'IPD Billing',              desc: 'Manage complete IPD billing — verify charges before discharge',     shift: 'day'     },
  { id: '11', taskNo: 11, emoji: '🔍',   title: 'NMI Query Follow-up',      desc: 'Review NMI queries, collect info & coordinate for resolution',      shift: 'evening' },
  { id: '3b', taskNo: 3,  emoji: '🌙👍', title: 'Dialysis Night Verify',    desc: 'Biometric thumb auth for dialysis patients — night session',        shift: 'evening' },
];

export const SHIFTS = [
  { id: 'night',   label: '🌙 Night Review',    color: 'bg-indigo-50 border-indigo-200',   headerColor: 'bg-indigo-100 text-indigo-800'  },
  { id: 'morning', label: '🌅 Morning Tasks',   color: 'bg-yellow-50 border-yellow-200',   headerColor: 'bg-yellow-100 text-yellow-800'  },
  { id: 'day',     label: '☀️ Day Operations',  color: 'bg-orange-50 border-orange-200',   headerColor: 'bg-orange-100 text-orange-800'  },
  { id: 'evening', label: '🌆 Evening Tasks',   color: 'bg-green-50 border-green-200',     headerColor: 'bg-green-100 text-green-800'    },
] as const;
