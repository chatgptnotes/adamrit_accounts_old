import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Filter, CheckCircle2 } from 'lucide-react';
import type { FlowNodeData } from '@/lib/taskOptimizerFlows';

function getMessage(data: FlowNodeData): string {
  const c = data.config as unknown as Record<string, unknown>;
  if (data.kind === 'trigger') return `Fires when: status → ${c.toStatus ?? 'any'}`;
  if (data.kind === 'condition') return `Only if: ${c.field} = "${c.value}"`;
  if (data.kind === 'action') {
    const msg = String(c.message ?? '');
    return msg.length > 100 ? msg.slice(0, 100) + '…' : msg;
  }
  return '';
}

const HANDLE_BASE = '!h-3.5 !w-3.5 !border-2 !border-white !rounded-full !shadow-sm';

// ── Trigger Node ────────────────────────────────────────────────────
function TriggerNode({ data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  return (
    <div className={`w-[240px] rounded-2xl border-2 border-amber-300 bg-gradient-to-br from-amber-400 to-amber-500 shadow-lg transition-all ${selected ? 'ring-2 ring-amber-400 ring-offset-2' : 'hover:shadow-xl hover:-translate-y-0.5'}`}>
      <Handle type="source" position={Position.Bottom} className={`${HANDLE_BASE} !bg-amber-500`} />
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20 text-xl">
          ⚡
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-amber-100">When</p>
          <p className="text-sm font-bold text-white leading-snug">{d.label}</p>
        </div>
      </div>
    </div>
  );
}

// ── Condition Node ──────────────────────────────────────────────────
function ConditionNode({ data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  return (
    <div className={`w-[240px] rounded-2xl border-2 border-violet-300 bg-gradient-to-br from-violet-500 to-violet-600 shadow-lg transition-all ${selected ? 'ring-2 ring-violet-400 ring-offset-2' : 'hover:shadow-xl hover:-translate-y-0.5'}`}>
      <Handle type="target" position={Position.Top} className={`${HANDLE_BASE} !bg-violet-500`} />
      <Handle type="source" position={Position.Bottom} className={`${HANDLE_BASE} !bg-violet-500`} />
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20">
          <Filter className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-violet-100">Only if</p>
          <p className="text-sm font-bold text-white leading-snug">{d.label}</p>
        </div>
      </div>
    </div>
  );
}

// ── Action Node ─────────────────────────────────────────────────────
function ActionNode({ data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  const msg = getMessage(d);
  return (
    <div className={`w-[260px] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-md transition-all ${selected ? 'ring-2 ring-primary ring-offset-2 shadow-lg' : 'hover:shadow-lg hover:-translate-y-0.5'}`}>
      <Handle type="target" position={Position.Top} className={`${HANDLE_BASE} !bg-emerald-400`} />
      <Handle type="source" position={Position.Bottom} className={`${HANDLE_BASE} !bg-emerald-400`} />
      <div className="flex items-start gap-3 px-3 py-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 mt-0.5">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        </div>
        <div className="space-y-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800 leading-snug">{d.label}</p>
          {msg && <p className="text-[11px] text-gray-500 leading-relaxed">{msg}</p>}
        </div>
      </div>
    </div>
  );
}

export const flowNodeTypes = {
  trigger: TriggerNode,
  condition: ConditionNode,
  action: ActionNode,
};
