import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { TallyScreen } from './tally/TallyChrome';
import { toast } from 'sonner';
import { Plus, Edit, Trash2, Search, ChevronRight, ChevronDown, Loader2, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

// Type definition for a chart of accounts record
interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: 'Asset' | 'Liability' | 'Income' | 'Expense' | 'Equity';
  parent_account_id: string | null;
  account_group: string;
  is_active: boolean;
  opening_balance: number;
  opening_balance_type: 'Dr' | 'Cr';
  created_at: string;
  updated_at: string;
}

// Tree node wraps an Account with its children
interface AccountTreeNode extends Account {
  children: AccountTreeNode[];
}

// Form state for add/edit dialog
interface AccountFormState {
  account_code: string;
  account_name: string;
  account_type: 'Asset' | 'Liability' | 'Income' | 'Expense' | 'Equity';
  account_group: string;
  parent_account_id: string;
  opening_balance: number;
  opening_balance_type: 'Dr' | 'Cr';
}

const INITIAL_FORM_STATE: AccountFormState = {
  account_code: '',
  account_name: '',
  account_type: 'Asset',
  account_group: '',
  parent_account_id: '',
  opening_balance: 0,
  opening_balance_type: 'Dr',
};

const ACCOUNT_TYPES = ['Asset', 'Liability', 'Income', 'Expense', 'Equity'] as const;

// Badge color mapping by account type
const ACCOUNT_TYPE_COLORS: Record<string, string> = {
  Asset: 'bg-blue-100 text-blue-800 border-blue-200',
  Liability: 'bg-orange-100 text-orange-800 border-orange-200',
  Income: 'bg-green-100 text-green-800 border-green-200',
  Expense: 'bg-red-100 text-red-800 border-red-200',
  Equity: 'bg-purple-100 text-purple-800 border-purple-200',
};

/**
 * Builds a tree structure from a flat list of accounts.
 * Root nodes are accounts with parent_account_id === null.
 */
const buildTree = (accounts: Account[]): AccountTreeNode[] => {
  const map = new Map<string, AccountTreeNode>();
  const roots: AccountTreeNode[] = [];

  // Create tree nodes with empty children arrays
  accounts.forEach((a) => map.set(a.id, { ...a, children: [] }));

  // Link children to their parents
  accounts.forEach((a) => {
    if (a.parent_account_id && map.has(a.parent_account_id)) {
      map.get(a.parent_account_id)!.children.push(map.get(a.id)!);
    } else {
      roots.push(map.get(a.id)!);
    }
  });

  return roots;
};

/**
 * Formats a numeric amount in Indian Rupee locale format.
 */
const formatCurrency = (amount: number): string => {
  return `\u20B9${Number(amount).toLocaleString('en-IN')}`;
};

/**
 * Checks whether a tree node (or any of its descendants) matches
 * the current search and type filter criteria.
 */
const nodeMatchesFilter = (
  node: AccountTreeNode,
  searchTerm: string,
  typeFilter: string
): boolean => {
  const lowerSearch = searchTerm.toLowerCase();
  const matchesSelf =
    (node.account_name.toLowerCase().includes(lowerSearch) ||
      node.account_code.toLowerCase().includes(lowerSearch)) &&
    (typeFilter === 'All' || node.account_type === typeFilter);

  if (matchesSelf) return true;

  // If any child matches, the parent should remain visible
  return node.children.some((child) => nodeMatchesFilter(child, searchTerm, typeFilter));
};

// ---------------------------------------------------------------------------
// AccountTreeRow: renders a single tree node and its children recursively
// ---------------------------------------------------------------------------
interface AccountTreeRowProps {
  node: AccountTreeNode;
  depth: number;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onEdit: (account: Account) => void;
  onDelete: (account: Account) => void;
  searchTerm: string;
  typeFilter: string;
}

const AccountTreeRow: React.FC<AccountTreeRowProps> = ({
  node,
  depth,
  expandedIds,
  onToggle,
  onEdit,
  onDelete,
  searchTerm,
  typeFilter,
}) => {
  const isExpanded = expandedIds.has(node.id);
  const hasChildren = node.children.length > 0;

  // Filter children that match the current search/type criteria
  const visibleChildren = node.children.filter((child) =>
    nodeMatchesFilter(child, searchTerm, typeFilter)
  );

  return (
    <>
      <div
        className="group flex items-center py-2 px-3 hover:bg-gray-50 border-b border-gray-100 transition-colors"
        style={{ paddingLeft: `${12 + depth * 24}px` }}
      >
        {/* Expand/collapse toggle */}
        <button
          onClick={() => hasChildren && onToggle(node.id)}
          className="mr-2 flex-shrink-0 w-5 h-5 flex items-center justify-center"
          disabled={!hasChildren}
        >
          {hasChildren ? (
            isExpanded ? (
              <ChevronDown className="h-4 w-4 text-gray-500" />
            ) : (
              <ChevronRight className="h-4 w-4 text-gray-500" />
            )
          ) : (
            <span className="w-4" />
          )}
        </button>

        {/* Account code */}
        <span className="text-sm font-mono text-gray-500 w-24 flex-shrink-0">
          {node.account_code}
        </span>

        {/* Account name */}
        <span className="text-sm font-medium text-gray-800 flex-1 truncate">
          {node.account_name}
        </span>

        {/* Account type badge */}
        <Badge
          variant="outline"
          className={`text-xs mr-4 ${ACCOUNT_TYPE_COLORS[node.account_type] || ''}`}
        >
          {node.account_type}
        </Badge>

        {/* Opening balance */}
        <span className="text-sm text-gray-600 w-32 text-right mr-4">
          {formatCurrency(node.opening_balance)} {node.opening_balance_type}
        </span>

        {/* Action buttons (visible on hover) */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(node);
            }}
          >
            <Edit className="h-3.5 w-3.5 text-blue-600" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(node);
            }}
          >
            <Trash2 className="h-3.5 w-3.5 text-red-500" />
          </Button>
        </div>
      </div>

      {/* Render children recursively when expanded */}
      {isExpanded &&
        visibleChildren.map((child) => (
          <AccountTreeRow
            key={child.id}
            node={child}
            depth={depth + 1}
            expandedIds={expandedIds}
            onToggle={onToggle}
            onEdit={onEdit}
            onDelete={onDelete}
            searchTerm={searchTerm}
            typeFilter={typeFilter}
          />
        ))}
    </>
  );
};

// ---------------------------------------------------------------------------
// ChartOfAccounts: main component
// ---------------------------------------------------------------------------
const ChartOfAccounts: React.FC = () => {
  const queryClient = useQueryClient();

  // UI state
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [formState, setFormState] = useState<AccountFormState>(INITIAL_FORM_STATE);
  const [formErrors, setFormErrors] = useState<{ code?: string; name?: string }>({});
  const [isSaving, setIsSaving] = useState(false);

  // ------ Fetch all active accounts from Supabase ------
  const {
    data: accounts = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['chart_of_accounts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chart_of_accounts')
        .select('*')
        .eq('is_active', true)
        .order('account_code');

      if (error) throw error;
      return (data || []) as Account[];
    },
  });

  // ------ Build filtered tree ------
  const tree = useMemo(() => buildTree(accounts), [accounts]);

  const filteredTree = useMemo(() => {
    if (!searchTerm && typeFilter === 'All') return tree;
    return tree.filter((node) => nodeMatchesFilter(node, searchTerm, typeFilter));
  }, [tree, searchTerm, typeFilter]);

  // ------ Toggle expand/collapse for a node ------
  const handleToggle = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // ------ Open the dialog for adding a new account ------
  const handleAdd = () => {
    setEditingAccount(null);
    setFormState(INITIAL_FORM_STATE);
    setFormErrors({});
    setDialogOpen(true);
  };

  // ------ Open the dialog for editing an existing account ------
  const handleEdit = (account: Account) => {
    setEditingAccount(account);
    setFormState({
      account_code: account.account_code,
      account_name: account.account_name,
      account_type: account.account_type,
      account_group: account.account_group || '',
      parent_account_id: account.parent_account_id || '',
      opening_balance: account.opening_balance,
      opening_balance_type: account.opening_balance_type,
    });
    setFormErrors({});
    setDialogOpen(true);
  };

  // ------ Soft delete an account (set is_active = false) ------
  const handleDelete = async (account: Account) => {
    // Prevent deletion if account has active children
    const hasChildren = accounts.some(
      (a) => a.parent_account_id === account.id
    );
    if (hasChildren) {
      toast.error('Cannot delete an account that has child accounts. Remove children first.');
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to delete "${account.account_name}" (${account.account_code})?`
    );
    if (!confirmed) return;

    const { error } = await supabase
      .from('chart_of_accounts')
      .update({ is_active: false })
      .eq('id', account.id);

    if (error) {
      toast.error('Failed to delete account: ' + error.message);
      return;
    }

    toast.success(`Account "${account.account_name}" deleted successfully.`);
    queryClient.invalidateQueries({ queryKey: ['chart_of_accounts'] });
  };

  // ------ Validate and save (insert or update) ------
  const handleSave = async () => {
    // Validation
    const errors: { code?: string; name?: string } = {};
    if (!formState.account_code.trim()) {
      errors.code = 'Account code is required.';
    }
    if (!formState.account_name.trim()) {
      errors.name = 'Account name is required.';
    }
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setIsSaving(true);

    const payload = {
      account_code: formState.account_code.trim(),
      account_name: formState.account_name.trim(),
      account_type: formState.account_type,
      account_group: formState.account_group.trim(),
      parent_account_id: formState.parent_account_id || null,
      opening_balance: formState.opening_balance,
      opening_balance_type: formState.opening_balance_type,
    };

    try {
      if (editingAccount) {
        // Update existing account
        const { error } = await supabase
          .from('chart_of_accounts')
          .update(payload)
          .eq('id', editingAccount.id);

        if (error) throw error;
        toast.success(`Account "${payload.account_name}" updated successfully.`);
      } else {
        // Insert new account
        const { error } = await supabase
          .from('chart_of_accounts')
          .insert(payload)
          .select()
          .single();

        if (error) throw error;
        toast.success(`Account "${payload.account_name}" created successfully.`);
      }

      queryClient.invalidateQueries({ queryKey: ['chart_of_accounts'] });
      setDialogOpen(false);
    } catch (err: any) {
      toast.error('Failed to save account: ' + (err.message || 'Unknown error'));
    } finally {
      setIsSaving(false);
    }
  };

  // ------ Loading skeleton ------
  if (isLoading) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Chart of Accounts</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="h-4 w-20 bg-gray-200 rounded animate-pulse" />
                <div className="h-4 flex-1 bg-gray-200 rounded animate-pulse" />
                <div className="h-4 w-16 bg-gray-200 rounded animate-pulse" />
                <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ------ Error state ------
  if (isError) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Chart of Accounts</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
            <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-red-700 font-medium">Failed to load accounts</p>
              <p className="text-xs text-red-600 mt-1">
                {(error as Error)?.message || 'An unexpected error occurred.'}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <TallyScreen title="Chart of Accounts" rail={[{ hotkey: 'P', label: 'Print', onClick: () => window.print() }]}>
    
    <Card className="w-full">
      {/* Header with search, filter, and add button */}
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl font-bold text-gray-800">Chart of Accounts</CardTitle>
          <Button onClick={handleAdd} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="h-4 w-4 mr-2" />
            Add Account
          </Button>
        </div>

        <div className="flex items-center gap-3 mt-4">
          {/* Search input */}
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search by name or code..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Account type filter */}
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Types</SelectItem>
              {ACCOUNT_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      {/* Tree view */}
      <CardContent className="pt-0">
        {/* Column header */}
        <div className="flex items-center py-2 px-3 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
          <span className="w-5 mr-2" />
          <span className="w-24 flex-shrink-0">Code</span>
          <span className="flex-1">Name</span>
          <span className="w-20 mr-4 text-center">Type</span>
          <span className="w-32 text-right mr-4">Opening Bal.</span>
          <span className="w-16" />
        </div>

        {filteredTree.length === 0 ? (
          <div className="py-12 text-center text-gray-400 text-sm">
            {searchTerm || typeFilter !== 'All'
              ? 'No accounts match the current filters.'
              : 'No accounts found. Click "Add Account" to create one.'}
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto">
            {filteredTree.map((node) => (
              <AccountTreeRow
                key={node.id}
                node={node}
                depth={0}
                expandedIds={expandedIds}
                onToggle={handleToggle}
                onEdit={handleEdit}
                onDelete={handleDelete}
                searchTerm={searchTerm}
                typeFilter={typeFilter}
              />
            ))}
          </div>
        )}
      </CardContent>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingAccount ? 'Edit Account' : 'Add Account'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Account Code */}
            <div className="space-y-1.5">
              <Label htmlFor="account_code">
                Account Code <span className="text-red-500">*</span>
              </Label>
              <Input
                id="account_code"
                value={formState.account_code}
                onChange={(e) => {
                  setFormState((s) => ({ ...s, account_code: e.target.value }));
                  setFormErrors((e) => ({ ...e, code: undefined }));
                }}
                placeholder="e.g. 1001"
              />
              {formErrors.code && (
                <p className="text-xs text-red-500">{formErrors.code}</p>
              )}
            </div>

            {/* Account Name */}
            <div className="space-y-1.5">
              <Label htmlFor="account_name">
                Account Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="account_name"
                value={formState.account_name}
                onChange={(e) => {
                  setFormState((s) => ({ ...s, account_name: e.target.value }));
                  setFormErrors((e) => ({ ...e, name: undefined }));
                }}
                placeholder="e.g. Cash in Hand"
              />
              {formErrors.name && (
                <p className="text-xs text-red-500">{formErrors.name}</p>
              )}
            </div>

            {/* Account Type */}
            <div className="space-y-1.5">
              <Label>Account Type</Label>
              <Select
                value={formState.account_type}
                onValueChange={(val) =>
                  setFormState((s) => ({
                    ...s,
                    account_type: val as AccountFormState['account_type'],
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Account Group */}
            <div className="space-y-1.5">
              <Label htmlFor="account_group">Account Group</Label>
              <Input
                id="account_group"
                value={formState.account_group}
                onChange={(e) =>
                  setFormState((s) => ({ ...s, account_group: e.target.value }))
                }
                placeholder="e.g. Current Assets"
              />
            </div>

            {/* Parent Account */}
            <div className="space-y-1.5">
              <Label>Parent Account</Label>
              <Select
                value={formState.parent_account_id || 'none'}
                onValueChange={(val) =>
                  setFormState((s) => ({
                    ...s,
                    parent_account_id: val === 'none' ? '' : val,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {accounts
                    .filter((a) => a.id !== editingAccount?.id)
                    .map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.account_code} - {a.account_name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* Opening Balance + Type */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="opening_balance">Opening Balance</Label>
                <Input
                  id="opening_balance"
                  type="number"
                  value={formState.opening_balance}
                  onChange={(e) =>
                    setFormState((s) => ({
                      ...s,
                      opening_balance: parseFloat(e.target.value) || 0,
                    }))
                  }
                  min={0}
                  step="0.01"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Balance Type</Label>
                <Select
                  value={formState.opening_balance_type}
                  onValueChange={(val) =>
                    setFormState((s) => ({
                      ...s,
                      opening_balance_type: val as 'Dr' | 'Cr',
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Dr">Dr</SelectItem>
                    <SelectItem value="Cr">Cr</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingAccount ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
    </TallyScreen>
  );
};

export default ChartOfAccounts;
