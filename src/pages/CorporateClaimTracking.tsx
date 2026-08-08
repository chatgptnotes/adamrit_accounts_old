import { useMemo, useState, type ChangeEvent } from 'react';
import { AlertCircle, CheckCircle2, FileSpreadsheet, ShieldCheck, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { parseCorporateClaimFile, type CorporateClaimParsedFile } from '@/lib/corporateClaimTracking';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const labelForFileType: Record<CorporateClaimParsedFile['fileType'], string> = {
  under_treatment: 'Under Treatment', claims_to_be_submitted: 'Claims To Be Submitted',
  claims_sent_to_bank: 'Claims Sent To Bank', pending_with_payer: 'Pending With Payer',
  claims_approved_from_bank: 'Claims Approved From Bank', claims_rejected: 'Claims Rejected', unknown: 'Unknown layout',
};

const STAGE_ORDER: CorporateClaimParsedFile['fileType'][] = [
  'under_treatment', 'claims_to_be_submitted', 'claims_sent_to_bank',
  'pending_with_payer', 'claims_approved_from_bank', 'claims_rejected',
];

function ImportPreview({ schemeCode }: { schemeCode: 'PMJAY' | 'MJPJAY' }) {
  const { hospitalType } = useAuth();
  const [files, setFiles] = useState<CorporateClaimParsedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [activeStage, setActiveStage] = useState<CorporateClaimParsedFile['fileType'] | 'all'>('all');
  const [search, setSearch] = useState('');
  const summary = useMemo(() => ({
    rows: files.reduce((total, file) => total + file.rows.length, 0),
    valid: files.reduce((total, file) => total + file.rows.filter((row) => row.issues.length === 0).length, 0),
    invalid: files.reduce((total, file) => total + file.rows.filter((row) => row.issues.length > 0).length, 0),
  }), [files]);
  const previewRows = useMemo(() => files.flatMap((file) => file.rows.map((row) => ({
    fileName: file.fileName,
    fileType: file.fileType,
    row,
  }))), [files]);
  const stageCounts = useMemo(() => Object.fromEntries(STAGE_ORDER.map((stage) => [
    stage,
    previewRows.filter((item) => item.fileType === stage).length,
  ])), [previewRows]);
  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return previewRows.filter(({ fileType, row }) => {
      if (activeStage !== 'all' && fileType !== activeStage) return false;
      if (!query) return true;
      return [row.originalValues['Beneficiary Name'], row.originalValues['Registration ID'], row.originalValues['Program ID'], row.originalValues.UTR, row.originalValues['Case Status']]
        .some((value) => String(value || '').toLowerCase().includes(query));
    });
  }, [activeStage, previewRows, search]);
  const formatAmount = (value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === '') return '—';
    const amount = Number(value);
    return Number.isFinite(amount) ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount) : String(value);
  };

  const onFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files || []);
    if (!selected.length) return;
    setLoading(true);
    try {
      const parsed = await Promise.all(selected.map(parseCorporateClaimFile));
      setFiles(parsed);
      if (parsed.some((file) => file.fatalErrors.length)) toast.error('Some files need correction before they can be imported.');
      else toast.success(`${parsed.length} file(s) validated locally.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The selected files could not be read.');
    } finally { setLoading(false); }
  };

  const importSnapshot = async () => {
    if (files.some((file) => file.fatalErrors.length) || !files.length) return;
    setImporting(true);
    try {
      const { data, error } = await supabase.functions.invoke('corporate-claim-import', {
        body: { hospitalName: hospitalType || 'hope', schemeCode, sourceKind: 'system_initial_import', files },
      });
      if (error) throw error;
      toast.success(`Import completed: ${data.validRows} valid row(s), ${data.invalidRows} needing review.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The controlled import could not be completed.');
    } finally { setImporting(false); }
  };

  return <div className="space-y-5">
    <Card className="border-indigo-200 bg-indigo-50/40">
      <CardHeader>
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-indigo-700" />
          <div>
            <CardTitle className="text-base">Phase 1 protected import</CardTitle>
            <CardDescription className="mt-1 text-indigo-950/70">
              Files are validated against the new claim-tracking format. This module never updates existing patients, visits, bills, payments, or portal imports.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input type="file" accept=".csv,.xls,.xlsx" multiple onChange={onFiles} disabled={loading} />
        <p className="text-xs text-muted-foreground">Select one file or the complete six-file portal snapshot. Recognized files are caret-delimited CSV, XLS, or XLSX.</p>
      </CardContent>
    </Card>

    {files.length > 0 && <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Portal rows</p><p className="text-2xl font-bold">{summary.rows}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Valid rows</p><p className="text-2xl font-bold text-emerald-700">{summary.valid}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Rows needing review</p><p className="text-2xl font-bold text-amber-700">{summary.invalid}</p></CardContent></Card>
      </div>
      <div className="space-y-3">
        {files.map((file) => <Card key={file.fileName}>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex min-w-0 items-center gap-3"><FileSpreadsheet className="h-5 w-5 shrink-0 text-indigo-600" /><div className="min-w-0"><p className="truncate font-medium">{file.fileName}</p><p className="text-xs text-muted-foreground">{file.reportDate || 'Report date not detected'} · {file.rows.length} portal rows</p></div></div>
            <div className="flex flex-wrap gap-2"><Badge variant="outline">{labelForFileType[file.fileType]}</Badge>{file.fatalErrors.length ? <Badge variant="destructive"><AlertCircle className="mr-1 h-3 w-3" />Needs correction</Badge> : <Badge className="bg-emerald-600"><CheckCircle2 className="mr-1 h-3 w-3" />Validated</Badge>}</div>
            {file.fatalErrors.length > 0 && <p className="w-full text-xs text-destructive">{file.fatalErrors.join(' ')}</p>}
          </CardContent>
        </Card>)}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Portal patient and claim data</CardTitle>
          <CardDescription>Choose a portal stage below. A patient can appear more than once when the portal lists the claim in multiple files.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Button variant={activeStage === 'all' ? 'default' : 'outline'} className="h-auto justify-between py-3" onClick={() => setActiveStage('all')}><span>All Records</span><span>{previewRows.length}</span></Button>
            {STAGE_ORDER.map((stage) => <Button key={stage} variant={activeStage === stage ? 'default' : 'outline'} className="h-auto justify-between py-3 text-left" onClick={() => setActiveStage(stage)}><span>{labelForFileType[stage]}</span><span>{stageCounts[stage]}</span></Button>)}
          </div>
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search patient name, Registration ID, Program ID, UTR, or status" />
          <p className="text-sm text-muted-foreground">Showing {visibleRows.length} row(s){activeStage === 'all' ? ' from all portal files' : ` from ${labelForFileType[activeStage]}`}.</p>
          <div className="max-h-[560px] overflow-auto rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 bg-background"><TableRow><TableHead>Patient</TableHead><TableHead>Registration ID</TableHead><TableHead>Program ID</TableHead><TableHead>Portal stage</TableHead><TableHead className="text-right">Claim</TableHead><TableHead className="text-right">Approved</TableHead><TableHead className="text-right">Paid</TableHead><TableHead>UTR</TableHead><TableHead>Result</TableHead></TableRow></TableHeader>
              <TableBody>{visibleRows.map(({ fileName, fileType, row }) => <TableRow key={`${fileName}-${row.rowNumber}`}>
                <TableCell className="min-w-[190px] font-medium">{row.originalValues['Beneficiary Name'] || '—'}<p className="mt-0.5 text-xs text-muted-foreground">{fileName}</p></TableCell>
                <TableCell>{row.originalValues['Registration ID'] || '—'}</TableCell>
                <TableCell>{row.originalValues['Program ID'] || '—'}</TableCell>
                <TableCell><Badge variant="outline">{labelForFileType[fileType]}{row.originalValues['Case Status'] ? ` · ${row.originalValues['Case Status']}` : ''}</Badge></TableCell>
                <TableCell className="text-right">{formatAmount(row.normalizedValues.claim_amount)}</TableCell>
                <TableCell className="text-right">{formatAmount(row.normalizedValues.approved_amount)}</TableCell>
                <TableCell className="text-right">{formatAmount(row.normalizedValues.paid_amount)}</TableCell>
                <TableCell>{row.originalValues.UTR || '—'}</TableCell>
                <TableCell>{row.issues.length ? <Badge variant="destructive">Review</Badge> : <Badge className="bg-emerald-600">Valid</Badge>}</TableCell>
              </TableRow>)}{visibleRows.length === 0 && <TableRow><TableCell colSpan={9} className="py-10 text-center text-muted-foreground">No portal rows match this stage and search.</TableCell></TableRow>}</TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <Card className="border-dashed"><CardContent className="flex items-center justify-between gap-4 p-4"><p className="text-sm text-muted-foreground">Validated {schemeCode} rows are sent only to the controlled tracking-import service. It can write only the new tracking tables.</p><Button onClick={importSnapshot} disabled={importing || files.some((file) => file.fatalErrors.length)}><Upload className="mr-2 h-4 w-4" />{importing ? 'Importing…' : 'Import validated snapshot'}</Button></CardContent></Card>
    </>}
  </div>;
}

export default function CorporateClaimTracking() {
  return <div className="min-h-screen bg-slate-50"><div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
    <header><p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">Government claims</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Corporate Claim Tracking</h1><p className="mt-2 max-w-3xl text-sm text-slate-600">Separate, auditable PMJAY and MJPJAY claim tracking. Phase 1 validates portal data without touching existing HMIS records.</p></header>
    <Tabs defaultValue="PMJAY"><TabsList><TabsTrigger value="PMJAY">PMJAY</TabsTrigger><TabsTrigger value="MJPJAY">MJPJAY</TabsTrigger></TabsList><TabsContent value="PMJAY" className="mt-5"><ImportPreview schemeCode="PMJAY" /></TabsContent><TabsContent value="MJPJAY" className="mt-5"><ImportPreview schemeCode="MJPJAY" /></TabsContent></Tabs>
  </div></div>;
}
