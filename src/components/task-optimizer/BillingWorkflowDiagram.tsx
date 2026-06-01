import { useCallback } from 'react';
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

const nodeStyle = (color: string) => ({
  background: color,
  border: '1.5px solid #e2e8f0',
  borderRadius: 10,
  padding: '10px 18px',
  fontSize: 13,
  fontWeight: 600,
  color: '#1e293b',
  boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
  minWidth: 160,
  textAlign: 'center' as const,
});

const initialNodes: Node[] = [
  // Row 0 — start
  { id: 'visit', position: { x: 400, y: 0 }, data: { label: '🏥 Patient Visit' }, style: nodeStyle('#dbeafe') },

  // Row 1 — OPD / IPD split
  { id: 'opd', position: { x: 120, y: 100 }, data: { label: '🪑 OPD Consultation' }, style: nodeStyle('#f0fdf4') },
  { id: 'ipd', position: { x: 520, y: 100 }, data: { label: '🛏️ IPD Admission' }, style: nodeStyle('#f0fdf4') },

  // Row 2 — Services
  { id: 'lab', position: { x: 0, y: 220 }, data: { label: '🧪 Lab Tests' }, style: nodeStyle('#fefce8') },
  { id: 'pharma', position: { x: 200, y: 220 }, data: { label: '💊 Pharmacy' }, style: nodeStyle('#fefce8') },
  { id: 'radiology', position: { x: 400, y: 220 }, data: { label: '📡 Radiology' }, style: nodeStyle('#fefce8') },
  { id: 'ot', position: { x: 620, y: 220 }, data: { label: '🔪 Operation Theatre' }, style: nodeStyle('#fefce8') },
  { id: 'dialysis', position: { x: 820, y: 220 }, data: { label: '🫀 Dialysis / NephroPlus' }, style: nodeStyle('#fefce8') },

  // Row 3 — Final Bill
  { id: 'finalbill', position: { x: 340, y: 360 }, data: { label: '🧾 Final Bill Generated' }, style: nodeStyle('#ede9fe') },

  // Row 4 — Intimation
  { id: 'intimation', position: { x: 340, y: 460 }, data: { label: '📨 Intimation to Corporate' }, style: nodeStyle('#fce7f3') },

  // Row 5 — Bill Submission
  { id: 'submission', position: { x: 340, y: 560 }, data: { label: '📤 Bill Submitted' }, style: nodeStyle('#dbeafe') },

  // Row 6 — Submission sub-statuses
  { id: 'dsc', position: { x: 100, y: 670 }, data: { label: '✅ DSC Done' }, style: nodeStyle('#f0fdf4') },
  { id: 'couriered', position: { x: 340, y: 670 }, data: { label: '📦 Couriered' }, style: nodeStyle('#f0fdf4') },
  { id: 'not_couriered', position: { x: 580, y: 670 }, data: { label: '🕐 Not Yet Couriered' }, style: nodeStyle('#fefce8') },

  // Row 7 — Payment Expected
  { id: 'payment_expected', position: { x: 340, y: 790 }, data: { label: '⏳ Payment Expected' }, style: nodeStyle('#fefce8') },

  // Row 8 — Payment outcomes
  { id: 'payment_received', position: { x: 160, y: 900 }, data: { label: '✅ Payment Received' }, style: nodeStyle('#dcfce7') },
  { id: 'deduction', position: { x: 520, y: 900 }, data: { label: '⚠️ Deduction / Dispute' }, style: nodeStyle('#fee2e2') },

  // Row 9 — Complete
  { id: 'completed', position: { x: 160, y: 1010 }, data: { label: '🏆 Bill Completed' }, style: nodeStyle('#d1fae5') },
  { id: 'resolved', position: { x: 520, y: 1010 }, data: { label: '🔄 Dispute Resolved' }, style: nodeStyle('#fef9c3') },
];

const edgeStyle = { stroke: '#94a3b8', strokeWidth: 2 };
const initialEdges: Edge[] = [
  // visit → opd/ipd
  { id: 'e-visit-opd', source: 'visit', target: 'opd', style: edgeStyle },
  { id: 'e-visit-ipd', source: 'visit', target: 'ipd', style: edgeStyle },

  // services from opd
  { id: 'e-opd-lab', source: 'opd', target: 'lab', style: edgeStyle },
  { id: 'e-opd-pharma', source: 'opd', target: 'pharma', style: edgeStyle },
  { id: 'e-opd-radiology', source: 'opd', target: 'radiology', style: edgeStyle },

  // services from ipd
  { id: 'e-ipd-lab', source: 'ipd', target: 'lab', style: { ...edgeStyle, strokeDasharray: '4 3' } },
  { id: 'e-ipd-pharma', source: 'ipd', target: 'pharma', style: { ...edgeStyle, strokeDasharray: '4 3' } },
  { id: 'e-ipd-radiology', source: 'ipd', target: 'radiology', style: { ...edgeStyle, strokeDasharray: '4 3' } },
  { id: 'e-ipd-ot', source: 'ipd', target: 'ot', style: edgeStyle },
  { id: 'e-ipd-dialysis', source: 'ipd', target: 'dialysis', style: edgeStyle },

  // services → final bill
  { id: 'e-lab-bill', source: 'lab', target: 'finalbill', style: edgeStyle },
  { id: 'e-pharma-bill', source: 'pharma', target: 'finalbill', style: edgeStyle },
  { id: 'e-radiology-bill', source: 'radiology', target: 'finalbill', style: edgeStyle },
  { id: 'e-ot-bill', source: 'ot', target: 'finalbill', style: edgeStyle },
  { id: 'e-dialysis-bill', source: 'dialysis', target: 'finalbill', style: edgeStyle },

  // billing pipeline
  { id: 'e-bill-intimation', source: 'finalbill', target: 'intimation', style: edgeStyle },
  { id: 'e-intimation-sub', source: 'intimation', target: 'submission', style: edgeStyle },

  // submission sub-statuses
  { id: 'e-sub-dsc', source: 'submission', target: 'dsc', style: edgeStyle },
  { id: 'e-sub-couriered', source: 'submission', target: 'couriered', style: edgeStyle },
  { id: 'e-sub-notcouriered', source: 'submission', target: 'not_couriered', style: edgeStyle },

  // → payment expected
  { id: 'e-dsc-pay', source: 'dsc', target: 'payment_expected', style: edgeStyle },
  { id: 'e-couriered-pay', source: 'couriered', target: 'payment_expected', style: edgeStyle },
  { id: 'e-notcouriered-pay', source: 'not_couriered', target: 'payment_expected', style: edgeStyle },

  // payment outcomes
  { id: 'e-pay-received', source: 'payment_expected', target: 'payment_received', style: { ...edgeStyle, stroke: '#22c55e' } },
  { id: 'e-pay-deduction', source: 'payment_expected', target: 'deduction', style: { ...edgeStyle, stroke: '#ef4444' } },

  // final
  { id: 'e-received-complete', source: 'payment_received', target: 'completed', style: { ...edgeStyle, stroke: '#22c55e' } },
  { id: 'e-deduction-resolved', source: 'deduction', target: 'resolved', style: { ...edgeStyle, stroke: '#f59e0b' } },
  { id: 'e-resolved-complete', source: 'resolved', target: 'completed', style: { ...edgeStyle, strokeDasharray: '4 3' } },
];

export default function BillingWorkflowDiagram() {
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
        fitViewOptions={{ padding: 0.15 }}
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
