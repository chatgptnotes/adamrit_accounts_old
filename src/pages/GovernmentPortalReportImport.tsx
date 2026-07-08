import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import {
  Activity,
  AlertCircle,
  ClipboardCopy,
  FileText,
  Loader2,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  Upload,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  GOVERNMENT_PORTAL_REQUIRED_COLUMNS,
  type GovernmentPortalPatientStatus,
  parseGovernmentPortalReport,
} from '@/lib/governmentPortalReport';
import type {
  GovernmentPortalRow,
  GovernmentPortalSection,
} from '@/lib/governmentPortalReport';
import {
  fetchGovernmentPortalImportHistory,
  fetchGovernmentPortalReportById,
  fetchLatestGovernmentPortalReport,
  saveGovernmentPortalReport,
  updateGovernmentPortalRowStatus,
} from '@/lib/governmentPortalReportDb';

const sectionStyles: Record<GovernmentPortalSection, string> = {
  dialysis: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  generalMedical: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  surgical: 'bg-violet-50 text-violet-700 border-violet-200',
  unclassified: 'bg-rose-50 text-rose-700 border-rose-200',
};

const STATUS_OPTIONS: Array<{ value: GovernmentPortalPatientStatus; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'extension_requested', label: 'Extension requested' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'closed', label: 'Closed' },
];

const statusStyles: Record<GovernmentPortalPatientStatus, string> = {
  pending: 'border-amber-200 bg-amber-50 text-amber-800',
  extension_requested: 'border-sky-200 bg-sky-50 text-sky-800',
  approved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  rejected: 'border-rose-200 bg-rose-50 text-rose-700',
  closed: 'border-slate-200 bg-slate-50 text-slate-600',
};

const statusLabel = (status: GovernmentPortalPatientStatus) =>
  STATUS_OPTIONS.find((option) => option.value === status)?.label || 'Pending';

const formatAmount = (value: string) => {
  if (!value.trim()) return '-';
  const numeric = Number(value.replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(numeric)) return value;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(numeric);
};

const compactProcedure = (row: GovernmentPortalRow) => {
  const code = row.values['Procedure Code'];
  const details = row.values['Procedure Details'];
  if (code && details) return `${code} - ${details}`;
  return code || details || '-';
};

const formatExtensionPatientList = (rows: GovernmentPortalRow[]) =>
  rows
    .map((row, index) => {
      const name = row.values['Beneficiary Name'] || 'Name not available';
      const registrationId = row.values['Registration ID'] || 'No Registration ID';
      const days =
        row.daysSincePreauth === null ? 'days not available' : `${row.daysSincePreauth} days`;
      return `${index + 1}. ${name} - ${registrationId} - ${compactProcedure(row)} - ${days}`;
    })
    .join('\n');

const CopyBox = ({
  title,
  text,
  onCopy,
  action,
}: {
  title: string;
  text: string;
  onCopy: (title: string, text: string) => void;
  action?: ReactNode;
}) => (
  <div className="rounded-lg border bg-white p-4 shadow-sm">
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
      <div className="flex flex-wrap justify-end gap-2">
        {action}
        <Button size="sm" variant="outline" onClick={() => onCopy(title, text)}>
          <ClipboardCopy className="mr-2 h-4 w-4" />
          Copy
        </Button>
      </div>
    </div>
    <Textarea
      value={text}
      readOnly
      className="min-h-[170px] resize-y whitespace-pre-wrap font-mono text-xs leading-5"
      onFocus={(event) => event.currentTarget.select()}
    />
  </div>
);

const ResultTable = ({
  rows,
  onStatusChange,
  savingRowId,
}: {
  rows: GovernmentPortalRow[];
  onStatusChange: (row: GovernmentPortalRow, status: GovernmentPortalPatientStatus) => void;
  savingRowId: string | null;
}) => {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-gray-50 p-6 text-center text-sm text-gray-500">
        No rows in this section.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[72px]">Row</TableHead>
            <TableHead>Beneficiary</TableHead>
            <TableHead>Registration ID</TableHead>
            <TableHead>Case Type</TableHead>
            <TableHead>Preauth</TableHead>
            <TableHead className="text-right">Days</TableHead>
            <TableHead>Procedure</TableHead>
            <TableHead className="text-right">Approved</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Issue</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.id || row.rowNumber}-${row.values['Registration ID']}`}>
              <TableCell className="font-medium text-gray-600">{row.rowNumber}</TableCell>
              <TableCell className="min-w-[180px] font-medium">
                {row.values['Beneficiary Name'] || '-'}
                {row.extensionNeeded && (
                  <Badge className="ml-2 bg-amber-100 text-amber-800 hover:bg-amber-100">
                    Extension Needed
                  </Badge>
                )}
              </TableCell>
              <TableCell className="min-w-[140px]">{row.values['Registration ID'] || '-'}</TableCell>
              <TableCell>
                <Badge variant="outline" className={sectionStyles[row.section]}>
                  {row.values['Case Type'] || row.sectionLabel}
                </Badge>
              </TableCell>
              <TableCell className="min-w-[120px]">
                {row.preauthDateLabel || row.values['Preauth Initiated Date'] || '-'}
              </TableCell>
              <TableCell className="text-right">
                {row.daysSincePreauth === null ? '-' : row.daysSincePreauth}
              </TableCell>
              <TableCell className="min-w-[260px]">{compactProcedure(row)}</TableCell>
              <TableCell className="text-right">
                {formatAmount(row.values['Preauth Approved Amount'])}
              </TableCell>
              <TableCell className="min-w-[180px]">
                <Select
                  value={row.status}
                  onValueChange={(value) =>
                    onStatusChange(row, value as GovernmentPortalPatientStatus)
                  }
                  disabled={!row.id || savingRowId === row.id}
                >
                  <SelectTrigger className={`h-9 max-w-[170px] ${statusStyles[row.status]}`}>
                    <SelectValue placeholder={statusLabel(row.status)} />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell className="min-w-[220px] text-xs text-gray-500">
                {row.issues.length ? row.issues.join('; ') : '-'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

export default function GovernmentPortalReportImport() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState('');
  const [report, setReport] = useState<ReturnType<typeof parseGovernmentPortalReport> | null>(null);
  const [reportDateLabel, setReportDateLabel] = useState('');
  const [savedImportId, setSavedImportId] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [importHistory, setImportHistory] = useState<
    Array<{ id: string; fileName: string; createdAt: string; totalRows: number }>
  >([]);
  const [isLoadingSaved, setIsLoadingSaved] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [isSendingWhatsApp, setIsSendingWhatsApp] = useState(false);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);

  const applySavedReport = (
    saved: {
      id: string;
      fileName: string;
      reportDateLabel: string | null;
      createdAt: string;
      report: ReturnType<typeof parseGovernmentPortalReport>;
    },
  ) => {
    setSavedImportId(saved.id);
    setSavedAt(saved.createdAt);
    setFileName(saved.fileName);
    setReportDateLabel(saved.reportDateLabel || new Date(saved.createdAt).toLocaleDateString('en-IN'));
    setReport(saved.report);
  };

  const refreshImportHistory = async () => {
    const history = await fetchGovernmentPortalImportHistory();
    setImportHistory(history);
  };

  const handleStatusChange = async (row: GovernmentPortalRow, status: GovernmentPortalPatientStatus) => {
    if (!row.id) {
      toast.error('Save the report before editing patient status');
      return;
    }

    setSavingRowId(row.id);
    try {
      await updateGovernmentPortalRowStatus(row.id, status);
      setReport((current) =>
        current
          ? {
              ...current,
              rows: current.rows.map((item) =>
                item.id === row.id ? { ...item, status } : item,
              ),
            }
          : current,
      );
      toast.success(`Status updated to ${statusLabel(status)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not update status';
      toast.error(message);
    } finally {
      setSavingRowId(null);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const loadSaved = async () => {
      setIsLoadingSaved(true);
      try {
        const [latest, history] = await Promise.all([
          fetchLatestGovernmentPortalReport(),
          fetchGovernmentPortalImportHistory(),
        ]);
        if (cancelled) return;
        setImportHistory(history);
        if (latest) applySavedReport(latest);
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load saved government portal report:', error);
        }
      } finally {
        if (!cancelled) setIsLoadingSaved(false);
      }
    };

    void loadSaved();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelectImport = async (importId: string) => {
    if (!importId) return;
    setIsLoadingSaved(true);
    try {
      const saved = await fetchGovernmentPortalReportById(importId);
      if (saved) applySavedReport(saved);
    } catch {
      toast.error('Could not load the selected import');
    } finally {
      setIsLoadingSaved(false);
    }
  };

  const extensionNeededRows = useMemo(
    () => (report?.rows || []).filter((row) => row.extensionNeeded && row.status === 'pending'),
    [report],
  );

  const sections = useMemo(() => {
    const rows = report?.rows || [];
    return [
      {
        title: 'Dialysis',
        count: report?.counts.dialysis || 0,
        rows: rows.filter((row) => row.section === 'dialysis'),
      },
      {
        title: 'General Medical - Non Dialysis',
        count: report?.counts.generalMedical || 0,
        rows: rows.filter((row) => row.section === 'generalMedical'),
      },
      {
        title: 'Surgical',
        count: report?.counts.surgical || 0,
        rows: rows.filter((row) => row.section === 'surgical'),
      },
      {
        title: 'Extension Needed',
        count: rows.filter((row) => row.extensionNeeded && row.status === 'pending').length,
        rows: rows.filter((row) => row.extensionNeeded && row.status === 'pending'),
      },
      {
        title: 'Unclassified / Error Rows',
        count: report?.counts.unclassified || 0,
        rows: rows.filter((row) => row.section === 'unclassified'),
      },
    ];
  }, [report]);

  const urgentExtensionsText = useMemo(() => {
    if (!report) return '';
    return [
      'Urgent Extensions Needed',
      '',
      ...(extensionNeededRows.length
        ? formatExtensionPatientList(extensionNeededRows).split('\n')
        : ['No urgent extensions needed.']),
    ].join('\n');
  }, [extensionNeededRows, report]);

  const handleReset = () => {
    setFileName('');
    setReport(null);
    setReportDateLabel('');
    setSavedImportId(null);
    setSavedAt(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCopy = async (title: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${title} copied`);
    } catch {
      toast.error('Could not copy text');
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!/\.(csv|txt)$/i.test(file.name)) {
      toast.error('Upload a .csv or .txt file');
      handleReset();
      return;
    }

    setIsReading(true);
    setFileName(file.name);
    const dateLabel = new Date().toLocaleDateString('en-IN');
    setReportDateLabel(dateLabel);

    try {
      const text = await file.text();
      const parsed = parseGovernmentPortalReport(text);
      setReport(parsed);

      if (parsed.fatalErrors.length > 0) {
        toast.error('Report validation failed');
      } else {
        setIsSaving(true);
        try {
          const importId = await saveGovernmentPortalReport(file.name, parsed, dateLabel);
          const saved = await fetchGovernmentPortalReportById(importId);
          if (saved) {
            applySavedReport(saved);
          } else {
            setSavedImportId(importId);
            setSavedAt(new Date().toISOString());
            setReport(parsed);
          }
          await refreshImportHistory();
          toast.success(`Parsed and saved ${parsed.totalRows} rows`);
        } catch (saveError) {
          console.error('Government portal report save failed:', saveError);
          toast.error('Parsed report could not be saved to the database');
        } finally {
          setIsSaving(false);
        }
      }
    } catch {
      setReport(null);
      toast.error('Could not read the uploaded file');
    } finally {
      setIsReading(false);
    }
  };

  const handleSendExtensionWhatsApp = async () => {
    if (!report || report.fatalErrors.length > 0) {
      toast.error('Upload a valid Hope Hospital report first');
      return;
    }

    if (extensionNeededRows.length === 0) {
      toast.error('No extension-needed patients to send');
      return;
    }

    setIsSendingWhatsApp(true);
    try {
      const response = await fetch('/api/send-extension-needed-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportDate: reportDateLabel || new Date().toLocaleDateString('en-IN'),
          patientList: formatExtensionPatientList(extensionNeededRows),
          extensionCount: extensionNeededRows.length,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const detail =
          typeof payload?.detail === 'string'
            ? payload.detail
            : payload?.error || 'DoubleTick send failed';
        throw new Error(detail);
      }

      toast.success(`WhatsApp sent for ${extensionNeededRows.length} extension-needed patients`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not send WhatsApp';
      toast.error(message);
    } finally {
      setIsSendingWhatsApp(false);
    }
  };

  const summaryCards = report
    ? [
        {
          label: 'Total Rows',
          value: report.totalRows,
          icon: FileText,
          className: 'border-gray-200 bg-white text-gray-700',
        },
        {
          label: 'Dialysis',
          value: report.counts.dialysis,
          icon: Activity,
          className: 'border-cyan-200 bg-cyan-50 text-cyan-700',
        },
        {
          label: 'General Medical',
          value: report.counts.generalMedical,
          icon: UserRound,
          className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        },
        {
          label: 'Surgical',
          value: report.counts.surgical,
          icon: ShieldCheck,
          className: 'border-violet-200 bg-violet-50 text-violet-700',
        },
        {
          label: 'Extension Needed',
          value: extensionNeededRows.length,
          icon: AlertCircle,
          className: 'border-amber-200 bg-amber-50 text-amber-700',
        },
        {
          label: 'Unclassified',
          value: report.counts.unclassified,
          icon: AlertCircle,
          className: 'border-rose-200 bg-rose-50 text-rose-700',
        },
      ]
    : [];

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold text-gray-900">
            <span className="rounded-lg bg-emerald-50 p-2 text-emerald-700">
              <Upload className="h-6 w-6" />
            </span>
            Import Government Portal Report (MJPJY/PMJAY)
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Single .csv or .txt document, caret-delimited with ^. Uploads are saved to the database.
          </p>
          {savedAt && report && (
            <p className="mt-1 text-xs text-emerald-700">
              Saved import{savedImportId ? ` · ${savedImportId.slice(0, 8)}` : ''} ·{' '}
              {new Date(savedAt).toLocaleString('en-IN')}
            </p>
          )}
        </div>
        {report && (
          <Button variant="outline" onClick={handleReset}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Clear
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload Report</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {importHistory.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="saved-import-select">Load saved import</Label>
              <select
                id="saved-import-select"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={savedImportId || ''}
                onChange={(e) => void handleSelectImport(e.target.value)}
                disabled={isLoadingSaved || isReading || isSaving}
              >
                <option value="" disabled>
                  Select a previous import
                </option>
                {importHistory.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.fileName} · {new Date(item.createdAt).toLocaleString('en-IN')} ·{' '}
                    {item.totalRows} rows
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <div className="space-y-2">
              <Label htmlFor="government-portal-report">Import Government Portal Report (MJPJY/PMJAY)</Label>
              <Input
                ref={fileInputRef}
                id="government-portal-report"
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                onChange={handleFileChange}
                disabled={isReading || isSaving}
              />
            </div>
            <div className="rounded-lg border bg-gray-50 px-4 py-3 text-sm text-gray-600">
              {isLoadingSaved
                ? 'Loading saved report…'
                : isSaving
                  ? 'Saving to database…'
                  : fileName || 'No file selected'}
            </div>
          </div>

          <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
            Required columns: {GOVERNMENT_PORTAL_REQUIRED_COLUMNS.join(', ')}
          </div>
        </CardContent>
      </Card>

      {report?.fatalErrors.length ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Validation failed</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {report.fatalErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {report && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {summaryCards.map((card) => (
              <div key={card.label} className={`rounded-lg border p-4 ${card.className}`}>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide">{card.label}</span>
                  <card.icon className="h-4 w-4" />
                </div>
                <div className="text-2xl font-bold">{card.value}</div>
              </div>
            ))}
          </div>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-900">WhatsApp Copy Boxes</h2>
            <div className="grid gap-4 lg:grid-cols-3">
              <CopyBox
                title="Medical Patients"
                text={report.whatsApp.medicalPatients}
                onCopy={handleCopy}
              />
              <CopyBox
                title="Urgent Extensions Needed"
                text={urgentExtensionsText}
                onCopy={handleCopy}
                action={
                  <Button
                    size="sm"
                    onClick={handleSendExtensionWhatsApp}
                    disabled={
                      isSendingWhatsApp ||
                      report.fatalErrors.length > 0 ||
                      extensionNeededRows.length === 0
                    }
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    {isSendingWhatsApp ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <MessageCircle className="mr-2 h-4 w-4" />
                    )}
                    Send WhatsApp
                  </Button>
                }
              />
              <CopyBox
                title="Dialysis Batch Status"
                text={report.whatsApp.dialysisBatchStatus}
                onCopy={handleCopy}
              />
            </div>
          </section>

          <div className="space-y-5">
            {sections.map((section) => (
              <section key={section.title} className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold text-gray-900">{section.title}</h2>
              <Badge variant="outline">{section.count} rows</Badge>
                </div>
                <ResultTable
                  rows={section.rows}
                  onStatusChange={handleStatusChange}
                  savingRowId={savingRowId}
                />
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
