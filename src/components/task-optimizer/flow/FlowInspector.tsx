import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ACTION_STATUSES } from '@/lib/optimizeTasks';
import type {
  StoredNode,
  TriggerConfig,
  ConditionConfig,
  ActionConfig,
} from '@/lib/taskOptimizerFlows';

// Side panel that edits the selected node's config. Lifts every change up via
// onChange so the canvas stays the single source of truth for the graph.
interface FlowInspectorProps {
  node: StoredNode | null;
  onChange: (nodeId: string, config: StoredNode['data']['config']) => void;
}

const STATUS_OPTS = [...ACTION_STATUSES] as const;

export default function FlowInspector({ node, onChange }: FlowInspectorProps) {
  if (!node) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
        Select a node to configure it, or drag a new node from the palette.
      </div>
    );
  }

  const kind = node.data.kind;

  if (kind === 'trigger') {
    const cfg = node.data.config as TriggerConfig;
    return (
      <div className="space-y-3 p-4">
        <p className="text-sm font-semibold">Trigger</p>
        <div className="space-y-1.5">
          <Label className="text-xs">When status changes to</Label>
          <Select
            value={cfg.toStatus}
            onValueChange={v => onChange(node.id, { ...cfg, toStatus: v as TriggerConfig['toStatus'] })}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any" className="text-xs">Any change</SelectItem>
              {STATUS_OPTS.map(s => (
                <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }

  if (kind === 'condition') {
    const cfg = node.data.config as ConditionConfig;
    return (
      <div className="space-y-3 p-4">
        <p className="text-sm font-semibold">Condition</p>
        <div className="space-y-1.5">
          <Label className="text-xs">Field</Label>
          <Select value={cfg.field} onValueChange={v => onChange(node.id, { ...cfg, field: v as ConditionConfig['field'] })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="designation" className="text-xs">Designation</SelectItem>
              <SelectItem value="suggestion_type" className="text-xs">Suggestion type</SelectItem>
              <SelectItem value="time_saved_mins" className="text-xs">Time saved (mins)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Operator</Label>
          <Select value={cfg.op} onValueChange={v => onChange(node.id, { ...cfg, op: v as ConditionConfig['op'] })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="eq" className="text-xs">equals</SelectItem>
              <SelectItem value="contains" className="text-xs">contains</SelectItem>
              <SelectItem value="gte" className="text-xs">≥ (number)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Value</Label>
          <Input
            className="h-8 text-xs"
            value={cfg.value}
            onChange={e => onChange(node.id, { ...cfg, value: e.target.value })}
            placeholder="e.g. Nursing / automate / 15"
          />
        </div>
      </div>
    );
  }

  // action
  const cfg = node.data.config as ActionConfig;
  return (
    <div className="space-y-3 p-4">
      <p className="text-sm font-semibold">Action</p>
      <div className="space-y-1.5">
        <Label className="text-xs">Type</Label>
        <Select value={cfg.type} onValueChange={v => onChange(node.id, { ...cfg, type: v as ActionConfig['type'] })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="notify" className="text-xs">Notify (in-app)</SelectItem>
            <SelectItem value="tag" className="text-xs">Tag / add note</SelectItem>
            <SelectItem value="set_status" className="text-xs">Set status</SelectItem>
            <SelectItem value="whatsapp" className="text-xs">WhatsApp (opt-in)</SelectItem>
            <SelectItem value="email" className="text-xs">Email (opt-in)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {cfg.type === 'set_status' ? (
        <div className="space-y-1.5">
          <Label className="text-xs">Set status to</Label>
          <Select
            value={cfg.setStatus ?? 'in_progress'}
            onValueChange={v => onChange(node.id, { ...cfg, setStatus: v as ActionConfig['setStatus'] })}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_OPTS.map(s => (
                <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : cfg.type !== 'email' ? (
        <div className="space-y-1.5">
          <Label className="text-xs">Message / note</Label>
          <Input
            className="h-8 text-xs"
            value={cfg.message ?? ''}
            onChange={e => onChange(node.id, { ...cfg, message: e.target.value })}
            placeholder="Use {staff} {task} {status}"
          />
        </div>
      ) : null}

      {cfg.type === 'whatsapp' && (
        <div className="flex items-center justify-between rounded-md border p-2">
          <div>
            <p className="text-xs font-medium">Enable live sending</p>
            <p className="text-[11px] text-muted-foreground">Off = logs intent only</p>
          </div>
          <Switch
            checked={!!cfg.enabled}
            onCheckedChange={c => onChange(node.id, { ...cfg, enabled: c })}
          />
        </div>
      )}

      {cfg.type === 'email' && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">To (email address)</Label>
            <Input
              className="h-8 text-xs"
              type="email"
              value={cfg.to ?? ''}
              onChange={e => onChange(node.id, { ...cfg, to: e.target.value })}
              placeholder="e.g. manager@hospital.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Subject</Label>
            <Input
              className="h-8 text-xs"
              value={cfg.subject ?? ''}
              onChange={e => onChange(node.id, { ...cfg, subject: e.target.value })}
              placeholder="Use {staff} {task} {status}"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Message body</Label>
            <Textarea
              className="text-xs"
              rows={4}
              value={cfg.message ?? ''}
              onChange={e => onChange(node.id, { ...cfg, message: e.target.value })}
              placeholder="Use {staff}, {task}, {status}, {designation} as template variables"
            />
            <p className="text-[11px] text-muted-foreground">
              Use {'{staff}'}, {'{task}'}, {'{status}'}, {'{designation}'} as template variables
            </p>
          </div>
          <div className="flex items-center justify-between rounded-md border p-2">
            <div>
              <p className="text-xs font-medium">Send enabled</p>
              <p className="text-[11px] text-muted-foreground">Off = logs intent only</p>
            </div>
            <Switch
              checked={!!cfg.enabled}
              onCheckedChange={c => onChange(node.id, { ...cfg, enabled: c })}
            />
          </div>
        </>
      )}
    </div>
  );
}
