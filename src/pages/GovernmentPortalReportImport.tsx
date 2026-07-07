import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  Activity,
  AlertCircle,
  ClipboardCopy,
  FileText,
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
  GOVERNMENT_PORTAL_REQUIRED_COLUMNS,
  parseGovernmentPortalReport,
} from '@/lib/governmentPortalReport';
import type {
  GovernmentPortalRow,
  GovernmentPortalSection,
} from '@/lib/governmentPortalReport';

const sectionStyles: Record<GovernmentPortalSection, string> = {
  dialysis: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  generalMedical: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  surgical: 'bg-violet-50 text-violet-700 border-violet-200',
  unclassified: 'bg-rose-50 text-rose-700 border-rose-200',
};

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

const CopyBox = ({
  title,
  text,
  onCopy,
}: {
  title: string;
  text: string;
  onCopy: (title: string, text: string) => void;
}) => (
  <div className="rounded-lg border bg-white p-4 shadow-sm">
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
      <Button size="sm" variant="outline" onClick={() => onCopy(title, text)}>
        <ClipboardCopy className="mr-2 h-4 w-4" />
        Copy
      </Button>
    </div>
    <Textarea
      value={text}
      readOnly
      className="min-h-[170px] resize-y whitespace-pre-wrap font-mono text-xs leading-5"
      onFocus={(event) => event.currentTarget.select()}
    />
  </div>
);

const ResultTable = ({ rows }: { rows: GovernmentPortalRow[] }) => {
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
            <TableHead>Issue</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.rowNumber}-${row.values['Registration ID']}`}>
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
  const [isReading, setIsReading] = useState(false);

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
        count: report?.counts.extensionNeeded || 0,
        rows: rows.filter((row) => row.extensionNeeded),
      },
      {
        title: 'Unclassified / Error Rows',
        count: report?.counts.unclassified || 0,
        rows: rows.filter((row) => row.section === 'unclassified'),
      },
    ];
  }, [report]);

  const handleReset = () => {
    setFileName('');
    setReport(null);
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

    try {
      const text = await file.text();
      const parsed = parseGovernmentPortalReport(text);
      setReport(parsed);

      if (parsed.fatalErrors.length > 0) {
        toast.error('Report validation failed');
      } else {
        toast.success(`Parsed ${parsed.totalRows} rows`);
      }
    } catch {
      setReport(null);
      toast.error('Could not read the uploaded file');
    } finally {
      setIsReading(false);
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
          value: report.counts.extensionNeeded,
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
            Single .csv or .txt document, caret-delimited with ^.
          </p>
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
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <div className="space-y-2">
              <Label htmlFor="government-portal-report">Import Government Portal Report (MJPJY/PMJAY)</Label>
              <Input
                ref={fileInputRef}
                id="government-portal-report"
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                onChange={handleFileChange}
                disabled={isReading}
              />
            </div>
            <div className="rounded-lg border bg-gray-50 px-4 py-3 text-sm text-gray-600">
              {fileName || 'No file selected'}
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
                text={report.whatsApp.urgentExtensions}
                onCopy={handleCopy}
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
                <ResultTable rows={section.rows} />
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
