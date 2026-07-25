import { useRef, useState, type RefObject } from 'react';
import { FileImage, FileText, Loader2, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  discardVoucherAttachments,
  uploadVoucherAttachments,
  VOUCHER_INVOICE_CATEGORY,
  VOUCHER_PAYMENT_PROOF_CATEGORY,
  type VoucherAttachment,
  type VoucherAttachmentCategory,
} from '@/lib/voucher-attachments';

interface VoucherAttachmentFieldsProps {
  attachments: VoucherAttachment[];
  onChange: (attachments: VoucherAttachment[]) => void;
  disabled?: boolean;
  compact?: boolean;
}

export function VoucherAttachmentFields({
  attachments,
  onChange,
  disabled,
  compact,
}: VoucherAttachmentFieldsProps) {
  const invoiceRef = useRef<HTMLInputElement>(null);
  const paymentRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<VoucherAttachmentCategory | null>(null);

  const addFiles = async (files: File[], category: VoucherAttachmentCategory) => {
    if (!files.length) return;
    setUploading(category);
    try {
      const uploaded = await uploadVoucherAttachments(files, category);
      const next = [...attachments, ...uploaded];
      onChange(next);
      toast.success(`${uploaded.length} document${uploaded.length === 1 ? '' : 's'} uploaded`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setUploading(null);
    }
  };

  const removeStaged = async (attachment: VoucherAttachment) => {
    if (attachment.id) return;
    await discardVoucherAttachments([attachment]);
    onChange(attachments.filter((item) => item.storagePath !== attachment.storagePath));
  };

  const group = (
    category: VoucherAttachmentCategory,
    title: string,
    required: boolean,
    ref: RefObject<HTMLInputElement>,
  ) => {
    const files = attachments.filter((item) => item.category === category);
    const busy = uploading === category;
    return (
      <div className="rounded-lg border border-slate-300 bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-slate-800">
              {title}{required && <span className="ml-1 text-red-600">*</span>}
            </div>
            <div className="text-xs text-slate-500">Images or PDF · multiple files allowed · max 12 MB each</div>
          </div>
          <Button
            type="button"
            variant="outline"
            size={compact ? 'sm' : 'default'}
            disabled={disabled || busy}
            onClick={() => ref.current?.click()}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Upload
          </Button>
          <input
            ref={ref}
            type="file"
            accept="image/*,.pdf,application/pdf"
            multiple
            className="hidden"
            onChange={(event) => {
              void addFiles(Array.from(event.target.files || []), category);
              event.target.value = '';
            }}
          />
        </div>
        {files.length > 0 && (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {files.map((file) => (
              <div key={file.storagePath} className="flex min-w-0 items-center gap-2 rounded border bg-slate-50 px-2 py-1.5">
                {file.fileType.startsWith('image/') ? (
                  <FileImage className="h-4 w-4 shrink-0 text-blue-600" />
                ) : (
                  <FileText className="h-4 w-4 shrink-0 text-red-600" />
                )}
                <a
                  href={file.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate text-xs font-medium text-blue-700 hover:underline"
                >
                  {file.fileName}
                </a>
                {!file.id && (
                  <button
                    type="button"
                    aria-label={`Remove ${file.fileName}`}
                    onClick={() => void removeStaged(file)}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        {group(VOUCHER_INVOICE_CATEGORY, 'Invoice / Bill / Approval', true, invoiceRef)}
        {group(VOUCHER_PAYMENT_PROOF_CATEGORY, 'PhonePe / Bank Payment Screenshot', false, paymentRef)}
      </div>
      <p className="text-xs text-slate-500">
        Uploading documents only attaches them to this voucher. Enter the voucher details and narration manually.
      </p>
    </div>
  );
}
