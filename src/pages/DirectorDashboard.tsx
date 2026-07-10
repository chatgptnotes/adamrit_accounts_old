import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Wallet, Edit2, Trash2, Plus, CheckCircle, AlertTriangle, Calendar, ArrowRight, DollarSign, FileText, Users, Upload, FolderOpen, Eye, FileSpreadsheet, Search, HardDrive } from 'lucide-react';
import {
  validateOfficeFile,
  sanitizeStorageFilename,
  inferOfficeKindFromName,
  OFFICE_ACCEPT_ATTR,
  type OfficeFileKind,
} from '@/lib/office-upload-validation';
import { DirectorFilePreviewDialog } from '@/components/DirectorFilePreviewDialog';
import { DirectorKpiCards } from '@/components/DirectorKpiCards';
import { DepartmentActivityMonitor } from '@/components/DepartmentActivityMonitor';
import { DirectorProjectLauncher } from '@/components/DirectorProjectLauncher';
import { DailyRevenueReportSection } from '@/components/DailyRevenueReportSection';
import { DirectorFinancialStatements } from '@/components/DirectorFinancialStatements';
import { GovernmentPortalGeneralMedicalSection } from '@/components/GovernmentPortalGeneralMedicalSection';
import { usePaymentDeadlines, type PaymentDeadline } from '@/hooks/usePaymentDeadlines';

const DIRECTOR_EMAILS = ['cmd@hopehospital.com', 'finance@hopehospital.com'];
const DIRECTOR_ROLES = ['superadmin', 'super_admin', 'front_office', 'billing'];

const canAccessDirector = (user: { email?: string; role?: string } | null | undefined): boolean => {
  if (!user) return false;
  const email = user.email?.toLowerCase() ?? '';
  const role = user.role ?? '';
  return DIRECTOR_EMAILS.includes(email) || DIRECTOR_ROLES.includes(role);
};

interface DeadlineFormData {
  service_name: string;
  amount: string;
  due_date: string;
  notes: string;
}

interface DirectorFile {
  name: string;
  size: number | null;
  updatedAt: string | null;
}

const isOverdue = (dueDate: string, status: 'pending' | 'paid' | 'overdue'): boolean => {
  if (status === 'paid') return false;
  return new Date(dueDate) < new Date() && status === 'pending';
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return 'An unexpected error occurred';
};

export default function DirectorDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const initialFormData: DeadlineFormData = { service_name: '', amount: '', due_date: '', notes: '' };
  const [formData, setFormData] = useState<DeadlineFormData>(initialFormData);
  const [isUploadingActionItems, setIsUploadingActionItems] = useState(false);
  const actionItemsFileInputRef = useRef<HTMLInputElement>(null);
  const [isFilesDialogOpen, setIsFilesDialogOpen] = useState(false);
  const [directorFiles, setDirectorFiles] = useState<DirectorFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<string | null>(null);
  const [isDeletingFile, setIsDeletingFile] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<{ file: File; targetName: string } | null>(null);
  const [previewState, setPreviewState] = useState<{ name: string; signedUrl: string } | null>(null);
  const [isPreparingPreview, setIsPreparingPreview] = useState(false);
  const [filesSearch, setFilesSearch] = useState('');
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  // Access guard via effect (not during render)
  useEffect(() => {
    if (!canAccessDirector(user)) {
      navigate('/dashboard', { replace: true });
    }
  }, [user, navigate]);

  // Fetch payment deadlines (shared with the tablet Director view)
  const { data: deadlines = [], isLoading, error } = usePaymentDeadlines();

  // Sort and filter: pending/overdue first, then paid (show first 3)
  const sortedDeadlines = useMemo(() => {
    const active = deadlines.filter(d => d.status !== 'paid');
    const paid = deadlines.filter(d => d.status === 'paid');
    return [...active, ...paid].slice(0, 3);
  }, [deadlines]);

  // Summary for the alert banner: overdue + due within 7 days
  const alertSummary = useMemo(() => {
    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const overdue = deadlines.filter(d =>
      d.status !== 'paid' && new Date(d.due_date) < now
    );
    const dueSoon = deadlines.filter(d => {
      if (d.status === 'paid') return false;
      const due = new Date(d.due_date);
      return due >= now && due <= in7Days;
    });
    const total = [...overdue, ...dueSoon].reduce((sum, d) => sum + Number(d.amount), 0);
    return { overdueCount: overdue.length, dueSoonCount: dueSoon.length, total };
  }, [deadlines]);

  const addMutation = useMutation({
    mutationFn: async (data: DeadlineFormData) => {
      if (!user?.hospitalType) throw new Error('Hospital type not available');

      const amount = parseFloat(data.amount);
      if (isNaN(amount) || amount <= 0) throw new Error('Amount must be a positive number');

      const { error } = await supabase.from('payment_deadlines').insert([{
        service_name: data.service_name,
        amount,
        due_date: data.due_date,
        status: 'pending' as const,
        hospital_type: user.hospitalType,
        notes: data.notes || null,
      }]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paymentDeadlines'] });
      toast.success('Payment deadline added');
      setIsAddDialogOpen(false);
      setFormData(initialFormData);
    },
    onError: (err) => {
      console.error('Add deadline failed:', getErrorMessage(err));
      toast.error('Failed to add deadline. Please try again.');
    },
  });

  const editMutation = useMutation({
    mutationFn: async (data: DeadlineFormData) => {
      if (!user?.hospitalType) throw new Error('Hospital type not available');

      const amount = parseFloat(data.amount);
      if (isNaN(amount) || amount <= 0) throw new Error('Amount must be a positive number');

      const { error } = await supabase
        .from('payment_deadlines')
        .update({
          service_name: data.service_name,
          amount,
          due_date: data.due_date,
          notes: data.notes || null,
        })
        .eq('id', editingId)
        .eq('hospital_type', user.hospitalType);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paymentDeadlines'] });
      toast.success('Payment deadline updated');
      setEditingId(null);
      setIsAddDialogOpen(false);
      setFormData(initialFormData);
    },
    onError: (err) => {
      console.error('Update failed:', getErrorMessage(err));
      toast.error('Failed to update deadline. Please try again.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!user?.hospitalType) throw new Error('Hospital type not available');

      const { error } = await supabase
        .from('payment_deadlines')
        .delete()
        .eq('id', id)
        .eq('hospital_type', user.hospitalType);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paymentDeadlines'] });
      setShowDeleteConfirm(null);
      toast.success('Payment deadline deleted');
    },
    onError: (err) => {
      console.error('Delete failed:', getErrorMessage(err));
      toast.error('Failed to delete deadline. Please try again.');
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async ({ id, newStatus }: { id: string; newStatus: 'pending' | 'paid' | 'overdue' }) => {
      if (!user?.hospitalType) throw new Error('Hospital type not available');

      const { error } = await supabase
        .from('payment_deadlines')
        .update({ status: newStatus })
        .eq('id', id)
        .eq('hospital_type', user.hospitalType);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paymentDeadlines'] });
      toast.success('Status updated');
    },
    onError: (err) => {
      console.error('Status update failed:', getErrorMessage(err));
      toast.error('Failed to update status. Please try again.');
    },
  });

  const handleSubmit = async () => {
    if (!formData.service_name || !formData.amount || !formData.due_date) {
      toast.error('Please fill in all required fields');
      return;
    }
    if (editingId) {
      await editMutation.mutateAsync(formData);
    } else {
      await addMutation.mutateAsync(formData);
    }
  };

  const handleEdit = (deadline: PaymentDeadline) => {
    setEditingId(deadline.id);
    setFormData({
      service_name: deadline.service_name,
      amount: deadline.amount.toString(),
      due_date: deadline.due_date,
      notes: deadline.notes ?? '',
    });
    setIsAddDialogOpen(true);
  };

  const handleCancel = () => {
    setIsAddDialogOpen(false);
    setEditingId(null);
    setFormData(initialFormData);
  };

  // Director's Files — private Supabase bucket, directors only.
  // Bucket SELECT RLS gates reads; uploads go in under the file's original
  // name and overwrite same-named files. List shows everything in the bucket.
  const DIRECTOR_FILES_BUCKET = 'director-documents';
  const DIRECTOR_FILES_SIGNED_URL_TTL_SECONDS = 300;
  const DIRECTOR_FILES_MAX_BYTES = 25 * 1024 * 1024;

  const loadDirectorFiles = async () => {
    setIsLoadingFiles(true);
    try {
      const { data, error: listError } = await supabase.storage
        .from(DIRECTOR_FILES_BUCKET)
        .list('', {
          limit: 100,
          sortBy: { column: 'updated_at', order: 'desc' },
        });
      if (listError) throw listError;
      // The bucket contains real files only — Supabase sometimes returns a
      // placeholder row named '.emptyFolderPlaceholder' which we filter out.
      const files: DirectorFile[] = (data ?? [])
        .filter((entry) => entry.name && entry.name !== '.emptyFolderPlaceholder')
        .map((entry) => ({
          name: entry.name,
          size: (entry.metadata as { size?: number } | null)?.size ?? null,
          updatedAt: entry.updated_at ?? entry.created_at ?? null,
        }));
      setDirectorFiles(files);
    } catch (err) {
      console.error('Failed to list director files:', getErrorMessage(err));
      toast.error('Could not load files. You may not have permission.');
      setDirectorFiles([]);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleOpenFilesDialog = () => {
    setIsFilesDialogOpen(true);
    void loadDirectorFiles();
  };

  const handleViewFile = async (name: string) => {
    // Open the in-app preview dialog instead of a new browser tab. The
    // dialog dispatches per file kind (PDF iframe, DOCX via mammoth, XLSX
    // via SheetJS). This also sidesteps the entire popup-block problem.
    if (!inferOfficeKindFromName(name)) {
      toast.error('This file type is not supported for preview. Use Download instead.');
      return;
    }
    setIsPreparingPreview(true);
    try {
      const { data, error: signError } = await supabase.storage
        .from(DIRECTOR_FILES_BUCKET)
        .createSignedUrl(name, DIRECTOR_FILES_SIGNED_URL_TTL_SECONDS);
      if (signError || !data?.signedUrl) {
        throw signError ?? new Error('Could not generate file URL.');
      }
      setPreviewState({ name, signedUrl: data.signedUrl });
    } catch (err) {
      console.error('Failed to open file:', getErrorMessage(err));
      toast.error('Could not open the file. Please try again.');
    } finally {
      setIsPreparingPreview(false);
    }
  };

  // Map a file kind to a small display label shown in the file list row.
  const labelForKind = (kind: OfficeFileKind | null): string => {
    switch (kind) {
      case 'pdf': return 'PDF';
      case 'docx': return 'Word';
      case 'xlsx':
      case 'xls': return 'Excel';
      default: return 'File';
    }
  };

  // Per-kind visual treatment for the file row icon: a coloured tile with
  // a kind-appropriate Lucide glyph. Makes the list scannable at a glance.
  const styleForKind = (kind: OfficeFileKind | null) => {
    switch (kind) {
      case 'pdf':
        return { Icon: FileText, tile: 'bg-red-50 ring-red-100', icon: 'text-red-600', badge: 'border-red-200 bg-red-50 text-red-700' };
      case 'docx':
        return { Icon: FileText, tile: 'bg-blue-50 ring-blue-100', icon: 'text-blue-600', badge: 'border-blue-200 bg-blue-50 text-blue-700' };
      case 'xlsx':
      case 'xls':
        return { Icon: FileSpreadsheet, tile: 'bg-emerald-50 ring-emerald-100', icon: 'text-emerald-600', badge: 'border-emerald-200 bg-emerald-50 text-emerald-700' };
      default:
        return { Icon: FileText, tile: 'bg-gray-100 ring-gray-200', icon: 'text-gray-500', badge: 'border-gray-200 bg-gray-50 text-gray-600' };
    }
  };

  // Human-friendly upload timestamp: "Just now", "12 min ago", "Today at
  // 11:25 AM", "Yesterday at 3:42 PM", or "12 May 2026, 11:25 AM".
  const formatFriendlyDate = (iso: string | null): string => {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    const now = new Date();
    const diffMin = Math.floor((now.getTime() - date.getTime()) / 60_000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin} min ago`;
    const time = date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
    const sameDay = date.toDateString() === now.toDateString();
    if (sameDay) return `Today at ${time}`;
    const yesterday = new Date(now.getTime() - 86_400_000);
    if (date.toDateString() === yesterday.toDateString()) return `Yesterday at ${time}`;
    const day = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${day}, ${time}`;
  };

  // Filter the file list by the search query (case-insensitive substring).
  const visibleDirectorFiles = useMemo(() => {
    const q = filesSearch.trim().toLowerCase();
    if (!q) return directorFiles;
    return directorFiles.filter((f) => f.name.toLowerCase().includes(q));
  }, [directorFiles, filesSearch]);

  // Total bytes across all (unfiltered) files for the footer summary.
  const totalFilesBytes = useMemo(
    () => directorFiles.reduce((sum, f) => sum + (f.size ?? 0), 0),
    [directorFiles],
  );

  const handleConfirmDeleteFile = async () => {
    if (!fileToDelete) return;
    setIsDeletingFile(true);
    try {
      const { error: removeError } = await supabase.storage
        .from(DIRECTOR_FILES_BUCKET)
        .remove([fileToDelete]);
      if (removeError) throw removeError;
      toast.success(`Deleted "${fileToDelete}".`);
      setFileToDelete(null);
      await loadDirectorFiles();
    } catch (err) {
      console.error('Delete failed:', getErrorMessage(err));
      toast.error('Could not delete the file. You may not have permission.');
    } finally {
      setIsDeletingFile(false);
    }
  };

  const handlePickActionItemsFile = () => {
    actionItemsFileInputRef.current?.click();
  };

  const performUpload = async (file: File, targetName: string) => {
    setIsUploadingActionItems(true);
    try {
      const { error: uploadError } = await supabase.storage
        .from(DIRECTOR_FILES_BUCKET)
        .upload(targetName, file, {
          upsert: true,
          contentType: file.type || undefined,
          cacheControl: '60',
        });
      if (uploadError) throw uploadError;
      toast.success(`Uploaded "${targetName}".`);
      // Always refresh so the next dialog open shows the new file.
      await loadDirectorFiles();
    } catch (err) {
      console.error('Upload failed:', getErrorMessage(err));
      toast.error('Upload failed. Please check your permissions and try again.');
    } finally {
      setIsUploadingActionItems(false);
    }
  };

  // Shared upload pipeline used by both the file picker and drag-and-drop:
  // validate → sanitize → conflict-check → upload (or queue confirmation).
  const processFileForUpload = async (file: File) => {
    const result = await validateOfficeFile(file);
    if (!result.ok) {
      toast.error(result.reason);
      return;
    }
    const targetName = sanitizeStorageFilename(file.name);
    if (!targetName) {
      toast.error('Filename is not valid after sanitization.');
      return;
    }
    const conflict = directorFiles.some((f) => f.name === targetName);
    if (conflict) {
      setPendingUpload({ file, targetName });
      return;
    }
    await performUpload(file, targetName);
  };

  const handleUploadActionItems = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Always clear the input so re-picking the same filename still fires onChange.
    e.target.value = '';
    if (!file) return;
    await processFileForUpload(file);
  };

  const handleFilesDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!isDraggingFile) setIsDraggingFile(true);
  };

  const handleFilesDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    // Only clear the highlight when the pointer leaves the dropzone itself,
    // not when it crosses into a child element.
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDraggingFile(false);
  };

  const handleFilesDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await processFileForUpload(file);
  };

  const handleConfirmReplaceUpload = async () => {
    if (!pendingUpload) return;
    const { file, targetName } = pendingUpload;
    setPendingUpload(null);
    await performUpload(file, targetName);
  };

  const formatFileSize = (bytes: number | null): string => {
    if (bytes == null) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getStatusBadge = (deadline: PaymentDeadline) => {
    const overdue = isOverdue(deadline.due_date, deadline.status);
    if (deadline.status === 'paid') {
      return <Badge className="bg-green-100 text-green-800">Paid</Badge>;
    }
    if (overdue) {
      return <Badge className="bg-red-100 text-red-800">Overdue</Badge>;
    }
    return <Badge className="bg-yellow-100 text-yellow-800">Due</Badge>;
  };

  return (
    <div className="space-y-6 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Director Dashboard</h1>
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => {
              const el = document.getElementById('daily-revenue-report');
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          >
            <Users className="h-4 w-4 text-emerald-600" />
            Daily Revenue Report
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={handleOpenFilesDialog}
          >
            <FolderOpen className="h-4 w-4 text-blue-600" />
            Director's Files
          </Button>
          <input
            ref={actionItemsFileInputRef}
            type="file"
            accept={OFFICE_ACCEPT_ATTR}
            className="hidden"
            onChange={handleUploadActionItems}
          />
          <p className="text-sm text-gray-600">{user?.email}</p>
        </div>
      </div>

      <DirectorKpiCards />

      <DepartmentActivityMonitor />

      <GovernmentPortalGeneralMedicalSection />

      {(alertSummary.overdueCount > 0 || alertSummary.dueSoonCount > 0) && (
        <div
          role="alert"
          className={`relative rounded-lg border-2 p-5 shadow-lg ${
            alertSummary.overdueCount > 0
              ? 'border-red-600 bg-gradient-to-r from-red-50 to-red-100 animate-pulse'
              : 'border-amber-500 bg-gradient-to-r from-amber-50 to-amber-100'
          }`}
        >
          <div className="flex items-start gap-4">
            <AlertTriangle
              className={`h-10 w-10 flex-shrink-0 ${
                alertSummary.overdueCount > 0 ? 'text-red-600' : 'text-amber-600'
              }`}
            />
            <div className="flex-1">
              <h2
                className={`text-xl font-bold tracking-tight ${
                  alertSummary.overdueCount > 0 ? 'text-red-800' : 'text-amber-800'
                }`}
              >
                {alertSummary.overdueCount + alertSummary.dueSoonCount} PAYMENT
                {alertSummary.overdueCount + alertSummary.dueSoonCount === 1 ? '' : 'S'} NEED YOUR ATTENTION
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-base">
                {alertSummary.overdueCount > 0 && (
                  <span className="font-semibold text-red-700">
                    ⚠️ {alertSummary.overdueCount} OVERDUE
                  </span>
                )}
                {alertSummary.dueSoonCount > 0 && (
                  <span className="font-semibold text-amber-700">
                    ⏰ {alertSummary.dueSoonCount} due in next 7 days
                  </span>
                )}
                <span className="font-bold text-gray-900">
                  Total: ₹{alertSummary.total.toLocaleString('en-IN')}
                </span>
              </div>
            </div>
            <Button
              variant={alertSummary.overdueCount > 0 ? 'destructive' : 'default'}
              className="gap-1 self-center"
              onClick={() => {
                const el = document.getElementById('payment-deadlines-table');
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              View all <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Payment Deadlines Section */}
      <Card id="payment-deadlines-table" className="border-l-4 border-l-blue-500">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-blue-600" />
            <CardTitle>Payment Deadlines</CardTitle>
          </div>
          <Button
            size="sm"
            onClick={() => {
              setEditingId(null);
              setFormData(initialFormData);
              setIsAddDialogOpen(true);
            }}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Deadline
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" role="status" aria-label="Loading payment deadlines" />
            </div>
          ) : error ? (
            <div className="bg-red-50 p-4 rounded text-red-700 text-sm">
              Failed to load payment deadlines. Please refresh the page.
            </div>
          ) : sortedDeadlines.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Wallet className="h-12 w-12 mx-auto mb-2 opacity-30" />
              <p>No payment deadlines. Click "Add Deadline" to get started.</p>
            </div>
          ) : (
            <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead>Service</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedDeadlines.map((deadline) => (
                    <TableRow key={deadline.id} className="hover:bg-gray-50">
                      <TableCell className="font-medium">{deadline.service_name}</TableCell>
                      <TableCell className="flex items-center gap-1">
                        <DollarSign className="h-4 w-4 text-gray-500" />
                        {deadline.amount.toLocaleString('en-IN')}
                      </TableCell>
                      <TableCell className="flex items-center gap-1">
                        <Calendar className="h-4 w-4 text-gray-500" />
                        {new Date(deadline.due_date).toLocaleDateString('en-IN')}
                      </TableCell>
                      <TableCell>{getStatusBadge(deadline)}</TableCell>
                      <TableCell className="text-right space-x-2">
                        {deadline.status !== 'paid' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Mark as paid"
                            onClick={() => toggleStatusMutation.mutate({ id: deadline.id, newStatus: 'paid' })}
                          >
                            <CheckCircle className="h-4 w-4 text-green-600" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Mark as pending"
                            onClick={() => toggleStatusMutation.mutate({ id: deadline.id, newStatus: 'pending' })}
                          >
                            <AlertTriangle className="h-4 w-4 text-yellow-600" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Edit deadline"
                          onClick={() => handleEdit(deadline)}
                        >
                          <Edit2 className="h-4 w-4 text-blue-600" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Delete deadline"
                          onClick={() => setShowDeleteConfirm(deadline.id)}
                        >
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Daily Revenue Report Section */}
      <DailyRevenueReportSection />

      {/* Monthly Financial Statements: income, expenses, receivables, payables, marketing revenue */}
      <DirectorFinancialStatements />

      {/* Navigation Cards Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="hover:shadow-lg transition-shadow border-l-4 border-l-blue-500">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-600" />
              Advance Statement Report
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-gray-600">Yojana patients with intimation, package and bill submission details</p>
            <Button variant="outline" className="w-full justify-between" onClick={() => navigate('/advance-statement-report')}>
              View Details <ArrowRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow border-l-4 border-l-purple-500">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-purple-600" />
              Payment Allocation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-gray-600">Manage daily payment allocation and distribution</p>
            <Button variant="outline" className="w-full justify-between" onClick={() => navigate('/daily-payment-allocation')}>
              View Details <ArrowRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow border-l-4 border-l-orange-500">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-orange-600" />
              IPD Approvals & Discounts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-gray-600">Approve bills and manage IPD discounts</p>
            <Button variant="outline" className="w-full justify-between" onClick={() => navigate('/bill-approvals')}>
              View Details <ArrowRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Director Projects Launcher (visible only to cmd@hopehospital.com) */}
      <DirectorProjectLauncher email={user?.email} />

      {/* Director's Files Dialog */}
      <Dialog open={isFilesDialogOpen} onOpenChange={setIsFilesDialogOpen}>
        <DialogContent
          className="max-w-3xl"
          onDragOver={handleFilesDragOver}
          onDragLeave={handleFilesDragLeave}
          onDrop={handleFilesDrop}
        >
          <DialogHeader>
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-blue-50 ring-1 ring-blue-100 p-2.5">
                <FolderOpen className="h-5 w-5 text-blue-600" />
              </div>
              <div className="flex-1">
                <DialogTitle className="text-lg">Director's Files</DialogTitle>
                <p className="text-sm text-gray-500 mt-0.5">
                  Private documents — PDF, Word, and Excel. Visible only to directors.
                </p>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-3">
            {/* Search + Upload row */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                <Input
                  type="search"
                  placeholder="Search files…"
                  value={filesSearch}
                  onChange={(e) => setFilesSearch(e.target.value)}
                  className="pl-9"
                  aria-label="Search files by name"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                className="gap-2 shrink-0"
                onClick={handlePickActionItemsFile}
                disabled={isUploadingActionItems}
              >
                <Upload className="h-4 w-4 text-emerald-600" />
                {isUploadingActionItems ? 'Uploading…' : 'Upload file'}
              </Button>
            </div>

            {/* File list / states */}
            <div
              className={`relative rounded-lg border transition-colors ${
                isDraggingFile ? 'border-emerald-400 bg-emerald-50/40 border-dashed border-2' : 'border-gray-200'
              }`}
            >
              {isDraggingFile && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center pointer-events-none bg-emerald-50/80 rounded-lg">
                  <Upload className="h-10 w-10 text-emerald-600 mb-2" />
                  <p className="font-medium text-emerald-800">Drop to upload</p>
                  <p className="text-xs text-emerald-700/80">PDF, Word, or Excel · up to 25 MB</p>
                </div>
              )}

              {isLoadingFiles ? (
                <div className="flex justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" role="status" aria-label="Loading files" />
                </div>
              ) : directorFiles.length === 0 ? (
                <div className="text-center py-12 px-6">
                  <div className="mx-auto h-14 w-14 rounded-full bg-blue-50 flex items-center justify-center mb-3">
                    <FolderOpen className="h-7 w-7 text-blue-500" />
                  </div>
                  <p className="font-medium text-gray-800">No files yet</p>
                  <p className="text-sm text-gray-500 mt-1">
                    Drag a file here, or click <span className="font-medium">Upload file</span> above.
                  </p>
                </div>
              ) : visibleDirectorFiles.length === 0 ? (
                <div className="text-center py-10 px-6 text-sm text-gray-500">
                  No files match "<span className="font-medium">{filesSearch}</span>".
                </div>
              ) : (
                <ul className="divide-y divide-gray-100 max-h-[60vh] overflow-y-auto">
                  {visibleDirectorFiles.map((file) => {
                    const kind = inferOfficeKindFromName(file.name);
                    const style = styleForKind(kind);
                    const Icon = style.Icon;
                    return (
                      <li
                        key={file.name}
                        className="group flex items-center gap-3 p-3 hover:bg-gray-50 transition-colors"
                      >
                        <div className={`shrink-0 rounded-lg ring-1 p-2.5 ${style.tile}`}>
                          <Icon className={`h-5 w-5 ${style.icon}`} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-gray-900 truncate" title={file.name}>
                              {file.name}
                            </p>
                            <Badge
                              variant="outline"
                              className={`text-[10px] uppercase tracking-wide shrink-0 ${style.badge}`}
                            >
                              {labelForKind(kind)}
                            </Badge>
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {formatFileSize(file.size)} · {formatFriendlyDate(file.updatedAt)}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1.5 text-blue-700 hover:text-blue-800 hover:bg-blue-50"
                            onClick={() => handleViewFile(file.name)}
                            disabled={isPreparingPreview}
                          >
                            <Eye className="h-4 w-4" />
                            <span className="hidden sm:inline">Preview</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Delete ${file.name}`}
                            className="text-gray-500 hover:text-red-600 hover:bg-red-50"
                            onClick={() => setFileToDelete(file.name)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Summary footer */}
            {directorFiles.length > 0 && (
              <div className="flex items-center justify-between text-xs text-gray-500 px-1">
                <span>
                  {filesSearch
                    ? `${visibleDirectorFiles.length} of ${directorFiles.length} `
                    : `${directorFiles.length} `}
                  {directorFiles.length === 1 ? 'file' : 'files'}
                </span>
                <span className="flex items-center gap-1.5">
                  <HardDrive className="h-3 w-3" />
                  {formatFileSize(totalFilesBytes)} total
                </span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsFilesDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* File Preview Dialog (PDF / DOCX / XLSX / XLS) */}
      <DirectorFilePreviewDialog
        open={!!previewState}
        onOpenChange={(open) => !open && setPreviewState(null)}
        fileName={previewState?.name ?? null}
        signedUrl={previewState?.signedUrl ?? null}
      />

      {/* Replace File Confirmation Dialog */}
      <Dialog open={!!pendingUpload} onOpenChange={(open) => !open && setPendingUpload(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace existing file?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">
            A file named <span className="font-medium">{pendingUpload?.targetName}</span> already exists in Director's Files. Uploading will replace the existing copy. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingUpload(null)} disabled={isUploadingActionItems}>Cancel</Button>
            <Button onClick={handleConfirmReplaceUpload} disabled={isUploadingActionItems}>
              {isUploadingActionItems ? 'Uploading…' : 'Replace'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete File Confirmation Dialog */}
      <Dialog open={!!fileToDelete} onOpenChange={(open) => !open && setFileToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete file?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">
            This will permanently delete <span className="font-medium">{fileToDelete}</span> from Supabase. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFileToDelete(null)} disabled={isDeletingFile}>Cancel</Button>
            <Button variant="destructive" onClick={handleConfirmDeleteFile} disabled={isDeletingFile}>
              {isDeletingFile ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!showDeleteConfirm} onOpenChange={(open) => !open && setShowDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Payment Deadline?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">This action cannot be undone. Are you sure you want to delete this payment deadline?</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => showDeleteConfirm && deleteMutation.mutate(showDeleteConfirm)}
              disabled={deleteMutation.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add/Edit Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Payment Deadline' : 'Add Payment Deadline'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="service_name">Service Name</Label>
              <Input
                id="service_name"
                placeholder="e.g. EMI, Electricity Bill, TDS"
                value={formData.service_name}
                maxLength={100}
                onChange={(e) => setFormData({ ...formData, service_name: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="amount">Amount (₹)</Label>
              <Input
                id="amount"
                type="number"
                placeholder="Amount"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="due_date">Due Date</Label>
              <Input
                id="due_date"
                type="date"
                value={formData.due_date}
                onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Input
                id="notes"
                placeholder="Additional notes"
                value={formData.notes}
                maxLength={500}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancel}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={addMutation.isPending || editMutation.isPending}
            >
              {editingId ? 'Update' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
