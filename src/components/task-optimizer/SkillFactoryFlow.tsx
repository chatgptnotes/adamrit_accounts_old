import { useCallback, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  Panel,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
  type Connection,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type DefaultEdgeOptions,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Zap, Filter, Play, Trash2 } from 'lucide-react';
import { flowNodeTypes } from './flow/nodeTypes';
import type {
  FlowNodeKind,
  StoredNode,
  StoredEdge,
  FlowNodeData,
  TriggerConfig,
  ConditionConfig,
  ActionConfig,
} from '@/lib/taskOptimizerFlows';

export interface SkillFactoryFlowProps {
  nodes: StoredNode[];
  edges: StoredEdge[];
  onChange: (nodes: StoredNode[], edges: StoredEdge[]) => void;
  // When true: hide the palette, disable dragging/connecting/dropping. Pure
  // preview mode for overview canvases that should not be edited.
  readOnly?: boolean;
  // Optional slot rendered as a React Flow Panel at the top-right of the canvas
  // (lives inside the viewport so it tracks pan/zoom container, not the page).
  topRightPanel?: ReactNode;
}

const DEFAULT_EDGE_OPTIONS: DefaultEdgeOptions = {
  type: 'smoothstep',
  animated: true,
  style: { strokeWidth: 2, stroke: '#94a3b8' },
  markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8', width: 18, height: 18 },
};

const PALETTE: Array<{ kind: FlowNodeKind; label: string; Icon: typeof Zap; color: string }> = [
  { kind: 'trigger', label: 'Trigger', Icon: Zap, color: 'text-amber-600' },
  { kind: 'condition', label: 'Condition', Icon: Filter, color: 'text-violet-600' },
  { kind: 'action', label: 'Action', Icon: Play, color: 'text-emerald-600' },
];

function defaultData(kind: FlowNodeKind): FlowNodeData {
  if (kind === 'trigger') {
    return { kind, label: 'When status changes', config: { event: 'status_changed', toStatus: 'done' } as TriggerConfig };
  }
  if (kind === 'condition') {
    return { kind, label: 'If', config: { field: 'suggestion_type', op: 'eq', value: 'automate' } as ConditionConfig };
  }
  return { kind, label: 'Notify', config: { type: 'notify', message: '{task} is {status}' } as ActionConfig };
}

let idCounter = 1;
const nextId = (kind: string) => `${kind}-${Date.now()}-${idCounter++}`;

function CanvasInner({ nodes, edges, onChange, readOnly, topRightPanel }: SkillFactoryFlowProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  // The canvas is fully controlled by the parent. We translate react-flow's
  // change events back into the parent's StoredNode[] / StoredEdge[] shape.
  const rfNodes = nodes as unknown as Node[];
  const rfEdges = edges.map(e => ({ ...DEFAULT_EDGE_OPTIONS, ...e })) as unknown as Edge[];

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const next = applyNodeChanges(changes, rfNodes);
      // When a node is removed (Delete/Backspace key), drop edges touching it in
      // the same update so no dangling edges are left behind.
      const removed = new Set(
        changes.filter((c): c is NodeChange & { type: 'remove'; id: string } => c.type === 'remove').map((c) => c.id),
      );
      const nextEdges = removed.size ? edges.filter((e) => !removed.has(e.source) && !removed.has(e.target)) : edges;
      onChange(next as unknown as StoredNode[], nextEdges);
    },
    [rfNodes, edges, onChange],
  );

  // Selected node ids — tracked via onSelectionChange so the controlled-nodes
  // round-trip can't lose the selection. Drives the Delete button.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const deleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    const gone = new Set(selectedIds);
    onChange(
      nodes.filter((n) => !gone.has(n.id)),
      edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)),
    );
    setSelectedIds([]);
  }, [selectedIds, nodes, edges, onChange]);

  // Click-to-add: drop a fresh node at the canvas centre (a small cascade offset
  // keeps repeated adds from stacking exactly on top of each other).
  const addNode = useCallback(
    (kind: FlowNodeKind) => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      const center = rect
        ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
        : { x: 120, y: 120 };
      const cascade = (nodes.length % 6) * 26;
      const node: Node = {
        id: nextId(kind),
        type: kind,
        position: { x: center.x + cascade, y: center.y + cascade },
        data: defaultData(kind) as unknown as Record<string, unknown>,
      };
      onChange([...nodes, node as unknown as StoredNode], edges);
    },
    [screenToFlowPosition, nodes, edges, onChange],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const next = applyEdgeChanges(changes, rfEdges);
      onChange(nodes, next as unknown as StoredEdge[]);
    },
    [rfEdges, nodes, onChange],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      const next = addEdge({ ...c, ...DEFAULT_EDGE_OPTIONS }, rfEdges);
      onChange(nodes, next as unknown as StoredEdge[]);
    },
    [rfEdges, nodes, onChange],
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
      const node: Node = {
        id: nextId(kind),
        type: kind,
        position,
        data: defaultData(kind) as unknown as Record<string, unknown>,
      };
      onChange([...nodes, node as unknown as StoredNode], edges);
    },
    [screenToFlowPosition, nodes, edges, onChange],
  );

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  return (
    <div className="flex h-full flex-col gap-2">
      {/* Mini palette — click to add or drag onto canvas (hidden in read-only
          mode). The Delete button appears once a node is selected. */}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-1.5">
          {PALETTE.map(({ kind, label, Icon, color }) => (
            <button
              key={kind}
              type="button"
              draggable
              onDragStart={e => onDragStart(e, kind)}
              onClick={() => addNode(kind)}
              title={`Click to add a ${label} node, or drag onto the canvas`}
              className="flex cursor-grab items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs shadow-sm hover:bg-accent active:cursor-grabbing"
            >
              <Icon className={`h-3.5 w-3.5 ${color}`} />
              {label}
            </button>
          ))}
          {selectedIds.length > 0 && (
            <button
              type="button"
              onClick={deleteSelected}
              title="Delete the selected node (or press Delete / Backspace)"
              className="ml-auto flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-2 py-1 text-xs text-red-600 shadow-sm hover:bg-red-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete {selectedIds.length > 1 ? `(${selectedIds.length})` : 'node'}
            </button>
          )}
        </div>
      )}

      <div
        ref={wrapperRef}
        className="relative flex-1 min-h-[420px] overflow-hidden rounded-lg border"
        onDrop={readOnly ? undefined : onDrop}
        onDragOver={readOnly ? undefined : onDragOver}
      >
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          // Node dragging is allowed in every mode (so the overview canvas can be
          // rearranged visually); but in read-only mode, adding/removing/connecting
          // is still blocked.
          onNodesChange={onNodesChange}
          onEdgesChange={readOnly ? undefined : onEdgesChange}
          onConnect={readOnly ? undefined : onConnect}
          onSelectionChange={({ nodes: sel }) => setSelectedIds(readOnly ? [] : sel.map((n) => n.id))}
          deleteKeyCode={readOnly ? null : ['Delete', 'Backspace']}
          nodeTypes={flowNodeTypes}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          fitView
          proOptions={{ hideAttribution: true }}
          className="bg-muted/30"
          nodesDraggable
          nodesConnectable={!readOnly}
          elementsSelectable
          panOnDrag
          zoomOnScroll
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1.5} color="#cbd5e1" />
          <Controls showInteractive={false} />
          {topRightPanel && <Panel position="top-right">{topRightPanel}</Panel>}
        </ReactFlow>
      </div>
    </div>
  );
}

export default function SkillFactoryFlow(props: SkillFactoryFlowProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
