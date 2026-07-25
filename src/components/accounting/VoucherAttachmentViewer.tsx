import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Image as ImageIcon, Paperclip } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  VOUCHER_ATTACHMENT_CATEGORIES,
  type VoucherAttachment,
  type VoucherAttachmentCategory,
} from '@/lib/voucher-attachments';

const mapRow = (row: any): VoucherAttachment => ({
  id: row.id,
  voucherId: row.voucher_id,
  fileName: row.file_name,
  fileUrl: row.file_url || '',
  fileType: row.file_type || 'application/octet-stream',
  fileSize: Number(row.file_size || 0),
  storagePath: row.storage_path || '',
  category: row.category as VoucherAttachmentCategory,
  createdAt: row.created_at,
});

export function useVoucherAttachmentMap(voucherIds: string[]) {
  const stableIds = useMemo(() => [...new Set(voucherIds.filter(Boolean))].sort(), [voucherIds.join('|')]);
  return useQuery({
    queryKey: ['voucher-attachments', stableIds],
    enabled: stableIds.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('file_uploads')
        .select('id, voucher_id, file_name, file_url, file_type, file_size, storage_path, category, created_at')
        .in('voucher_id', stableIds)
        .in('category', [...VOUCHER_ATTACHMENT_CATEGORIES])
        .order('created_at', { ascending: true });
      if (error) throw error;
      const result = new Map<string, VoucherAttachment[]>();
      for (const row of data || []) {
        const list = result.get(row.voucher_id) || [];
        list.push(mapRow(row));
        result.set(row.voucher_id, list);
      }
      return result;
    },
  });
}

export function VoucherAttachmentButton({
  attachments,
  voucherNumber,
}: {
  attachments: VoucherAttachment[];
  voucherNumber: string;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<VoucherAttachment | null>(null);
  if (!attachments.length) return <span className="inline-block w-8" />;
  const active = selected || attachments[0];
  const isImage = active.fileType.startsWith('image/');
  const isPdf = active.fileType === 'application/pdf' || active.fileName.toLowerCase().endsWith('.pdf');

  return (
    <>
      <button
        type="button"
        title={`View ${attachments.length} voucher attachment${attachments.length === 1 ? '' : 's'}`}
        aria-label={`View attachments for voucher ${voucherNumber}`}
        onClick={(event) => {
          event.stopPropagation();
          setSelected(attachments[0]);
          setOpen(true);
        }}
        className="relative inline-flex h-7 w-8 items-center justify-center rounded text-blue-700 hover:bg-blue-100"
      >
        <Paperclip className="h-4 w-4" />
        <span className="absolute right-0 top-0 rounded-full bg-blue-700 px-1 text-[9px] leading-3 text-white">
          {attachments.length}
        </span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[88vh] max-w-6xl flex-col">
          <DialogHeader>
            <DialogTitle>Voucher {voucherNumber} documents</DialogTitle>
          </DialogHeader>
          <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[240px_minmax(0,1fr)]">
            <div className="space-y-2 overflow-y-auto">
              {attachments.map((attachment) => (
                <button
                  key={attachment.id || attachment.storagePath}
                  type="button"
                  onClick={() => setSelected(attachment)}
                  className={`flex w-full items-center gap-2 rounded border p-2 text-left ${
                    active.storagePath === attachment.storagePath ? 'border-blue-500 bg-blue-50' : 'hover:bg-slate-50'
                  }`}
                >
                  {attachment.fileType.startsWith('image/') ? (
                    <ImageIcon className="h-4 w-4 shrink-0 text-blue-600" />
                  ) : (
                    <FileText className="h-4 w-4 shrink-0 text-red-600" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm">{attachment.fileName}</span>
                </button>
              ))}
            </div>
            <div className="flex min-h-0 items-center justify-center overflow-hidden rounded border bg-slate-100">
              {isImage ? (
                <img src={active.fileUrl} alt={active.fileName} className="max-h-full max-w-full object-contain" />
              ) : isPdf ? (
                <iframe src={active.fileUrl} title={active.fileName} className="h-full min-h-[520px] w-full bg-white" />
              ) : (
                <Button asChild>
                  <a href={active.fileUrl} target="_blank" rel="noreferrer">Open {active.fileName}</a>
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
