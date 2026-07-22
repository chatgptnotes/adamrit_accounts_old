import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Download, Eye, FileText, Image as ImageIcon, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RADIOLOGY_UPLOAD_CATEGORIES, RADIOLOGY_UPLOAD_CATEGORY_LABELS } from '@/lib/radiologyUploads';

export type RadiologyUpload = {
  id: string;
  file_name: string;
  file_url: string | null;
  file_type: string;
  file_size: number;
  storage_path: string;
  category: string | null;
  patient_id: string | null;
  patient_name: string | null;
  notes: string | null;
  created_at: string | null;
};

type RadiologyUploadsPanelProps = {
  title?: string;
  limit?: number;
  patientId?: string | null;
  searchTerm?: string;
  fromDate?: Date;
  toDate?: Date;
  compact?: boolean;
};

const formatSize = (bytes: number) => {
  if (!bytes) return '-';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const isImage = (fileType: string | null | undefined) => (fileType || '').startsWith('image/');
const isPdf = (fileType: string | null | undefined) => (fileType || '').includes('pdf');

export function useRadiologyUploads({
  limit = 20,
  patientId,
  searchTerm,
  fromDate,
  toDate,
}: Omit<RadiologyUploadsPanelProps, 'title' | 'compact'> = {}) {
  return useQuery({
    queryKey: [
      'radiology-file-uploads',
      limit,
      patientId || null,
      searchTerm || '',
      fromDate?.toISOString() || null,
      toDate?.toISOString() || null,
    ],
    staleTime: 1000 * 15,
    queryFn: async (): Promise<RadiologyUpload[]> => {
      let query = supabase
        .from('file_uploads')
        .select('id, file_name, file_url, file_type, file_size, storage_path, category, patient_id, patient_name, notes, created_at')
        .in('category', [...RADIOLOGY_UPLOAD_CATEGORIES])
        .order('created_at', { ascending: false })
        .limit(limit);

      if (patientId) query = query.eq('patient_id', patientId);
      if (fromDate) query = query.gte('created_at', fromDate.toISOString());
      if (toDate) {
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        query = query.lte('created_at', end.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;

      const term = (searchTerm || '').trim().toLowerCase();
      const rows = (data || []) as RadiologyUpload[];
      if (!term) return rows;
      return rows.filter((row) =>
        [
          row.patient_name,
          row.file_name,
          row.category,
          row.notes,
        ].some((value) => String(value || '').toLowerCase().includes(term)),
      );
    },
  });
}

export function RadiologyUploadsPanel({
  title = 'Recent Radiology Images',
  limit = 12,
  patientId,
  searchTerm,
  fromDate,
  toDate,
  compact = false,
}: RadiologyUploadsPanelProps) {
  const uploads = useRadiologyUploads({ limit, patientId, searchTerm, fromDate, toDate });
  const [viewing, setViewing] = useState<RadiologyUpload | null>(null);

  const rows = uploads.data || [];
  const emptyText = useMemo(() => {
    if (patientId) return 'No uploaded radiology images/reports for this patient.';
    return 'No uploaded radiology images/reports found.';
  }, [patientId]);

  const openInNewTab = (upload: RadiologyUpload) => {
    if (upload.file_url) window.open(upload.file_url, '_blank', 'noopener,noreferrer');
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ImageIcon className="h-5 w-5 text-purple-600" />
            {title}
            <Badge variant="secondary">{rows.length}</Badge>
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => uploads.refetch()} disabled={uploads.isFetching}>
            <RefreshCw className={`h-4 w-4 ${uploads.isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </CardHeader>
        <CardContent>
          {uploads.isLoading ? (
            <div className="py-6 text-center text-sm text-muted-foreground">Loading uploaded radiology files...</div>
          ) : uploads.isError ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              Could not load uploaded radiology files.
            </div>
          ) : rows.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">{emptyText}</div>
          ) : (
            <div className={compact ? 'space-y-2' : 'grid gap-3 md:grid-cols-2 xl:grid-cols-3'}>
              {rows.map((upload) => (
                <div key={upload.id} className="rounded-lg border bg-white p-3 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100">
                      {isImage(upload.file_type) && upload.file_url ? (
                        <img src={upload.file_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <FileText className="h-5 w-5 text-slate-500" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-900">
                        {upload.patient_name || 'Unknown patient'}
                      </div>
                      <div className="truncate text-xs text-slate-600">{upload.file_name}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge variant="outline" className="text-[10px]">
                          {RADIOLOGY_UPLOAD_CATEGORY_LABELS[upload.category || ''] || upload.category || 'Radiology'}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">{formatSize(upload.file_size)}</Badge>
                      </div>
                      {upload.created_at && (
                        <div className="mt-1 text-[11px] text-slate-500">
                          {format(new Date(upload.created_at), 'dd MMM yyyy, hh:mm a')}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 flex-1 gap-1 text-xs"
                      onClick={() => setViewing(upload)}
                      disabled={!upload.file_url}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      View
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 flex-1 gap-1 text-xs"
                      onClick={() => openInNewTab(upload)}
                      disabled={!upload.file_url}
                    >
                      <Download className="h-3.5 w-3.5" />
                      Open
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!viewing} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">
              {viewing?.patient_name || 'Radiology upload'} - {viewing?.file_name}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[75vh] overflow-auto rounded-md border bg-slate-50 p-2">
            {viewing?.file_url && isImage(viewing.file_type) ? (
              <img src={viewing.file_url} alt={viewing.file_name} className="mx-auto max-h-[70vh] max-w-full object-contain" />
            ) : viewing?.file_url && isPdf(viewing.file_type) ? (
              <iframe title={viewing.file_name} src={viewing.file_url} className="h-[70vh] w-full rounded bg-white" />
            ) : viewing?.file_url ? (
              <div className="p-6 text-center">
                <Button onClick={() => openInNewTab(viewing)}>Open file</Button>
              </div>
            ) : (
              <div className="p-6 text-center text-sm text-muted-foreground">No file URL available.</div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default RadiologyUploadsPanel;
