import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const nodeStyle = (bg: string, border: string) => ({
  background: bg,
  border: `1.5px solid ${border}`,
  borderRadius: 10,
  padding: '10px 18px',
  fontSize: 12,
  fontWeight: 600,
  color: '#1e293b',
  boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
  minWidth: 180,
  textAlign: 'center' as const,
  whiteSpace: 'pre-line' as const,
});

const CX = 400;
const DX = 170;

const initialNodes: Node[] = [
  // Row 1 — Triggers
  { id: 'trig_monthly',  position: { x: CX - DX * 2.4, y: 0 },   data: { label: '📅 1st of Month\nMonthly Billing Summary' }, style: nodeStyle('#eff6ff', '#93c5fd') },
  { id: 'trig_friday',   position: { x: CX - DX * 0.8, y: 0 },   data: { label: '📅 Every Friday\nPayment Reminder' },        style: nodeStyle('#eff6ff', '#93c5fd') },
  { id: 'trig_5th',      position: { x: CX + DX * 0.8, y: 0 },   data: { label: '📅 5th of Month\nClaim Intimation' },        style: nodeStyle('#eff6ff', '#93c5fd') },
  { id: 'trig_manual',   position: { x: CX + DX * 2.4, y: 0 },   data: { label: '🖱️ Manual Send\nStaff clicks Send Now' },    style: nodeStyle('#eff6ff', '#93c5fd') },

  // Row 2 — Fetch
  { id: 'fetch',    position: { x: CX - 100, y: 140 }, data: { label: '🏢 Fetch Corporate List\nSupabase → companies with email' }, style: nodeStyle('#f8fafc', '#cbd5e1') },

  // Row 3 — Build
  { id: 'build',    position: { x: CX - 100, y: 270 }, data: { label: '📝 Build Email Template\nApply: {corporate_name}, {contact_person}, {month}' }, style: nodeStyle('#f8fafc', '#cbd5e1') },

  // Row 4 — Open client
  { id: 'mailto',   position: { x: CX - 100, y: 400 }, data: { label: '📨 Open Email Client (mailto:)\nGmail / Outlook — BCC all pre-filled' }, style: nodeStyle('#f8fafc', '#cbd5e1') },

  // Row 5 — Human step (amber)
  { id: 'staff',    position: { x: CX - 100, y: 530 }, data: { label: '👤 Staff Clicks Send\nHuman step — reviews & sends from inbox' }, style: nodeStyle('#fffbeb', '#fcd34d') },

  // Row 6 — Log (green)
  { id: 'log',      position: { x: CX - 100, y: 660 }, data: { label: '✅ Log to email_logs\nSupabase → status: queued' }, style: nodeStyle('#f0fdf4', '#86efac') },

  // Row 7 — Done (emerald)
  { id: 'done',     position: { x: CX - 100, y: 790 }, data: { label: '🎉 Email Delivered\nCorporate receives the email' }, style: nodeStyle('#ecfdf5', '#34d399') },
];

const e = (id: string, src: string, tgt: string, color = '#94a3b8', dash = '') => ({
  id, source: src, target: tgt,
  style: { stroke: color, strokeWidth: 2, ...(dash ? { strokeDasharray: dash } : {}) },
  animated: false,
});

const initialEdges: Edge[] = [
  e('e1', 'trig_monthly', 'fetch'),
  e('e2', 'trig_friday',  'fetch'),
  e('e3', 'trig_5th',     'fetch'),
  e('e4', 'trig_manual',  'fetch'),
  e('e5', 'fetch',   'build'),
  e('e6', 'build',   'mailto'),
  e('e7', 'mailto',  'staff',  '#f59e0b', '5 4'),
  e('e8', 'staff',   'log'),
  e('e9', 'log',     'done',   '#22c55e'),
];

export default function EmailAutomationWorkflow() {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  return (
    <div>
      {/* Legend */}
      <div className="flex flex-wrap gap-3 mb-3 px-1">
        {[
          { color: '#93c5fd', bg: '#eff6ff',  label: 'Trigger (auto or manual)' },
          { color: '#cbd5e1', bg: '#f8fafc',  label: 'Process step' },
          { color: '#fcd34d', bg: '#fffbeb',  label: 'Human action required' },
          { color: '#86efac', bg: '#f0fdf4',  label: 'Logged to database' },
          { color: '#34d399', bg: '#ecfdf5',  label: 'Completed' },
        ].map(l => (
          <span key={l.label} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span style={{ background: l.bg, border: `1.5px solid ${l.color}`, borderRadius: 4, width: 14, height: 14, display: 'inline-block' }} />
            {l.label}
          </span>
        ))}
      </div>

      <div style={{ width: '100%', height: 580, borderRadius: 12, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
        <ReactFlow
          nodes={nodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          fitView fitViewOptions={{ padding: 0.12 }}
          minZoom={0.25} maxZoom={1.5}
          attributionPosition="bottom-right"
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#e2e8f0" />
          <Controls />
          <MiniMap
            nodeColor={n => (n.style as { background?: string })?.background ?? '#f1f5f9'}
            maskColor="rgba(255,255,255,0.7)" style={{ borderRadius: 8 }}
          />
        </ReactFlow>
      </div>
    </div>
  );
}
