import { supabase } from '@/integrations/supabase/client';

// Upload a bill photo/PDF to the `uploads` bucket and return its public URL
// (or null on failure — the attachment is optional, so a failed upload never
// blocks saving the deadline). Shared by the dashboard scan and the Skill
// Factory scan menu.
export async function uploadBillAttachment(file: Blob, fileName: string): Promise<string | null> {
  try {
    const safeName = (fileName || 'bill').replace(/[^a-z0-9.\-_]/gi, '_');
    const path = `utility-deadlines/${Date.now()}-${safeName}`;
    const { error } = await supabase.storage.from('uploads').upload(path, file, {
      upsert: false,
      cacheControl: '3600',
    });
    if (error) throw error;
    const { data } = supabase.storage.from('uploads').getPublicUrl(path);
    return data.publicUrl;
  } catch (e) {
    console.warn('[uploadBillAttachment] upload failed', e);
    return null;
  }
}
