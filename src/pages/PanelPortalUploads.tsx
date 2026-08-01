import { useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, FileText, Loader2, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// One portal-upload page per panel/corporate — WCL, ECHS, ESIC and the rest —
// in the spirit of the Yojana CSV upload: whatever the panel's portal shows
// (dashboard screenshots, exported statements) is filed here under that
// panel's name, so the portal position on any date can be produced later
// without logging into the portal again.
//
// The list of panels IS the corporate master; a new tie-up gets its page
// without a code change. Files live in the `uploads` bucket and are recorded
// in file_uploads with category `panel_portal` and the panel name, so no new
// table or migration is needed.

const CATEGORY = 'panel_portal';

interface PanelUpload {
  id: string;
  file_name: string;
  file_url: string | null;
  file_type: string;
  storage_path: string;
  created_at: string | null;
  uploaded_by: string | null;
}

const PanelPortalUploads = () => {
  const { panelName } = useParams<{ panelName: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const panel = panelName ? decodeURIComponent(panelName) : null;

  const { data: panels = [] } = useQuery({
    queryKey: ['panel-portal-corporates'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('corporate').select('id, name').order('name');
      if (error) throw error;
      return data || [];
    },
  });

  const { data: uploads = [], isLoading } = useQuery({
    queryKey: ['panel-portal-uploads', panel],
    enabled: !!panel,
    queryFn: async (): Promise<PanelUpload[]> => {
      const { data, error } = await supabase
        .from('file_uploads')
        .select('id, file_name, file_url, file_type, storage_path, created_at, uploaded_by')
        .eq('category', CATEGORY)
        .eq('patient_name', panel!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as PanelUpload[];
    },
  });

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length || !panel) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const sanitized = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storagePath = `uploads/panel_portal/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${sanitized}`;
        const { error: storageError } = await supabase.storage
          .from('uploads')
          .upload(storagePath, file, { contentType: file.type || 'application/octet-stream' });
        if (storageError) throw storageError;
        const { data: urlData } = supabase.storage.from('uploads').getPublicUrl(storagePath);
        const { error: insertError } = await supabase.from('file_uploads').insert({
          file_name: file.name,
          file_url: urlData?.publicUrl || '',
          file_type: file.type || 'application/octet-stream',
          file_size: file.size,
          storage_path: storagePath,
          category: CATEGORY,
          patient_id: null,
          patient_name: panel,
          uploaded_by: user?.id ?? null,
          notes: `PANEL_PORTAL|${panel}`,
        } as any);
        if (insertError) throw insertError;
      }
      toast.success(`${files.length} file(s) uploaded for ${panel}`);
      queryClient.invalidateQueries({ queryKey: ['panel-portal-uploads', panel] });
    } catch (error: any) {
      toast.error(`Upload failed: ${error?.message || 'unknown error'}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (upload: PanelUpload) => {
    if (!window.confirm(`Delete ${upload.file_name}?`)) return;
    try {
      if (upload.storage_path) await supabase.storage.from('uploads').remove([upload.storage_path]);
      const { error } = await supabase.from('file_uploads').delete().eq('id', upload.id);
      if (error) throw error;
      toast.success('File removed');
      queryClient.invalidateQueries({ queryKey: ['panel-portal-uploads', panel] });
    } catch (error: any) {
      toast.error(`Could not delete: ${error?.message || 'unknown error'}`);
    }
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Building2 className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">{panel ? `${panel} — Portal Uploads` : 'Panel Portal Uploads'}</h1>
            <p className="text-sm text-muted-foreground">
              File the panel portal's dashboard — screenshots or exported statements — under the panel it belongs to.
            </p>
          </div>
        </div>
        {panel && (
          <div>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*,.pdf,.csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                void handleUpload(e.target.files);
                e.target.value = '';
              }}
            />
            <Button disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              {uploading ? 'Uploading…' : 'Upload portal files'}
            </Button>
          </div>
        )}
      </div>

      {/* Panel switcher — every corporate on the master gets its page. */}
      <div className="flex flex-wrap gap-2">
        {panels.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => navigate(`/panel-portal/${encodeURIComponent(p.name)}`)}
            className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
              panel === p.name ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'
            }`}
          >
            {p.name}
          </button>
        ))}
      </div>

      {!panel ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Pick a panel above to see and upload its portal files.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {uploads.length} file{uploads.length === 1 ? '' : 's'} on record for {panel}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
            ) : uploads.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nothing uploaded for {panel} yet.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {uploads.map((upload) => (
                  <div key={upload.id} className="rounded-lg border p-3">
                    <a href={upload.file_url || '#'} target="_blank" rel="noreferrer" className="block">
                      {upload.file_type.startsWith('image/') && upload.file_url ? (
                        <img
                          src={upload.file_url}
                          alt={upload.file_name}
                          className="h-36 w-full rounded object-cover"
                        />
                      ) : (
                        <div className="flex h-36 w-full items-center justify-center rounded bg-muted">
                          <FileText className="h-10 w-10 text-muted-foreground" />
                        </div>
                      )}
                    </a>
                    <div className="mt-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium" title={upload.file_name}>{upload.file_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {upload.created_at ? new Date(upload.created_at).toLocaleString('en-IN') : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleDelete(upload)}
                        className="shrink-0 text-destructive hover:opacity-70"
                        title="Delete file"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default PanelPortalUploads;
