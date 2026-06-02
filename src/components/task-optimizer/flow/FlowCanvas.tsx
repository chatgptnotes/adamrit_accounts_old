import { useCallback, useRef, useState, type DragEvent } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,

  MarkerType,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Node,
  type Edge,
  type DefaultEdgeOptions,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Zap, Filter, Play, Save, Trash2, ArrowLeft, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { flowNodeTypes } from './nodeTypes';
import FlowInspector from './FlowInspector';
import FlowChatbot from './FlowChatbot';
import { COMMON_TASKS } from '../commonTasks';
import type {
  FlowNodeKind,
  StoredNode,
  StoredEdge,
  FlowNodeData,
  TriggerConfig,
  ConditionConfig,
  ActionConfig,
} from '@/lib/taskOptimizerFlows';

// Default config + label for a freshly dropped node of each kind.
function defaultData(kind: FlowNodeKind): FlowNodeData {
  if (kind === 'trigger') {
    return { kind, label: 'When status changes', config: { event: 'status_changed', toStatus: 'done' } as TriggerConfig };
  }
  if (kind === 'condition') {
    return { kind, label: 'If', config: { field: 'suggestion_type', op: 'eq', value: 'automate' } as ConditionConfig };
  }
  return { kind, label: 'Notify', config: { type: 'notify', message: '{task} is {status}' } as ActionConfig };
}

const PALETTE: Array<{ kind: FlowNodeKind; label: string; Icon: typeof Zap; color: string }> = [
  { kind: 'trigger', label: 'Trigger', Icon: Zap, color: 'text-amber-600' },
  { kind: 'condition', label: 'Condition', Icon: Filter, color: 'text-violet-600' },
  { kind: 'action', label: 'Action', Icon: Play, color: 'text-emerald-600' },
];

let idCounter = 1;
const nextId = (kind: string) => `${kind}-${Date.now()}-${idCounter++}`;

// JotForm-style connectors: smooth rounded steps with an arrowhead.
const DEFAULT_EDGE_OPTIONS: DefaultEdgeOptions = {
  type: 'smoothstep',
  animated: true,
  style: { strokeWidth: 2, stroke: '#94a3b8' },
  markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8', width: 18, height: 18 },
};

// Sentinel for "applies to all staff" in the role Select (it can't take '').
const ALL_STAFF = '__all__';

export interface FlowCanvasProps {
  initialName: string;
  initialEnabled: boolean;
  initialRole: string | null;
  initialNodes: StoredNode[];
  initialEdges: StoredEdge[];
  roleOptions: string[];
  onSave: (data: { name: string; enabled: boolean; role: string | null; nodes: StoredNode[]; edges: StoredEdge[] }) => void;
  onBack: () => void;
  saving: boolean;
}

function CanvasInner({
  initialName,
  initialEnabled,
  initialRole,
  initialNodes,
  initialEdges,
  roleOptions,
  onSave,
  onBack,
  saving,
}: FlowCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialNodes as unknown as Node[]);
  // Loaded/saved edges are plain {id,source,target}; give them the styled look.
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    (initialEdges as unknown as Edge[]).map(e => ({ ...DEFAULT_EDGE_OPTIONS, ...e })),
  );
  const [name, setName] = useState(initialName);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [role, setRole] = useState<string | null>(initialRole);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Replace the canvas graph with an AI-generated one and re-centre. The
  // assistant's persona becomes this automation's role so it lands in the
  // right group when saved.
  const applyGeneratedFlow = useCallback(
    (newNodes: StoredNode[], newEdges: StoredEdge[], generatedName: string, generatedRole?: string) => {
      setNodes(newNodes as unknown as Node[]);
      setEdges((newEdges as unknown as Edge[]).map(e => ({ ...DEFAULT_EDGE_OPTIONS, ...e })));
      if (generatedName) setName(generatedName);
      if (generatedRole) setRole(generatedRole);
      setSelectedId(null);
      setTimeout(() => fitView({ padding: 0.2 }), 50);
    },
    [setNodes, setEdges, fitView],
  );

  const onConnect = useCallback(
    (c: Connection) => setEdges(eds => addEdge({ ...c, ...DEFAULT_EDGE_OPTIONS }, eds)),
    [setEdges],
  );

  const onDragStart = (e: DragEvent, kind: FlowNodeKind) => {
    e.dataTransfer.setData('application/flow-kind', kind);
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const kind = e.dataTransfer.getData('application/flow-kind') as FlowNodeKind;
      if (!kind) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const node: Node = { id: nextId(kind), type: kind, position, data: defaultData(kind) as unknown as Record<string, unknown> };
      setNodes(nds => [...nds, node]);
    },
    [screenToFlowPosition, setNodes],
  );

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  // Inspector edits a node's config in place.
  const updateNodeConfig = useCallback(
    (nodeId: string, config: StoredNode['data']['config']) => {
      setNodes(nds =>
        nds.map(n => (n.id === nodeId ? { ...n, data: { ...(n.data as FlowNodeData), config } } : n)),
      );
    },
    [setNodes],
  );

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    setNodes(nds => nds.filter(n => n.id !== selectedId));
    setEdges(eds => eds.filter(e => e.source !== selectedId && e.target !== selectedId));
    setSelectedId(null);
  }, [selectedId, setNodes, setEdges]);

  const selectedNode = (nodes.find(n => n.id === selectedId) as unknown as StoredNode) ?? null;

  const handleSave = () => {
    onSave({
      name: name.trim() || 'Untitled automation',
      enabled,
      role,
      nodes: nodes as unknown as StoredNode[],
      edges: edges as unknown as StoredEdge[],
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
        </Button>
        <Input value={name} onChange={e => setName(e.target.value)} className="h-8 max-w-[14rem] text-sm" placeholder="Automation name" />
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">For</Label>
          <Select value={role ?? ALL_STAFF} onValueChange={v => setRole(v === ALL_STAFF ? null : v)}>
            <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_STAFF} className="text-xs">All staff</SelectItem>
              {roleOptions.map(r => (
                <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={enabled} onCheckedChange={setEnabled} id="flow-enabled" />
          <Label htmlFor="flow-enabled" className="text-xs">Enabled</Label>
        </div>
        <div className="ml-auto flex gap-2">
          {selectedId && (
            <Button variant="outline" size="sm" onClick={deleteSelected}>
              <Trash2 className="mr-1.5 h-4 w-4" /> Delete node
            </Button>
          )}
          <Button size="sm" onClick={handleSave} disabled={saving}>
            <Save className="mr-1.5 h-4 w-4" /> {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[150px_1fr_300px]">
        {/* Palette */}
        <div className="space-y-2 rounded-lg border p-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Drag onto canvas</p>
          {PALETTE.map(({ kind, label, Icon, color }) => (
            <div
              key={kind}
              draggable
              onDragStart={e => onDragStart(e, kind)}
              className="flex cursor-grab items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-sm shadow-sm active:cursor-grabbing"
            >
              <Icon className={`h-4 w-4 ${color}`} />
              {label}
            </div>
          ))}
        </div>

        {/* Canvas — fills most of the viewport so the flow is easy to build.
            The node inspector floats over it as a popup when a node is selected. */}
        <div
          ref={wrapperRef}
          className="relative h-[calc(100vh-220px)] min-h-[520px] rounded-lg border"
          onDrop={onDrop}
          onDragOver={onDragOver}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={flowNodeTypes}
            defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            fitView
            proOptions={{ hideAttribution: true }}
            className="bg-muted/30"
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1.5} color="#cbd5e1" />
            <Controls showInteractive={false} />
          </ReactFlow>

          {/* Floating inspector popup — only shown when a node is selected. */}
          {selectedNode && (
            <div className="absolute right-3 top-3 z-10 w-[260px] overflow-hidden rounded-lg border bg-card shadow-xl">
              <div className="flex items-center justify-between border-b px-3 py-1.5">
                <span className="text-xs font-semibold">Configure step</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setSelectedId(null)}
                  title="Close"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="max-h-[60vh] overflow-y-auto">
                <FlowInspector node={selectedNode} onChange={updateNodeConfig} />
              </div>
            </div>
          )}
        </div>

        {/* AI assistant — always visible so a workflow can be generated anytime. */}
        <div className="h-[calc(100vh-220px)] min-h-[520px]">
          <FlowChatbot
            personas={Object.keys(COMMON_TASKS)}
            currentFlow={{
              nodes: nodes as unknown as StoredNode[],
              edges: edges as unknown as StoredEdge[],
            }}
            onApply={(genNodes, genEdges, genName, genRole) =>
              applyGeneratedFlow(genNodes, genEdges, genName, genRole)
            }
          />
        </div>
      </div>
    </div>
  );
}

// Provider wrapper so useReactFlow() (screenToFlowPosition) is available.
export default function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
