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

const nodeStyle = (color: string, borderColor?: string, minWidth?: number) => ({
  background: color,
  border: `1.5px solid ${borderColor ?? '#e2e8f0'}`,
  borderRadius: 10,
  padding: '10px 18px',
  fontSize: 12,
  fontWeight: 600,
  color: '#1e293b',
  boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
  minWidth: minWidth ?? 220,
  textAlign: 'center' as const,
  whiteSpace: 'pre-line' as const,
});

const CX = 480;
const DY = 130;
const DX = 240;

const initialNodes: Node[] = [
  // Level 0 — Root
  {
    id: 'root',
    position: { x: CX, y: 0 },
    data: { label: '📧 Email Workflow Automation\nRuns 2x daily — 9 AM & 5 PM IST' },
    style: { ...nodeStyle('#dbeafe', '#93c5fd', 280), fontWeight: 700 },
  },

  // Level 1 — Triggers
  {
    id: 'morning',
    position: { x: CX - DX, y: DY },
    data: { label: '🌅 Morning Check\n9:00 AM IST' },
    style: nodeStyle('#eef2ff', '#a5b4fc', 180),
  },
  {
    id: 'evening',
    position: { x: CX + DX, y: DY },
    data: { label: '🌆 Evening Check\n5:00 PM IST' },
    style: nodeStyle('#f0fdf4', '#86efac', 180),
  },

  // Level 2 — Fetch
  {
    id: 'fetch',
    position: { x: CX, y: DY * 2 },
    data: { label: '📥 Fetch Unread Emails\nGmail Inbox (last 20)' },
    style: nodeStyle('#f8fafc', '#e2e8f0'),
  },

  // Level 3 — Classify
  {
    id: 'classify',
    position: { x: CX, y: DY * 3 },
    data: { label: '🔍 Classify Each Email\nbilling • corporate • tpa • appointment • general • urgent' },
    style: nodeStyle('#f8fafc', '#e2e8f0', 320),
  },

  // Level 4 — Categories
  {
    id: 'billing',
    position: { x: CX - DX * 1.5, y: DY * 4 },
    data: { label: '💰 Billing' },
    style: nodeStyle('#dbeafe', '#93c5fd', 160),
  },
  {
    id: 'corporate',
    position: { x: CX - DX * 0.5, y: DY * 4 },
    data: { label: '🏢 Corporate' },
    style: nodeStyle('#f3e8ff', '#c084fc', 160),
  },
  {
    id: 'tpa',
    position: { x: CX + DX * 0.5, y: DY * 4 },
    data: { label: '💳 TPA/Insurance' },
    style: nodeStyle('#fff7ed', '#fdba74', 160),
  },
  {
    id: 'general',
    position: { x: CX + DX * 1.5, y: DY * 4 },
    data: { label: '📋 General' },
    style: nodeStyle('#f8fafc', '#e2e8f0', 160),
  },

  // Level 5 — Prepare Draft
  {
    id: 'draft',
    position: { x: CX, y: DY * 5 },
    data: { label: '✍️ Prepare Draft Reply\nAI generates professional response' },
    style: nodeStyle('#fffbeb', '#fcd34d'),
  },

  // Level 6 — Save
  {
    id: 'save',
    position: { x: CX, y: DY * 6 },
    data: { label: '💾 Save to email_inbox\nSupabase table — status: pending' },
    style: nodeStyle('#f8fafc', '#e2e8f0'),
  },

  // Level 7 — Approval
  {
    id: 'approval',
    position: { x: CX, y: DY * 7 },
    data: { label: '👤 Staff Review & Approval\nBilling Dashboard → Email Workflow tab' },
    style: nodeStyle('#fffbeb', '#fcd34d', 280),
  },

  // Level 8 — Outcomes
  {
    id: 'approved',
    position: { x: CX - DX, y: DY * 8 },
    data: { label: '✅ Approved\nOpen in Gmail/Outlook' },
    style: nodeStyle('#dcfce7', '#86efac', 180),
  },
  {
    id: 'rejected',
    position: { x: CX + DX, y: DY * 8 },
    data: { label: '❌ Rejected\nMarked as rejected' },
    style: nodeStyle('#fee2e2', '#fca5a5', 180),
  },

  // Level 9 — Final
  {
    id: 'sent',
    position: { x: CX - DX, y: DY * 9 },
    data: { label: '🎉 Reply Sent\nCorporate receives response' },
    style: nodeStyle('#d1fae5', '#34d399', 200),
  },
];

const edgeStyle = { stroke: '#94a3b8', strokeWidth: 1.8 };
const dashedEdgeStyle = { ...edgeStyle, strokeDasharray: '4 3' };
const approvedEdgeStyle = { stroke: '#22c55e', strokeWidth: 2 };
const rejectedEdgeStyle = { stroke: '#ef4444', strokeWidth: 2 };

const initialEdges: Edge[] = [
  // Root → triggers
  { id: 'e-root-morning', source: 'root', target: 'morning', style: edgeStyle },
  { id: 'e-root-evening', source: 'root', target: 'evening', style: edgeStyle },

  // Triggers → fetch
  { id: 'e-morning-fetch', source: 'morning', target: 'fetch', style: edgeStyle },
  { id: 'e-evening-fetch', source: 'evening', target: 'fetch', style: edgeStyle },

  // Fetch → classify
  { id: 'e-fetch-classify', source: 'fetch', target: 'classify', style: edgeStyle },

  // Classify → categories
  { id: 'e-classify-billing', source: 'classify', target: 'billing', style: edgeStyle },
  { id: 'e-classify-corporate', source: 'classify', target: 'corporate', style: edgeStyle },
  { id: 'e-classify-tpa', source: 'classify', target: 'tpa', style: edgeStyle },
  { id: 'e-classify-general', source: 'classify', target: 'general', style: edgeStyle },

  // Categories → draft (dashed merge)
  { id: 'e-billing-draft', source: 'billing', target: 'draft', style: dashedEdgeStyle },
  { id: 'e-corporate-draft', source: 'corporate', target: 'draft', style: dashedEdgeStyle },
  { id: 'e-tpa-draft', source: 'tpa', target: 'draft', style: dashedEdgeStyle },
  { id: 'e-general-draft', source: 'general', target: 'draft', style: dashedEdgeStyle },

  // Draft → save
  { id: 'e-draft-save', source: 'draft', target: 'save', style: edgeStyle },

  // Save → approval
  { id: 'e-save-approval', source: 'save', target: 'approval', style: edgeStyle },

  // Approval → outcomes
  { id: 'e-approval-approved', source: 'approval', target: 'approved', style: approvedEdgeStyle },
  { id: 'e-approval-rejected', source: 'approval', target: 'rejected', style: rejectedEdgeStyle },

  // Approved → sent
  { id: 'e-approved-sent', source: 'approved', target: 'sent', style: approvedEdgeStyle },
];

export default function EmailWorkflowDiagram() {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  return (
    <div style={{ width: '100%', height: 700, borderRadius: 12, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.3}
        maxZoom={1.5}
        attributionPosition="bottom-right"
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#e2e8f0" />
        <Controls />
        <MiniMap
          nodeColor={(n) => (n.style as { background?: string })?.background ?? '#f1f5f9'}
          maskColor="rgba(255,255,255,0.7)"
          style={{ borderRadius: 8 }}
        />
      </ReactFlow>
    </div>
  );
}
