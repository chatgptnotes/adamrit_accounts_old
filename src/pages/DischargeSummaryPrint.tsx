import { useParams } from 'react-router-dom';
import DischargeSummary from '@/components/DischargeSummary';
import { useVisitDiagnosis } from '@/hooks/useVisitDiagnosis';
import { buildDischargeSummaryText } from '@/lib/dischargeSummaryText';

export default function DischargeSummaryPrint() {
  const { visitId } = useParams<{ visitId: string }>();

  console.log('🚀 DischargeSummaryPrint rendered with visitId:', visitId);

  // Fetch real visit diagnosis data from database
  const { data: visitDiagnosis, isLoading, error } = useVisitDiagnosis(visitId || '');

  console.log('📊 useVisitDiagnosis results:', { data: visitDiagnosis, isLoading, error });

  // Generate dynamic patient data string from database data only.
  // The wording now lives in one shared builder, because the Documents &
  // Images section produces the same summary as a downloadable PDF and the two
  // must not drift apart.
  const generatePatientDataString = (data: any) => {
    if (!data) return null;
    return buildDischargeSummaryText(data);
  };

  // Only use real database data - no fallbacks
  const patientDataString = visitDiagnosis ? generatePatientDataString(visitDiagnosis) : null;

  console.log('📝 Generated patientDataString:', patientDataString);

  const handlePrint = () => {
    try {

      // Check if print is supported
      if (!window.print) {
        console.error('window.print is not available');
        alert('Print functionality is not supported in this browser.');
        return;
      }


      // Hide any tooltips or dropdowns that might interfere
      const tooltips = document.querySelectorAll('[role="tooltip"], .tooltip, .dropdown-menu');
      tooltips.forEach(tooltip => {
        if (tooltip instanceof HTMLElement) {
          tooltip.style.display = 'none';
        }
      });

      // Add print event listeners for debugging
      const beforePrint = () => {
      };

      const afterPrint = () => {
      };

      window.addEventListener('beforeprint', beforePrint);
      window.addEventListener('afterprint', afterPrint);

      // Ensure the page is fully loaded before printing
      if (document.readyState !== 'complete') {
        window.addEventListener('load', () => {
          setTimeout(() => {
            window.print();
          }, 300);
        });
      } else {
        // Small delay to ensure all styles are applied
        setTimeout(() => {
          window.print();
        }, 300);
      }

      // Clean up event listeners after a delay
      setTimeout(() => {
        window.removeEventListener('beforeprint', beforePrint);
        window.removeEventListener('afterprint', afterPrint);
      }, 5000);

    } catch (error) {
      console.error('Print error:', error);
      alert('Print functionality encountered an error. Please try again or use your browser\'s print option (Ctrl+P).');
    }
  };




  // Show loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading discharge summary data...</p>
          <p className="text-sm text-gray-500">Fetching diagnosis information from database</p>
        </div>
      </div>
    );
  }

  // Show error state when data cannot be loaded
  if (error || (!isLoading && !visitDiagnosis)) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-8">
          <div className="text-red-500 mb-4">
            <svg className="h-16 w-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.728-.833-2.498 0L4.316 15.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-red-600 mb-4">OPD Summary Not Available</h1>
          <p className="text-gray-600 mb-4">
            {error
              ? `Error loading data: ${error.message || 'Database connection failed'}`
              : `No discharge summary data found for Visit ID: ${visitId || 'Unknown'}`
            }
          </p>
          <div className="space-y-3">
            <p className="text-sm text-gray-500">Possible reasons:</p>
            <ul className="text-sm text-gray-500 list-disc list-inside space-y-1">
              <li>Visit ID does not exist in the database</li>
              <li>Discharge summary has not been completed yet</li>
              <li>Database connection issue</li>
              <li>Insufficient permissions to access patient data</li>
            </ul>
          </div>
          <div className="mt-6 space-x-4">
            <button
              onClick={() => window.history.back()}
              className="bg-gray-600 text-white px-6 py-3 rounded-md hover:bg-gray-700 transition-colors font-medium shadow-sm"
            >
              ← Go Back
            </button>
            <button
              onClick={() => window.location.reload()}
              className="bg-blue-600 text-white px-6 py-3 rounded-md hover:bg-blue-700 transition-colors font-medium shadow-sm"
            >
              🔄 Retry
            </button>
          </div>
          <div className="mt-4 text-xs text-gray-400">
            Visit ID: {visitId || 'Not provided'}
          </div>
        </div>
      </div>
    );
  }

  // Only render if we have valid data
  if (!patientDataString) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-yellow-500 mb-4">
            <svg className="h-16 w-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.728-.833-2.498 0L4.316 15.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-yellow-600 mb-4">Invalid Patient Data</h1>
          <p className="text-gray-600 mb-4">
            The patient data retrieved from the database is incomplete or invalid.
          </p>
          <button
            onClick={() => window.history.back()}
            className="bg-gray-600 text-white px-6 py-3 rounded-md hover:bg-gray-700 transition-colors font-medium shadow-sm"
          >
            ← Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div id="print-root" className="discharge-summary-print min-h-screen bg-white">
      {/* Print Button - Hidden in print */}
      <div className="no-print mb-4 text-center p-4 bg-gray-50 border-b">
        <div className="flex justify-center gap-4">
          <button
            onClick={handlePrint}
            className="bg-blue-600 text-white px-6 py-3 rounded-md hover:bg-blue-700 transition-colors font-medium shadow-sm"
            title="Print this discharge summary"
          >
            🖨️ Print OPD Summary
          </button>
          <button
            onClick={() => {
              // Fallback print method
              try {
                // Try to trigger print dialog directly
                window.print();
              } catch (error) {
                // If that fails, show instructions
                alert('Please use Ctrl+P (Windows) or Cmd+P (Mac) to print this document.');
              }
            }}
            className="bg-green-600 text-white px-6 py-3 rounded-md hover:bg-green-700 transition-colors font-medium shadow-sm"
            title="Alternative print method"
          >
            📄 Alternative Print
          </button>
          <button
            onClick={() => window.history.back()}
            className="bg-gray-600 text-white px-6 py-3 rounded-md hover:bg-gray-700 transition-colors font-medium shadow-sm"
            title="Go back to previous page"
          >
            ← Back
          </button>
        </div>
        <p className="text-sm text-gray-600 mt-2">
          If print button doesn't work, use <kbd className="bg-gray-200 px-1 rounded">Ctrl+P</kbd> (Windows) or <kbd className="bg-gray-200 px-1 rounded">Cmd+P</kbd> (Mac)
        </p>
        <div className="text-xs text-gray-500 mt-1">
          Data Source: ✅ Database (Real Data Only) |
          Print Status: <span id="print-status">Ready</span> |
          Browser: {navigator.userAgent.includes('Chrome') ? 'Chrome' : navigator.userAgent.includes('Firefox') ? 'Firefox' : navigator.userAgent.includes('Safari') ? 'Safari' : 'Other'}
        </div>
      </div>

      {/* Use the existing DischargeSummary component with real database data only */}
      <DischargeSummary
        visitId={visitId}
        allPatientData={patientDataString}
        patientDataSummary={undefined}
      />

      {/* Print Styles */}
      <style>{`
        @media print {
          /* Hide non-print elements */
          .no-print {
            display: none !important;
          }

          /* Ensure discharge summary content is fully visible */
          #print-root,
          .discharge-summary-print,
          .discharge-summary-print * {
            visibility: visible !important;
            display: block !important;
            height: auto !important;
            min-height: auto !important;
            max-height: none !important;
            overflow: visible !important;
          }

          /* Reset body styles for print */
          body {
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
            font-family: Arial, sans-serif !important;
            font-size: 12px !important;
            line-height: 1.4 !important;
            color: #000 !important;
            height: auto !important;
            overflow: visible !important;
          }

          /* Ensure colors print correctly */
          * {
            -webkit-print-color-adjust: exact !important;
            color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          /* Page setup */
          @page {
            margin: 0.5in 0.75in;
            size: A4 portrait;
          }

          /* Reset container styles */
          .min-h-screen {
            min-height: auto !important;
            background: white !important;
            height: auto !important;
            overflow: visible !important;
          }

          /* Ensure proper text rendering */
          h1, h2, h3, h4, h5, h6 {
            color: #000 !important;
            page-break-after: avoid !important;
          }

          p, div, span {
            color: #000 !important;
          }

          /* Sections should be visible */
          section, .section {
            display: block !important;
            visibility: visible !important;
            height: auto !important;
            overflow: visible !important;
            page-break-inside: avoid !important;
          }

          /* Table styles for better print output */
          table {
            border-collapse: collapse !important;
            width: 100% !important;
            page-break-inside: auto !important;
          }

          th, td {
            border: 1px solid #000 !important;
            padding: 8px !important;
            text-align: left !important;
            page-break-inside: avoid !important;
          }

          /* Avoid page breaks in important sections */
          .page-break-inside-avoid,
          .break-inside-avoid {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }

          /* Force black text for all elements */
          * {
            color: #000 !important;
            background: transparent !important;
          }

          /* Exception for backgrounds that should print */
          .print-background {
            background: #f5f5f5 !important;
          }
        }

        /* Print preview styles (when not printing) */
        @media screen {
          .print-preview {
            max-width: 8.5in;
            margin: 0 auto;
            background: white;
            box-shadow: 0 0 10px rgba(0,0,0,0.1);
            padding: 0.5in;
          }
        }
      `}</style>
    </div>
  );
}