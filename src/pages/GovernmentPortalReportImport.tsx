import { FileSpreadsheet, Camera, type LucideIcon } from 'lucide-react';
import { GovernmentPortalCsvSection } from '@/components/government-portal/GovernmentPortalCsvSection';
import { PreauthScreenshotSection } from '@/components/government-portal/PreauthScreenshotSection';
import { ImportLaneCards } from '@/components/government-portal/ImportLaneCards';
import { IMPORT_ACCENTS } from '@/components/government-portal/importAccents';

/**
 * Four upload lanes for the NHA provider portal: two caret-delimited CSV
 * exports and two dashboard screenshots.
 *
 * They used to run CSV, screenshot, screenshot, CSV down one column, drawn
 * alike, so the page read as four interchangeable blocks and the last one sat
 * far below anything you could see. They are grouped by what they take now,
 * each with a colour of its own, under a set of cards that shows all four at
 * once.
 */

const CSV_LANES = [
  {
    accent: IMPORT_ACCENTS.underTreatment,
    title: 'Import Government Portal Report (MJPJY/PMJAY)',
    hint: 'The Under Treatment export. Drives the extension alerts.',
  },
  {
    accent: IMPORT_ACCENTS.claims,
    title: 'Claims to be Submitted',
    hint: 'The claims list, uploaded daily to track submission status.',
  },
];

const SCREENSHOT_LANES = [
  {
    accent: IMPORT_ACCENTS.preauthToSubmit,
    title: 'Preauthorization to be Submitted',
    hint: 'Screenshot of the portal card list. AI reads the patients out of it.',
  },
  {
    accent: IMPORT_ACCENTS.preauthPending,
    title: 'Preauthorization Pending',
    hint: 'Screenshot of the pending card list, to track approval progress.',
  },
];

/** The heading over each group, so the two kinds read as two kinds. */
function GroupHeading({ icon: Icon, label, detail }: { icon: LucideIcon; label: string; detail: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gray-100 text-gray-600">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-800">{label}</h2>
        <p className="truncate text-xs text-gray-500">{detail}</p>
      </div>
      <div className="ml-2 h-px flex-1 bg-gradient-to-r from-gray-200 to-transparent" />
    </div>
  );
}

export default function GovernmentPortalReportImport() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto max-w-7xl space-y-8 p-4 md:p-6">
        <header className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">NHA provider portal</p>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 md:text-3xl">Government Portal Uploads</h1>
          <p className="max-w-3xl text-sm text-gray-500">
            Four things land here: two caret-delimited exports and two screenshots of the portal dashboard. Each keeps
            its own history, so uploading one never disturbs another.
          </p>
        </header>

        <ImportLaneCards lanes={[...CSV_LANES, ...SCREENSHOT_LANES]} />

        <div className="space-y-5">
          <GroupHeading
            icon={FileSpreadsheet}
            label="CSV imports"
            detail="Caret-delimited .csv or .txt, saved to the database and parsed into sections."
          />
          <GovernmentPortalCsvSection
            accent={IMPORT_ACCENTS.underTreatment}
            position="1 of 2"
            reportKind="under_treatment"
            title="Import Government Portal Report (MJPJY/PMJAY)"
            description="The Under Treatment export. Single .csv or .txt document, caret-delimited with ^. This is the one the extension alerts are built from."
            showWhatsApp
          />
          <GovernmentPortalCsvSection
            accent={IMPORT_ACCENTS.claims}
            position="2 of 2"
            reportKind="claims_to_be_submitted"
            title="Claims to be Submitted"
            description="The same caret-delimited export, for the Claims to be Submitted list. Upload it daily to track submission status."
            showWhatsApp={false}
          />
        </div>

        <div className="space-y-5">
          <GroupHeading
            icon={Camera}
            label="Screenshot uploads"
            detail="Screen-grab the portal dashboard card list; AI reads the patients out of it."
          />
          <PreauthScreenshotSection
            accent={IMPORT_ACCENTS.preauthToSubmit}
            position="1 of 2"
            listType="to_be_submitted"
            title="Preauthorization to be Submitted"
            description='Upload a screenshot of the "Preauthorization to be Submitted" card list from the NHA provider portal dashboard, to track submission progress.'
          />
          <PreauthScreenshotSection
            accent={IMPORT_ACCENTS.preauthPending}
            position="2 of 2"
            listType="pending"
            title="Preauthorization Pending"
            description='Upload a screenshot of the "Preauthorization Pending" card list from the NHA provider portal dashboard, to track approval progress.'
          />
        </div>
      </div>
    </div>
  );
}
