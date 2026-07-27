import { supabase } from '@/integrations/supabase/client';

export const VOUCHER_INVOICE_CATEGORY = 'voucher_invoice_approval';
export const VOUCHER_PAYMENT_PROOF_CATEGORY = 'voucher_payment_proof';
export const VOUCHER_ATTACHMENT_CATEGORIES = [
  VOUCHER_INVOICE_CATEGORY,
  VOUCHER_PAYMENT_PROOF_CATEGORY,
] as const;

export type VoucherAttachmentCategory = (typeof VOUCHER_ATTACHMENT_CATEGORIES)[number];

export interface VoucherAttachment {
  id?: string;
  voucherId?: string | null;
  fileName: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
  storagePath: string;
  category: VoucherAttachmentCategory;
  createdAt?: string | null;
  file?: File;
}

const BUCKET = 'uploads';
const MAX_FILE_SIZE = 12 * 1024 * 1024;

const isSupported = (file: File) =>
  file.type.startsWith('image/') ||
  file.type === 'application/pdf' ||
  file.name.toLowerCase().endsWith('.pdf');

export async function uploadVoucherAttachments(
  files: File[],
  category: VoucherAttachmentCategory,
): Promise<VoucherAttachment[]> {
  const uploaded: VoucherAttachment[] = [];
  try {
    for (const file of files) {
      if (!isSupported(file)) throw new Error(`${file.name}: upload an image or PDF`);
      if (file.size > MAX_FILE_SIZE) throw new Error(`${file.name}: file must be 12 MB or smaller`);

      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `voucher-attachments/${Date.now()}_${crypto.randomUUID()}_${safeName}`;
      const { error } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });
      if (error) throw error;
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
      uploaded.push({
        fileName: file.name,
        fileUrl: data.publicUrl,
        fileType: file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream'),
        fileSize: file.size,
        storagePath,
        category,
        file,
      });
    }
    return uploaded;
  } catch (error) {
    if (uploaded.length) {
      await supabase.storage.from(BUCKET).remove(uploaded.map((item) => item.storagePath));
    }
    throw error;
  }
}

export async function discardVoucherAttachments(attachments: VoucherAttachment[]): Promise<void> {
  const stagedPaths = attachments.filter((item) => !item.id).map((item) => item.storagePath);
  if (stagedPaths.length) await supabase.storage.from(BUCKET).remove(stagedPaths);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function linkVoucherAttachments(
  voucherId: string,
  attachments: VoucherAttachment[],
  uploadedBy?: string | null,
): Promise<void> {
  const staged = attachments.filter((item) => !item.id);
  if (!staged.length) return;
  const { error } = await (supabase as any).from('file_uploads').insert(
    staged.map((item) => ({
      voucher_id: voucherId,
      file_name: item.fileName,
      file_url: item.fileUrl,
      file_type: item.fileType,
      file_size: item.fileSize,
      storage_path: item.storagePath,
      category: item.category,
      // uploaded_by is a uuid column. Callers pass a display name - username,
      // email, or 'system' - and a superadmin logging in as 'superadmin' made
      // that a hard failure on save: the voucher was written, then linking the
      // attachment threw 'invalid input syntax for type uuid'. Anything that is
      // not a uuid is dropped rather than sent; the column is nullable.
      uploaded_by: uploadedBy && UUID_RE.test(uploadedBy.trim())
        ? uploadedBy.trim()
        : null,
      status: 'completed',
      capture_source: 'file_picker',
    })),
  );
  if (error) throw new Error(error.message || 'Could not link voucher attachments');
}

export function missingVoucherTags(narration: string, tags: string[]): string[] {
  const normalized = narration.toLocaleLowerCase();
  return tags.filter((tag) => !normalized.includes(tag.toLocaleLowerCase()));
}
