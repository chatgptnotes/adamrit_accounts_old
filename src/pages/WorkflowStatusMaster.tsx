import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ClipboardList, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { WorkflowStatusMasterRow } from '@/hooks/useWorkflowStatusOptions';

const WORKFLOW_CHOICES = [
  { value: 'none', label: '— None (portal / general) —' },
  { value: 'approval', label: 'Approval' },
  { value: 'extension', label: 'Extension' },
  { value: 'discharge', label: 'Discharge' },
  { value: 'bill', label: 'Bill' },
  { value: 'submission', label: 'Submission' },
  { value: 'payment', label: 'Payment' },
];

const STAGE_CHOICES = [
  { value: 'none', label: '—' },
  { value: 'pending', label: 'Pending' },
  { value: 'done', label: 'Done / Received' },
];

const slugFromLabel = (label: string) =>
  label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const WorkflowStatusMaster = () => {
  const queryClient = useQueryClient();
  const [newLabel, setNewLabel] = useState('');
  const [newWorkflow, setNewWorkflow] = useState('none');
  const [newStage, setNewStage] = useState('none');
  const [edits, setEdits] = useState<Record<string, { label: string; sort_order: string }>>({});

  const { data: rows = [], isLoading, isError } = useQuery({
    queryKey: ['workflow-status-master-admin'],
    queryFn: async (): Promise<WorkflowStatusMasterRow[]> => {
      const { data, error } = await (supabase as any)
        .from('workflow_status_master')
        .select('*')
        .order('sort_order');
      if (error) throw error;
      return data || [];
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['workflow-status-master-admin'] });
    queryClient.invalidateQueries({ queryKey: ['workflow-status-master-options'] });
  };

  const handleAdd = async () => {
    const label = newLabel.trim();
    if (!label) {
      toast.error('Enter the status name');
      return;
    }
    const value = slugFromLabel(label);
    if (!value) {
      toast.error('Status name must contain letters or numbers');
      return;
    }
    const maxSort = rows.reduce((max, row) => Math.max(max, row.sort_order || 0), 0);
    const { error } = await (supabase as any).from('workflow_status_master').insert({
      value,
      label,
      workflow: newWorkflow === 'none' ? null : newWorkflow,
      stage: newStage === 'none' ? null : newStage,
      sort_order: maxSort + 10,
      is_active: true,
    });
    if (error) {
      toast.error(error.code === '23505' ? 'A status with this name already exists' : 'Could not add the status');
      return;
    }
    toast.success(`Status "${label}" added`);
    setNewLabel('');
    setNewWorkflow('none');
    setNewStage('none');
    refresh();
  };

  const handleSaveRow = async (row: WorkflowStatusMasterRow) => {
    const edit = edits[row.id];
    if (!edit) return;
    const label = edit.label.trim();
    if (!label) {
      toast.error('Label cannot be empty');
      return;
    }
    const sortOrder = Number(edit.sort_order);
    const { error } = await (supabase as any)
      .from('workflow_status_master')
      .update({
        label,
        sort_order: Number.isFinite(sortOrder) ? sortOrder : row.sort_order,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    if (error) {
      toast.error('Could not save the status');
      return;
    }
    toast.success('Status updated');
    setEdits((prev) => {
      const next = { ...prev };
      delete next[row.id];
      return next;
    });
    refresh();
  };

  const handleToggleActive = async (row: WorkflowStatusMasterRow) => {
    const { error } = await (supabase as any)
      .from('workflow_status_master')
      .update({ is_active: !row.is_active, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (error) {
      toast.error('Could not update the status');
      return;
    }
    toast.success(row.is_active ? 'Status hidden from the dropdown' : 'Status visible in the dropdown');
    refresh();
  };

  const handleDelete = async (row: WorkflowStatusMasterRow) => {
    if (!window.confirm(`Delete status "${row.label}"? Patients already marked with it keep the value, but it disappears from the dropdown and master.`)) return;
    const { error } = await (supabase as any).from('workflow_status_master').delete().eq('id', row.id);
    if (error) {
      toast.error('Could not delete the status');
      return;
    }
    toast.success('Status deleted');
    refresh();
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2 text-primary">
            <ClipboardList className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Status Master</h1>
            <p className="text-sm text-gray-500">
              Statuses shown in the Advance Statement Report dropdown. Statuses linked to a workflow
              also feed the six Dashboard workflow reports.
            </p>
          </div>
        </div>

        <div className="rounded-lg border bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Add Status</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Status name, e.g. Pre-authorization pending"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="h-9 w-80"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd();
              }}
            />
            <Select value={newWorkflow} onValueChange={setNewWorkflow}>
              <SelectTrigger className="h-9 w-56">
                <SelectValue placeholder="Workflow" />
              </SelectTrigger>
              <SelectContent>
                {WORKFLOW_CHOICES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={newStage} onValueChange={setNewStage}>
              <SelectTrigger className="h-9 w-40">
                <SelectValue placeholder="Stage" />
              </SelectTrigger>
              <SelectContent>
                {STAGE_CHOICES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={handleAdd}>
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          </div>
        </div>

        <div className="rounded-lg border bg-white shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Workflow</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="w-24">Sort</TableHead>
                <TableHead className="w-28">Visible</TableHead>
                <TableHead className="w-32">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center">Loading...</TableCell>
                </TableRow>
              ) : isError ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-red-600">
                    Could not load the status master. Run the workflow_status_master migration in Supabase first.
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-gray-500">
                    No statuses yet — run the seed migration or add one above.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const edit = edits[row.id];
                  return (
                    <TableRow key={row.id} className={row.is_active ? '' : 'opacity-50'}>
                      <TableCell>
                        <Input
                          className="h-8"
                          value={edit ? edit.label : row.label}
                          onChange={(e) =>
                            setEdits((prev) => ({
                              ...prev,
                              [row.id]: {
                                label: e.target.value,
                                sort_order: prev[row.id]?.sort_order ?? String(row.sort_order),
                              },
                            }))
                          }
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs text-gray-500">{row.value}</TableCell>
                      <TableCell className="text-sm">{row.workflow || '—'}</TableCell>
                      <TableCell className="text-sm">{row.stage || '—'}</TableCell>
                      <TableCell>
                        <Input
                          className="h-8 w-20"
                          type="number"
                          value={edit ? edit.sort_order : String(row.sort_order)}
                          onChange={(e) =>
                            setEdits((prev) => ({
                              ...prev,
                              [row.id]: {
                                label: prev[row.id]?.label ?? row.label,
                                sort_order: e.target.value,
                              },
                            }))
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <button type="button" onClick={() => handleToggleActive(row)}>
                          <Badge
                            variant="outline"
                            className={
                              row.is_active
                                ? 'cursor-pointer border-emerald-300 bg-emerald-50 text-emerald-700'
                                : 'cursor-pointer border-gray-300 bg-gray-100 text-gray-500'
                            }
                          >
                            {row.is_active ? 'Active' : 'Hidden'}
                          </Badge>
                        </button>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!edit}
                            onClick={() => handleSaveRow(row)}
                          >
                            <Save className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-red-600 hover:text-red-700"
                            onClick={() => handleDelete(row)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
};

export default WorkflowStatusMaster;
