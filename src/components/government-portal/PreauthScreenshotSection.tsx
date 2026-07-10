import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Camera, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/contexts/AuthContext';
import { extractPreauthSubmissionList } from '@/lib/extractPreauthSubmissionList';
import {
  fetchPreauthSubmissionUploads,
  savePreauthSubmissionUpload,
  updatePreauthSubmissionRowStatus,
  type PreauthListType,
  type PreauthSubmissionUpload,
} from '@/lib/preauthSubmissionDb';

interface PreauthScreenshotSectionProps {
  listType: PreauthListType;
  title: string;
  description: string;
}

// One screenshot-upload lane for the NHA provider portal's preauthorization
// card lists. Rendered twice on the import page — "to be submitted" and
// "pending" — each tracking its own uploads independently via `listType`.
export function PreauthScreenshotSection({ listType, title, description }: PreauthScreenshotSectionProps) {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploads, setUploads] = useState<PreauthSubmissionUpload[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExtracting, setIsExtracting] = useState(false);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      try {
        const data = await fetchPreauthSubmissionUploads(listType);
        if (!cancelled) setUploads(data);
      } catch (error) {
        if (!cancelled) {
          console.error(`Failed to load ${listType} preauth uploads:`, error);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [listType]);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Upload a screenshot image (PNG or JPG)');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setIsExtracting(true);
    try {
      const cases = await extractPreauthSubmissionList(file);
      const saved = await savePreauthSubmissionUpload(file, cases, user?.email || user?.username || null, listType);
      setUploads((current) => [saved, ...current]);
      toast.success(`Read ${cases.length} patient case(s) from the screenshot.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not read the screenshot';
      console.error(`${listType} preauth screenshot extraction failed:`, error);
      toast.error(message);
    } finally {
      setIsExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleToggleRowStatus = async (rowId: string, uploadId: string, nextStatus: 'pending' | 'submitted') => {
    setSavingRowId(rowId);
    try {
      await updatePreauthSubmissionRowStatus(rowId, nextStatus);
      setUploads((current) =>
        current.map((upload) =>
          upload.id !== uploadId
            ? upload
            : {
                ...upload,
                rows: upload.rows.map((row) => (row.id === rowId ? { ...row, status: nextStatus } : row)),
              },
        ),
      );
    } catch (error) {
      console.error(`Failed to update ${listType} preauth row status:`, error);
      toast.error('Could not update status');
    } finally {
      setSavingRowId(null);
    }
  };

  return (
    <Card className="border-amber-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Camera className="h-5 w-5 text-amber-600" />
          {title}
        </CardTitle>
        <p className="text-sm text-gray-500">{description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={isExtracting}
            className="bg-amber-600 text-white hover:bg-amber-700"
          >
            {isExtracting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            {isExtracting ? 'Reading screenshot…' : 'Upload Screenshot'}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void handleFileChange(e)}
          />
          {isLoading && <span className="text-sm text-gray-500">Loading saved uploads…</span>}
        </div>

        {!isLoading && uploads.length === 0 && (
          <div className="rounded-lg border border-dashed bg-gray-50 p-6 text-center text-sm text-gray-500">
            No screenshots uploaded yet.
          </div>
        )}

        {uploads.map((upload) => {
          const pendingCount = upload.rows.filter((row) => row.status === 'pending').length;
          return (
            <div key={upload.id} className="space-y-3 rounded-lg border bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-gray-800">{upload.fileName}</p>
                  <p className="text-xs text-gray-500">
                    {new Date(upload.createdAt).toLocaleString('en-IN')}
                    {upload.uploadedBy ? ` · ${upload.uploadedBy}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
                    {pendingCount} pending
                  </Badge>
                  <a
                    href={upload.imageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-medium text-blue-600 hover:underline"
                  >
                    View screenshot
                  </a>
                </div>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Patient</TableHead>
                      <TableHead>Age / Gender</TableHead>
                      <TableHead>Program ID</TableHead>
                      <TableHead>Registration ID</TableHead>
                      <TableHead>Registration Date</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {upload.rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">{row.patientName || '-'}</TableCell>
                        <TableCell>
                          {row.ageLabel || '-'}
                          {row.gender ? ` · ${row.gender}` : ''}
                        </TableCell>
                        <TableCell>{row.programId || '-'}</TableCell>
                        <TableCell>{row.registrationId || '-'}</TableCell>
                        <TableCell>{row.registrationDate || '-'}</TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant={row.status === 'submitted' ? 'outline' : 'default'}
                            disabled={savingRowId === row.id}
                            className={row.status === 'submitted' ? 'border-emerald-200 text-emerald-700' : ''}
                            onClick={() =>
                              handleToggleRowStatus(
                                row.id,
                                upload.id,
                                row.status === 'submitted' ? 'pending' : 'submitted',
                              )
                            }
                          >
                            {row.status === 'submitted' ? (
                              <>
                                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                                Submitted
                              </>
                            ) : (
                              'Mark submitted'
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
