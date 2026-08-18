import { useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ArrowLeft, Droplets, FileSpreadsheet, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/contexts/AuthContext';
import { dedupePortalText, formatPortalAmount } from '@/lib/governmentPortalDisplay';
import {
  GOVERNMENT_PORTAL_REQUIRED_COLUMNS,
  parseGovernmentPortalReport,
  type GovernmentPortalRow,
} from '@/lib/governmentPortalReport';
import {
  fetchGovernmentPortalImportHistory,
  fetchGovernmentPortalReportById,
  fetchLatestGovernmentPortalReport,
  saveGovernmentPortalReport,
  type SavedGovernmentPortalImport,
} from '@/lib/governmentPortalReportDb';

/**
 * Dialysis Bill Pending — how many dialysis patients have finished their cycle
 * but have no bill prepared yet.
 *
 * The government portal publishes that list as a CSV every day. This screen
 * imports it, shows the count and the patients, and keeps every earlier day.
 *
 * THE COUNT IS EVERY ROW IN THE FILE, not only the rows the parser's section
 * classifier calls dialysis. This export IS the pending-dialysis list; running
 * it through the dialysis word list would silently drop a patient whose
 * procedure happened to be worded differently, and a hidden patient is the
 * dangerous direction. Rows the classifier did not recognise are counted,
 * listed, and noted — never removed.
 */

const REPORT_KIND = 'dialysis_bill_pending' as const;

const todayIso = () => format(new Date(), 'yyyy-MM-dd');

/** "18 Aug 2026", or the raw value if it is not a date we can read. */
const prettyDate = (iso: string | null | undefined): string => {
  if (!iso) return '';
  try {
    return format(parseISO(iso), 'dd MMM yyyy');
  } catch {
    return iso;
  }
};

const procedureOf = (row: GovernmentPortalRow) => {
  const code = dedupePortalText(row.values['Procedure Code']);
  const details = dedupePortalText(row.values['Procedure Details']);
  if (code && details) return `${code} - ${details}`;
  return code || details || '-';
};

export default function DialysisBillPending() {
  const { hospitalType } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [snapshotDate, setSnapshotDate] = useState(todayIso);
  const [isImporting, setIsImporting] = useState(false);
  const [fatalErrors, setFatalErrors] = useState<string[]>([]);
  /** null = show the latest snapshot; otherwise the history entry being read. */
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);

  const history = useQuery({
    queryKey: ['dialysis-bill-pending-history', hospitalType],
    queryFn: () => fetchGovernmentPortalImportHistory(REPORT_KIND, 60, hospitalType),
  });

  const snapshot = useQuery<SavedGovernmentPortalImport | null>({
    queryKey: ['dialysis-bill-pending-snapshot', hospitalType, selectedImportId],
    queryFn: () =>
      selectedImportId
        ? fetchGovernmentPortalReportById(selectedImportId)
        : fetchLatestGovernmentPortalReport(REPORT_KIND, hospitalType),
  });

  const rows = snapshot.data?.report.rows ?? [];
  const pendingCount = snapshot.data?.report.totalRows ?? 0;
  const unrecognised = rows.filter((row) => row.section !== 'dialysis').length;

  const reload = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['dialysis-bill-pending-history'] }),
      queryClient.invalidateQueries({ queryKey: ['dialysis-bill-pending-snapshot'] }),
    ]);
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!/\.(csv|txt)$/i.test(file.name)) {
      toast.error('Upload a .csv or .txt file');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (!snapshotDate) {
      toast.error('Pick the date this file is for');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    // Replacing a day is deliberate, so it is asked about rather than assumed.
    const existing = (history.data || []).find((entry) => entry.reportDate === snapshotDate);
    if (existing) {
      const ok = window.confirm(
        `${prettyDate(snapshotDate)} was already imported (${existing.fileName}, ${existing.totalRows} rows).\n\n` +
          'Importing this file replaces that day. Other days are not affected.',
      );
      if (!ok) {
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
    }

    setIsImporting(true);
    setFatalErrors([]);
    try {
      const parsed = parseGovernmentPortalReport(await file.text());

      // Nothing is saved when the file does not parse. A half-saved import
      // would show a count that is quietly short of the real one.
      if (parsed.fatalErrors.length > 0) {
        setFatalErrors(parsed.fatalErrors);
        toast.error('The file could not be read — nothing was saved');
        return;
      }

      const saved = await saveGovernmentPortalReport(
        file.name,
        parsed,
        prettyDate(snapshotDate),
        REPORT_KIND,
        { hospitalType, reportDate: snapshotDate },
      );

      setSelectedImportId(saved.importId);
      await reload();
      toast.success(
        `${prettyDate(snapshotDate)}: ${parsed.totalRows} dialysis bill(s) pending saved.` +
          (saved.skippedDuplicates > 0
            ? ` ${saved.skippedDuplicates} repeated registration ID(s) skipped.`
            : ''),
      );
    } catch (error) {
      console.error('Dialysis Bill Pending import failed:', error);
      toast.error(error instanceof Error ? error.message : 'Import failed — nothing was saved');
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
        <header className="space-y-2">
          <Link
            to="/government-portal-report-import"
            className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Government Portal Uploads
          </Link>
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-cyan-50 text-cyan-700 ring-1 ring-inset ring-cyan-200">
              <Droplets className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900 md:text-3xl">
                Dialysis Bill Pending
              </h1>
              <p className="text-sm text-gray-500">
                Dialysis patients whose cycle is finished but whose bill has not been prepared yet.
                Import the portal's CSV each day; every earlier day stays readable.
              </p>
            </div>
          </div>
        </header>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <Label htmlFor="dialysis-pending-date" className="mb-1 block text-xs font-medium text-gray-500">
                  This file is for
                </Label>
                <Input
                  id="dialysis-pending-date"
                  type="date"
                  className="h-9 w-44"
                  value={snapshotDate}
                  max={todayIso()}
                  onChange={(event) => setSnapshotDate(event.target.value)}
                />
              </div>
              <div className="min-w-[260px] flex-1">
                <Label htmlFor="dialysis-pending-file" className="mb-1 block text-xs font-medium text-gray-500">
                  Government Portal CSV
                </Label>
                <Input
                  id="dialysis-pending-file"
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt,text/csv,text/plain"
                  disabled={isImporting}
                  onChange={handleFileChange}
                  className="h-9"
                />
              </div>
              {history.data && history.data.length > 0 && (
                <div>
                  <Label htmlFor="dialysis-pending-history" className="mb-1 block text-xs font-medium text-gray-500">
                    Previous imports
                  </Label>
                  <select
                    id="dialysis-pending-history"
                    className="h-9 min-w-[220px] rounded-md border border-input bg-background px-3 text-sm"
                    value={selectedImportId ?? ''}
                    onChange={(event) => setSelectedImportId(event.target.value || null)}
                  >
                    <option value="">Latest</option>
                    {history.data.map((entry, index) => (
                      <option key={entry.id} value={entry.id}>
                        {prettyDate(entry.reportDate) || format(new Date(entry.createdAt), 'dd MMM yyyy')}
                        {index === 0 ? ' — Latest' : ''} ({entry.totalRows})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={reload}
                disabled={isImporting || snapshot.isFetching}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${snapshot.isFetching ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
            <p className="mt-3 text-xs text-gray-500">
              Caret-delimited .csv or .txt, with the columns:{' '}
              {GOVERNMENT_PORTAL_REQUIRED_COLUMNS.join(' ^ ')}
            </p>
          </CardHeader>
        </Card>

        {fatalErrors.length > 0 && (
          <Alert variant="destructive">
            <AlertTitle>The file could not be read — nothing was saved</AlertTitle>
            <AlertDescription>
              <ul className="ml-4 list-disc space-y-1 text-sm">
                {fatalErrors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {snapshot.isError && (
          <Alert variant="destructive">
            <AlertTitle>Could not load the saved imports</AlertTitle>
            <AlertDescription>
              {snapshot.error instanceof Error ? snapshot.error.message : 'Unknown error'}
            </AlertDescription>
          </Alert>
        )}

        <Card className="border-cyan-200">
          <CardContent className="p-6">
            {snapshot.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : !snapshot.data ? (
              <div className="text-sm text-gray-500">
                Nothing imported yet. Pick a date and upload the portal's CSV above.
              </div>
            ) : (
              <>
                <div className="text-5xl font-bold tracking-tight text-cyan-700">{pendingCount}</div>
                <div className="mt-1 text-sm font-medium text-gray-800">
                  dialysis {pendingCount === 1 ? 'bill' : 'bills'} not yet prepared
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                  <span>{prettyDate(snapshot.data.reportDate) || prettyDate(snapshot.data.createdAt)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                    {snapshot.data.fileName}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>imported {format(new Date(snapshot.data.createdAt), 'dd MMM yyyy, h:mm a')}</span>
                </div>
                {unrecognised > 0 && (
                  <p className="mt-3 text-xs text-gray-500">
                    {unrecognised} of these {unrecognised === 1 ? 'row does' : 'rows do'} not name dialysis in the
                    procedure text. {unrecognised === 1 ? 'It is' : 'They are'} counted and listed below — the file
                    is the portal's own pending-dialysis list, so nothing in it is hidden.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="w-[64px]">Row</TableHead>
                    <TableHead>Beneficiary</TableHead>
                    <TableHead>Registration ID</TableHead>
                    <TableHead>Program</TableHead>
                    <TableHead>Case Type</TableHead>
                    <TableHead>Preauth Initiated</TableHead>
                    <TableHead>Procedure</TableHead>
                    <TableHead className="text-right">Approved</TableHead>
                    <TableHead>Issue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshot.isLoading ? (
                    <TableRow>
                      <TableCell colSpan={9} className="py-10 text-center text-gray-500">
                        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                      </TableCell>
                    </TableRow>
                  ) : rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="py-10 text-center text-sm text-gray-500">
                        No patients in this snapshot.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((row) => (
                      <TableRow key={row.id || `${row.rowNumber}-${row.values['Registration ID']}`}>
                        <TableCell className="font-medium text-gray-600">{row.rowNumber}</TableCell>
                        <TableCell className="min-w-[180px] font-medium">
                          {row.values['Beneficiary Name'] || '-'}
                        </TableCell>
                        <TableCell className="min-w-[140px]">
                          {row.values['Registration ID'] || '-'}
                        </TableCell>
                        <TableCell className="min-w-[120px]">{row.values['Program ID'] || '-'}</TableCell>
                        <TableCell className="min-w-[120px]">{row.values['Case Type'] || '-'}</TableCell>
                        <TableCell className="min-w-[120px] whitespace-nowrap">
                          {row.preauthDateLabel || row.values['Preauth Initiated Date'] || '-'}
                        </TableCell>
                        <TableCell className="min-w-[260px]">{procedureOf(row)}</TableCell>
                        <TableCell className="text-right">
                          {formatPortalAmount(row.values['Preauth Approved Amount'])}
                        </TableCell>
                        <TableCell className="min-w-[200px] text-xs text-gray-500">
                          {row.issues.length ? row.issues.join('; ') : '-'}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
