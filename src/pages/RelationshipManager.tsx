import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Search, Users, EyeOff, Eye, Phone, Edit, Upload, FileDown, ArrowRight } from 'lucide-react';
import { AddItemDialog } from '@/components/AddItemDialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import ReferralRegisterTable from '@/components/relationship/ReferralRegisterTable';
import { useToast } from '@/hooks/use-toast';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/contexts/AuthContext';
import { logActivity, getDeviceInfo } from '@/lib/activity-logger';
import { canAccessReferralRegister } from '@/lib/referralRegisterAccess';
import { LedgerAutocomplete, type LedgerAccountOption } from '@/components/accounting/LedgerAutocomplete';
import { useMarketingLiaisons } from '@/lib/marketingLiaisons';

// A Select cannot hold an empty string as a value, so "nobody" needs a token.
const NO_LIAISON = '__none__';
const liaisonValue = (value?: string) =>
  !value || value === NO_LIAISON ? null : value;

interface RelationshipManagerType {
  id: string;
  name: string;
  code?: string;
  contact_no?: string;
  is_hidden?: boolean;
  ledger_account_id?: string | null;
  company_id?: string | null;
  liaison_user_id?: string | null;
  created_at: string;
  updated_at: string;
}

const RelationshipManager = () => {
  const [activeTab, setActiveTab] = useState('managers');
  const [searchTerm, setSearchTerm] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedManager, setSelectedManager] = useState<RelationshipManagerType | null>(null);
  // The ledger picked in the add/edit dialog. The manager's name is taken from
  // it, so the master and the chart of ledgers can never say different things.
  const [dialogLedger, setDialogLedger] = useState<LedgerAccountOption | null>(null);
  const [newLedgerName, setNewLedgerName] = useState('');
  const { toast } = useToast();
  const liaisons = useMarketingLiaisons();
  const queryClient = useQueryClient();
  const { canEditMasters } = usePermissions();
  const { user } = useAuth();
  const importInputRef = useRef<HTMLInputElement>(null);

  const canUseReferralRegister = canAccessReferralRegister(user);

  const { data: managers = [], isLoading } = useQuery({
    queryKey: ['relationship-managers', showHidden],
    queryFn: async () => {
      let query = supabase
        .from('relationship_managers')
        .select('*')
        .order('code');

      // When "Show hidden" is off, only return visible managers.
      // When on, return everything so hidden ones can be un-hidden.
      if (!showHidden) {
        query = query.eq('is_hidden', false);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching relationship managers:', error);
        throw error;
      }

      return data || [];
    }
  });

  // Ledger names for every manager on screen, so a card can show what it is
  // mapped to and the edit dialog can open on the existing mapping.
  const ledgerIds = Array.from(
    new Set(
      (managers as RelationshipManagerType[])
        .map((m) => m.ledger_account_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const { data: ledgerById = new Map<string, LedgerAccountOption>() } = useQuery({
    queryKey: ['relationship-manager-ledgers', ledgerIds.join(',')],
    enabled: ledgerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('chart_of_accounts')
        .select('id, account_code, account_name, account_group, company_id')
        .in('id', ledgerIds);
      if (error) throw error;
      return new Map<string, LedgerAccountOption>(
        ((data || []) as LedgerAccountOption[]).map((row) => [row.id, row]),
      );
    },
  });

  // Most relationship managers are referrers who were never set up as ledgers,
  // so the master has to be able to create one rather than only pick one. A
  // manager we owe commission to is a creditor, and the RM_ code series keeps
  // these apart from the Tally import (DRMFRESH_) and the Tally sync (TL).
  const createLedgerMutation = useMutation({
    mutationFn: async (ledgerName: string): Promise<LedgerAccountOption> => {
      const name = ledgerName.trim();
      if (!name) throw new Error('Enter the ledger name');

      const { data: existing } = await (supabase as any)
        .from('chart_of_accounts')
        .select('id, account_code, account_name, account_group, company_id')
        .ilike('account_name', name)
        .eq('is_active', true)
        .limit(1);
      if (existing?.length) return existing[0] as LedgerAccountOption;

      const { data: company } = await (supabase as any)
        .from('companies')
        .select('id')
        .eq('company_key', 'ml_enterprises')
        .maybeSingle();

      const { data: lastCode } = await (supabase as any)
        .from('chart_of_accounts')
        .select('account_code')
        .like('account_code', 'RM\\_%')
        .order('account_code', { ascending: false })
        .limit(1);
      const nextNumber = lastCode?.length
        ? Number(String(lastCode[0].account_code).split('_')[1] || 0) + 1
        : 1;

      const { data, error } = await (supabase as any)
        .from('chart_of_accounts')
        .insert({
          account_code: `RM_${String(nextNumber).padStart(6, '0')}`,
          account_name: name,
          account_type: 'CURRENT_LIABILITIES',
          account_group: 'Sundry Creditors',
          company_id: company?.id ?? null,
          opening_balance: 0,
          opening_balance_type: 'CR',
          is_active: true,
        })
        .select('id, account_code, account_name, account_group, company_id')
        .single();
      if (error) throw error;
      return data as LedgerAccountOption;
    },
    onSuccess: (ledger) => {
      setDialogLedger(ledger);
      queryClient.invalidateQueries({ queryKey: ['relationship-manager-ledgers'] });
      toast({
        title: "Ledger created",
        description: `${ledger.account_name} (${ledger.account_code}) is now in Sundry Creditors.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Could not create the ledger",
        description: error?.message || 'Please try again.',
        variant: "destructive",
      });
    },
  });

  const addMutation = useMutation({
    mutationFn: async (newManager: Omit<RelationshipManagerType, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('relationship_managers')
        .insert([newManager])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      // Audit: record who/which device added this RM (shows on Activity Log).
      logActivity('relationship_manager_create', {
        name: data?.name,
        code: data?.code ?? null,
        source: 'rm_master_page',
        device: getDeviceInfo(),
      });
      queryClient.invalidateQueries({ queryKey: ['relationship-managers'] });
      queryClient.invalidateQueries({ queryKey: ['relationship-managers-count'] });
      toast({
        title: "Success",
        description: "Relationship Manager added successfully",
      });
      setIsAddDialogOpen(false);
    },
    onError: (error) => {
      console.error('Add relationship manager error:', error);
      toast({
        title: "Error",
        description: "Failed to add relationship manager",
        variant: "destructive"
      });
    }
  });

  const hideMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('relationship_managers')
        .update({ is_hidden: true, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['relationship-managers'] });
      queryClient.invalidateQueries({ queryKey: ['relationship-managers-count'] });
      toast({
        title: "Success",
        description: "Relationship Manager hidden successfully",
      });
    },
    onError: (error) => {
      console.error('Hide relationship manager error:', error);
      toast({
        title: "Error",
        description: "Failed to hide relationship manager",
        variant: "destructive"
      });
    }
  });

  const unhideMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('relationship_managers')
        .update({ is_hidden: false, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['relationship-managers'] });
      queryClient.invalidateQueries({ queryKey: ['relationship-managers-count'] });
      toast({
        title: "Success",
        description: "Relationship Manager is visible again",
      });
    },
    onError: (error) => {
      console.error('Unhide relationship manager error:', error);
      toast({
        title: "Error",
        description: "Failed to unhide relationship manager",
        variant: "destructive"
      });
    }
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<RelationshipManagerType> }) => {
      const { error } = await supabase
        .from('relationship_managers')
        .update({
          name: data.name,
          contact_no: data.contact_no || null,
          ledger_account_id: data.ledger_account_id ?? null,
          company_id: data.company_id ?? null,
          updated_at: new Date().toISOString()
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['relationship-managers'] });
      queryClient.invalidateQueries({ queryKey: ['relationship-managers-count'] });
      toast({
        title: "Success",
        description: "Relationship Manager updated successfully",
      });
      setIsEditDialogOpen(false);
      setSelectedManager(null);
    },
    onError: (error: any) => {
      console.error('Edit relationship manager error:', error);
      toast({
        title: "Error",
        description: "Failed to update relationship manager",
        variant: "destructive"
      });
    }
  });

  const filteredManagers = managers.filter((manager: RelationshipManagerType) =>
    manager.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    manager.code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    manager.contact_no?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleAdd = (formData: Record<string, string>) => {
    if (!dialogLedger) {
      toast({
        title: "Pick a ledger",
        description: "Search the chart of ledgers and select the ledger this manager is paid through.",
        variant: "destructive",
      });
      return;
    }
    addMutation.mutate({
      name: dialogLedger.account_name,
      contact_no: formData.contact_no || undefined,
      ledger_account_id: dialogLedger.id,
      company_id: dialogLedger.company_id,
      liaison_user_id: liaisonValue(formData.liaison_user_id),
    });
    setDialogLedger(null);
  };

  const handleHide = (id: string) => {
    if (confirm('Are you sure you want to hide this relationship manager?')) {
      hideMutation.mutate(id);
    }
  };

  const handleUnhide = (id: string) => {
    unhideMutation.mutate(id);
  };

  const handleEdit = (formData: Record<string, string>) => {
    if (selectedManager) {
      editMutation.mutate({
        id: selectedManager.id,
        // A manager mapped to a ledger takes its name from that ledger. One
        // that has not been mapped yet keeps the name it already had.
        data: {
          name: dialogLedger?.account_name || selectedManager.name,
          contact_no: formData.contact_no,
          ledger_account_id: dialogLedger?.id ?? null,
          company_id: dialogLedger?.company_id ?? null,
          liaison_user_id: liaisonValue(formData.liaison_user_id),
        }
      });
    }
  };

  // Bulk import: each row inserts name + contact only. The DB trigger
  // auto-assigns the sequential numeric code, so we never send `code`.
  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        let records: { name: string; contact_no: string | null }[] = [];
        const fileName = file.name.toLowerCase();

        if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const worksheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);

          records = jsonData.map((row) => {
            const rawContact = row['Contact'] ?? row['Contact No'] ?? row['contact_no'];
            return {
              name: String(row['Name'] ?? row['name'] ?? '').trim(),
              contact_no:
                rawContact != null && String(rawContact).trim()
                  ? String(rawContact).trim()
                  : null,
            };
          });
        } else {
          const text = e.target?.result as string;
          const lines = text.split('\n').filter((l) => l.trim());
          const headers = lines[0]
            .split(',')
            .map((h) => h.trim().replace(/"/g, '').toLowerCase());
          const nameIdx = headers.findIndex((h) => h === 'name');
          const contactIdx = headers.findIndex(
            (h) => h === 'contact' || h === 'contact no' || h === 'contact_no'
          );

          records = lines.slice(1).map((line) => {
            const values = (line.match(/(".*?"|[^,]+)/g) || []).map((v) =>
              v.replace(/^"|"$/g, '').trim()
            );
            const contact = contactIdx >= 0 ? values[contactIdx] : '';
            return {
              name: (nameIdx >= 0 ? values[nameIdx] : values[0]) || '',
              contact_no: contact ? contact : null,
            };
          });
        }

        records = records.filter((r) => r.name.trim());

        if (records.length === 0) {
          toast({
            title: 'Nothing to import',
            description: 'No rows with a "Name" column were found in the file.',
            variant: 'destructive',
          });
          return;
        }

        const { error } = await supabase.from('relationship_managers').insert(records);
        if (error) throw error;

        // Audit: record the bulk import + which device performed it.
        logActivity('relationship_manager_create', {
          source: 'rm_master_import',
          count: records.length,
          names: records.slice(0, 25).map((r) => r.name),
          device: getDeviceInfo(),
        });
        queryClient.invalidateQueries({ queryKey: ['relationship-managers'] });
        queryClient.invalidateQueries({ queryKey: ['relationship-managers-count'] });
        toast({
          title: 'Import successful',
          description: `${records.length} relationship manager(s) added. Codes were auto-assigned.`,
        });
      } catch (err) {
        console.error('Relationship manager import error:', err);
        toast({
          title: 'Import failed',
          description: 'Invalid file format or insert error. Expected a "Name" column.',
          variant: 'destructive',
        });
      }
    };

    if (file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls')) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
    event.target.value = '';
  };

  // Generate a PDF reference sheet mapping each code to its name + contact.
  // This master page is the one place where code ↔ name is allowed to show.
  const handleExportPdf = () => {
    const rows = [...managers].sort((a, b) =>
      (a.code || '').localeCompare(b.code || '', undefined, { numeric: true })
    );

    if (rows.length === 0) {
      toast({
        title: 'Nothing to export',
        description: 'There are no relationship managers yet.',
        variant: 'destructive',
      });
      return;
    }

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const marginX = 14;
    const colCode = marginX;
    const colName = marginX + 30;
    const colContact = marginX + 120;
    let y = 20;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('Relationship Manager Codes', pageWidth / 2, y, { align: 'center' });
    y += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, pageWidth / 2, y, {
      align: 'center',
    });
    y += 10;

    const drawHeader = () => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('Code', colCode, y);
      doc.text('Name', colName, y);
      doc.text('Contact', colContact, y);
      y += 2;
      doc.setLineWidth(0.3);
      doc.line(marginX, y, pageWidth - marginX, y);
      y += 6;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
    };
    drawHeader();

    rows.forEach((m) => {
      if (y > pageHeight - 15) {
        doc.addPage();
        y = 20;
        drawHeader();
      }
      doc.text(m.code ? `RM-${m.code}` : '-', colCode, y);
      doc.text(m.name || '-', colName, y);
      doc.text(m.contact_no || '-', colContact, y);
      y += 7;
    });

    doc.save(`relationship_managers_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">Loading relationship managers...</div>
        </div>
      </div>
    );
  }

  // The name is not typed. It comes from the ledger picked here, which is the
  // same ledger every referral and implant commission is credited to.
  const fields = [
    {
      key: 'ledger_account_id',
      label: 'Ledger (name comes from here)',
      type: 'custom' as const,
      required: true,
      render: () => (
        <div className="space-y-2">
          <LedgerAutocomplete
            value={dialogLedger}
            onChange={setDialogLedger}
            placeholder="Search the chart of ledgers by name..."
          />
          {!dialogLedger && (
            <div className="rounded-md border border-dashed p-2">
              <p className="mb-2 text-xs text-muted-foreground">
                Not in the chart of ledgers yet? Create one under Sundry Creditors.
              </p>
              <div className="flex gap-2">
                <Input
                  value={newLedgerName}
                  onChange={(e) => setNewLedgerName(e.target.value)}
                  placeholder="Manager's name"
                  className="h-9"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!newLedgerName.trim() || createLedgerMutation.isPending}
                  onClick={() => createLedgerMutation.mutate(newLedgerName)}
                >
                  {createLedgerMutation.isPending ? 'Creating...' : 'Create ledger'}
                </Button>
              </div>
            </div>
          )}
        </div>
      ),
    },
    { key: 'contact_no', label: 'Contact No', type: 'text' as const },
    {
      // Every RM is liaisoned by someone on the marketing side. The Daily
      // Revenue Report shows this name beside the cut, so a query about a
      // payment has a person attached to it.
      key: 'liaison_user_id',
      label: 'Marketing liaison',
      type: 'select' as const,
      options: [
        { value: NO_LIAISON, label: 'Not assigned' },
        ...liaisons.map((l) => ({ value: l.id, label: l.name })),
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Users className="h-8 w-8 text-primary" />
            <h1 className="text-4xl font-bold text-primary">
              Relationship Manager
            </h1>
          </div>
          <p className="text-lg text-muted-foreground">
            Manage relationship managers
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-6">
            <TabsTrigger value="managers">Managers</TabsTrigger>
            {canUseReferralRegister && (
              <TabsTrigger value="referral">Referral Register</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="managers">
        {canUseReferralRegister && (
          <Card className="mb-6 border-emerald-200 bg-emerald-50">
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-emerald-900">Update Referral Register</h2>
                <p className="text-sm text-emerald-700">
                  Complete and review referral entries for admitted patients.
                </p>
              </div>
              <Button
                onClick={() => setActiveTab('referral')}
                className="bg-emerald-700 text-white hover:bg-emerald-800"
              >
                Open Register
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        )}
        <div className="mb-6 flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search by code, name or contact..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <Button variant="outline" onClick={handleExportPdf}>
              <FileDown className="h-4 w-4 mr-2" />
              Export PDF
            </Button>
            <Button
              variant={showHidden ? 'default' : 'outline'}
              onClick={() => setShowHidden((prev) => !prev)}
              title={showHidden ? 'Hide hidden managers from view' : 'Show hidden managers so they can be un-hidden'}
            >
              {showHidden ? <Eye className="h-4 w-4 mr-2" /> : <EyeOff className="h-4 w-4 mr-2" />}
              {showHidden ? 'Showing hidden' : 'Show hidden'}
            </Button>
            {canEditMasters && (
              <>
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleImport}
                  className="hidden"
                />
                <Button variant="outline" onClick={() => importInputRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-2" />
                  Import
                </Button>
              </>
            )}
            <Button onClick={() => setIsAddDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Relationship Manager
            </Button>
          </div>
        </div>

        <div className="grid gap-4">
          {filteredManagers.map((manager: RelationshipManagerType) => (
            <Card key={manager.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="flex items-center gap-3">
                    {manager.code && (
                      <span className="inline-flex items-center rounded-md bg-primary/10 px-2.5 py-1 text-base font-mono font-semibold text-primary">
                        RM-{manager.code}
                      </span>
                    )}
                    <span className="text-xl">{manager.name}</span>
                    {manager.ledger_account_id ? (
                      <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        {ledgerById.get(manager.ledger_account_id)?.account_name || 'Ledger mapped'}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                        No ledger — cannot be approved for payment
                      </span>
                    )}
                    {manager.is_hidden && (
                      <span className="inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                        Hidden
                      </span>
                    )}
                  </span>
                  <div className="flex gap-2 items-center">
                    {manager.contact_no && (
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Phone className="h-4 w-4" />
                        {manager.contact_no}
                      </div>
                    )}
                    {canEditMasters && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedManager(manager);
                          setDialogLedger(
                            (manager.ledger_account_id && ledgerById.get(manager.ledger_account_id)) || null,
                          );
                          // Creating a ledger for an existing manager almost
                          // always means creating it under their own name.
                          setNewLedgerName(manager.name || '');
                          setIsEditDialogOpen(true);
                        }}
                        className="text-blue-600 hover:text-blue-700 ml-2"
                        title="Edit relationship manager"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    )}
                    {canEditMasters && (
                      manager.is_hidden ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleUnhide(manager.id)}
                          className="text-green-600 hover:text-green-700 ml-2"
                          title="Unhide relationship manager"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleHide(manager.id)}
                          className="text-amber-600 hover:text-amber-700 ml-2"
                          title="Hide relationship manager"
                        >
                          <EyeOff className="h-4 w-4" />
                        </Button>
                      )
                    )}
                  </div>
                </CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>

        {filteredManagers.length === 0 && (
          <div className="text-center py-12">
            <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg text-muted-foreground">
              {searchTerm ? 'No relationship managers found matching your search.' : 'No relationship managers available.'}
            </p>
          </div>
        )}
          </TabsContent>

          {canUseReferralRegister && (
            <TabsContent value="referral">
              <ReferralRegisterTable />
            </TabsContent>
          )}
        </Tabs>

        <AddItemDialog
          isOpen={isAddDialogOpen}
          onClose={() => {
            setIsAddDialogOpen(false);
            setDialogLedger(null);
            setNewLedgerName('');
          }}
          onAdd={handleAdd}
          title="Add Relationship Manager"
          fields={fields}
        />

        <AddItemDialog
          isOpen={isEditDialogOpen}
          onClose={() => {
            setIsEditDialogOpen(false);
            setSelectedManager(null);
            setDialogLedger(null);
            setNewLedgerName('');
          }}
          onAdd={handleEdit}
          title="Edit Relationship Manager"
          fields={fields}
          initialData={selectedManager ? {
            contact_no: selectedManager.contact_no || '',
            liaison_user_id: selectedManager.liaison_user_id || NO_LIAISON
          } : undefined}
        />
      </div>
    </div>
  );
};

export default RelationshipManager;
