import { useState, useEffect } from 'react';
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

const STATUS_COLORS: Record<string, string> = {
  todo: '#f1f5f9',
  inprogress: '#fef9c3',
  done: '#dcfce7',
};

const STATUS_BORDER: Record<string, string> = {
  todo: '#cbd5e1',
  inprogress: '#fbbf24',
  done: '#86efac',
};

type TaskStatus = 'todo' | 'inprogress' | 'done';

interface TaskNodeData {
  taskNo: number;
  title: string;
  desc: string;
  status: TaskStatus;
  emoji: string;
  onStatusChange?: (id: string, s: TaskStatus) => void;
  [key: string]: unknown;
}

function TaskCard({ data }: { data: TaskNodeData }) {
  const bg = STATUS_COLORS[data.status];
  const border = STATUS_BORDER[data.status];
  return (
    <div style={{ background: bg, border: `2px solid ${border}`, borderRadius: 10, padding: '10px 14px', minWidth: 175, maxWidth: 195, boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 18, lineHeight: 1 }}>{data.emoji}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 1 }}>Task {data.taskNo}</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', lineHeight: 1.3 }}>{data.title}</div>
        </div>
      </div>
      <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.4, marginBottom: 8 }}>{data.desc}</div>
      <select
        value={data.status}
        onChange={e => data.onStatusChange && data.onStatusChange(String(data.taskNo), e.target.value as TaskStatus)}
        style={{ fontSize: 11, padding: '2px 6px', borderRadius: 6, border: `1.5px solid ${border}`, background: 'white', color: '#334155', cursor: 'pointer', width: '100%' }}
      >
        <option value="todo">⚪ To Do</option>
        <option value="inprogress">🟡 In Progress</option>
        <option value="done">🟢 Done</option>
      </select>
    </div>
  );
}

const headerStyle = (color: string) => ({
  background: color,
  borderRadius: 10,
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 700,
  color: '#1e293b',
  boxShadow: '0 2px 6px rgba(0,0,0,0.07)',
  border: '1.5px solid #e2e8f0',
  minWidth: 150,
  textAlign: 'center' as const,
});

const TASKS = [
  { id: '1',  taskNo: 1,  emoji: '🌙', title: 'Last Night Admission',        desc: 'Verify night shift admissions, room allocation & initial billing',   status: 'todo' as TaskStatus },
  { id: '2',  taskNo: 2,  emoji: '📁', title: 'Corporate Doc Collection',    desc: 'Collect auth letters, ID proofs & insurance paperwork',              status: 'todo' as TaskStatus },
  { id: '3a', taskNo: 3,  emoji: '👍', title: 'Dialysis Morning Verify',     desc: 'Biometric thumb auth for dialysis patients — morning session',       status: 'todo' as TaskStatus },
  { id: '4',  taskNo: 4,  emoji: '📨', title: 'Corporate Intimation',        desc: 'Process new corporate referrals & notify departments',               status: 'todo' as TaskStatus },
  { id: '5',  taskNo: 5,  emoji: '🧾', title: 'Discharge Billing',           desc: "Prepare & verify final bills for today's discharges",              status: 'todo' as TaskStatus },
  { id: '6',  taskNo: 6,  emoji: '🏥', title: 'Yojana Preauth',              desc: 'Submit pre-auth requests with docs for Yojana patients',            status: 'todo' as TaskStatus },
  { id: '7',  taskNo: 7,  emoji: '📧', title: 'Mail Check & Reply',          desc: 'Monitor official email, respond to billing & admission queries',    status: 'todo' as TaskStatus },
  { id: '8',  taskNo: 8,  emoji: '🔄', title: 'Conservative Extension',      desc: 'Process extension requests for non-surgical conservative patients', status: 'todo' as TaskStatus },
  { id: '9',  taskNo: 9,  emoji: '💉', title: 'Daily Dialysis Billing',      desc: 'Generate & verify daily dialysis bills with all charges',           status: 'todo' as TaskStatus },
  { id: '10', taskNo: 10, emoji: '🏨', title: 'IPD Billing',                 desc: 'Manage complete IPD billing — verify charges before discharge',     status: 'todo' as TaskStatus },
  { id: '11', taskNo: 11, emoji: '🔍', title: 'NMI Query Follow-up',         desc: 'Review NMI queries, collect info & coordinate for resolution',      status: 'todo' as TaskStatus },
  { id: '3b', taskNo: 3,  emoji: '🌙👍', title: 'Dialysis Night Verify',    desc: 'Biometric thumb auth for dialysis patients — night session',        status: 'todo' as TaskStatus },
];

function buildNodes(statuses: Record<string, TaskStatus>, onChange: (id: string, s: TaskStatus) => void): Node[] {
  const makeTask = (t: typeof TASKS[0], x: number, y: number): Node => ({
    id: t.id,
    position: { x, y },
    type: 'default',
    data: {
      label: (
        <TaskCard data={{ ...t, status: statuses[t.id] ?? t.status, onStatusChange: onChange }} />
      ),
    },
    style: { background: 'transparent', border: 'none', padding: 0 },
  });

  return [
    // Root
    { id: 'root', position: { x: 470, y: 0 }, data: { label: '📋 Daily Billing Workflow' }, style: { background: '#dbeafe', border: '2px solid #93c5fd', borderRadius: 12, padding: '10px 20px', fontWeight: 700, fontSize: 14, boxShadow: '0 4px 12px rgba(59,130,246,0.15)', minWidth: 220, textAlign: 'center' } },

    // Section headers
    { id: 'h-night',   position: { x: 30,  y: 120 }, data: { label: '🌙 Night Review'    }, style: headerStyle('#e0e7ff') },
    { id: 'h-morning', position: { x: 260, y: 120 }, data: { label: '🌅 Morning Tasks'   }, style: headerStyle('#fef9c3') },
    { id: 'h-day',     position: { x: 560, y: 120 }, data: { label: '☀️ Day Operations'  }, style: headerStyle('#ffedd5') },
    { id: 'h-evening', position: { x: 870, y: 120 }, data: { label: '🌆 Evening Tasks'   }, style: headerStyle('#f0fdf4') },

    // Night: Task 1
    makeTask(TASKS[0], 15, 250),

    // Morning: Tasks 3a, 2, 6, 4
    makeTask(TASKS[2], 165, 250),  // 3a
    makeTask(TASKS[1], 375, 250),  // 2
    makeTask(TASKS[5], 165, 420),  // 6
    makeTask(TASKS[3], 375, 420),  // 4

    // Day: Tasks 5, 9, 10, 7, 8
    makeTask(TASKS[4], 510, 250),  // 5
    makeTask(TASKS[8], 720, 250),  // 9
    makeTask(TASKS[9], 510, 420),  // 10
    makeTask(TASKS[6], 720, 390),  // 7
    makeTask(TASKS[7], 510, 590),  // 8

    // Evening: Tasks 11, 3b
    makeTask(TASKS[10], 840, 250), // 11
    makeTask(TASKS[11], 840, 420), // 3b
  ];
}

const edgeBase = { style: { stroke: '#94a3b8', strokeWidth: 1.8 }, animated: false };
const initialEdges: Edge[] = [
  { id: 'r-hn',  source: 'root', target: 'h-night',   ...edgeBase },
  { id: 'r-hm',  source: 'root', target: 'h-morning', ...edgeBase },
  { id: 'r-hd',  source: 'root', target: 'h-day',     ...edgeBase },
  { id: 'r-he',  source: 'root', target: 'h-evening', ...edgeBase },
  { id: 'hn-1',  source: 'h-night',   target: '1',  ...edgeBase },
  { id: 'hm-3a', source: 'h-morning', target: '3a', ...edgeBase },
  { id: 'hm-2',  source: 'h-morning', target: '2',  ...edgeBase },
  { id: 'hm-6',  source: 'h-morning', target: '6',  ...edgeBase },
  { id: 'hm-4',  source: 'h-morning', target: '4',  ...edgeBase },
  { id: 'hd-5',  source: 'h-day',     target: '5',  ...edgeBase },
  { id: 'hd-9',  source: 'h-day',     target: '9',  ...edgeBase },
  { id: 'hd-10', source: 'h-day',     target: '10', ...edgeBase },
  { id: 'hd-7',  source: 'h-day',     target: '7',  ...edgeBase },
  { id: 'hd-8',  source: 'h-day',     target: '8',  ...edgeBase },
  { id: 'he-11', source: 'h-evening', target: '11', ...edgeBase },
  { id: 'he-3b', source: 'h-evening', target: '3b', ...edgeBase },
];

export default function DailyBillingWorkflow() {
  const [statuses, setStatuses] = useState<Record<string, TaskStatus>>({});
  const handleChange = (id: string, s: TaskStatus) => setStatuses(prev => ({ ...prev, [id]: s }));
  const [nodes, setNodes, onNodesChange] = useNodesState(buildNodes(statuses, handleChange));
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(buildNodes(statuses, handleChange));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statuses]);

  const done = Object.values(statuses).filter(s => s === 'done').length;
  const inprog = Object.values(statuses).filter(s => s === 'inprogress').length;
  const total = 11;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Progress bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 16px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Today's Progress — {done}/{total} tasks done</div>
          <div style={{ height: 8, background: '#e2e8f0', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(done / total) * 100}%`, background: '#22c55e', borderRadius: 999, transition: 'width 0.4s ease' }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
          <span>⚪ {total - done - inprog} to do</span>
          <span>🟡 {inprog} in progress</span>
          <span>🟢 {done} done</span>
        </div>
      </div>

      {/* Flow diagram */}
      <div style={{ width: '100%', height: 700, borderRadius: 12, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          fitView
          fitViewOptions={{ padding: 0.1 }}
          minZoom={0.25}
          maxZoom={1.5}
          attributionPosition="bottom-right"
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#e2e8f0" />
          <Controls />
          <MiniMap maskColor="rgba(255,255,255,0.7)" style={{ borderRadius: 8 }} />
        </ReactFlow>
      </div>
    </div>
  );
}
