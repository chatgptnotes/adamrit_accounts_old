import { GovernmentPortalCsvSection } from '@/components/government-portal/GovernmentPortalCsvSection';
import { PreauthScreenshotSection } from '@/components/government-portal/PreauthScreenshotSection';

export default function GovernmentPortalReportImport() {
  return (
    <div className="mx-auto max-w-7xl space-y-8 p-4 md:p-6">
      <GovernmentPortalCsvSection
        reportKind="under_treatment"
        title="Import Government Portal Report (MJPJY/PMJAY)"
        description="Single .csv or .txt document, caret-delimited with ^. Uploads are saved to the database."
        showWhatsApp
      />

      <PreauthScreenshotSection
        listType="to_be_submitted"
        title="Preauthorization to be Submitted (Screenshot Upload)"
        description='Upload a screenshot of the "Preauthorization to be Submitted" card list from the NHA provider portal dashboard. AI reads the patient list for you to track submission progress.'
      />

      <PreauthScreenshotSection
        listType="pending"
        title="Preauthorization Pending (Screenshot Upload)"
        description='Upload a screenshot of the "Preauthorization Pending" card list from the NHA provider portal dashboard. AI reads the patient list for you to track approval progress.'
      />

      <GovernmentPortalCsvSection
        reportKind="claims_to_be_submitted"
        title="Claims to be Submitted"
        description="Same caret-delimited .csv/.txt export as above, for the Claims to be Submitted list. Upload it daily to track submission status."
        showWhatsApp={false}
      />
    </div>
  );
}
