import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import DischargeSummaryPrint from '../DischargeSummaryPrint';

/**
 * The page has four visible states and picks between them in a specific order:
 * loading wins over error, error wins over unusable data, and only a non-empty
 * summary string reaches the printable view. The order matters — a blank page
 * at a discharge desk is indistinguishable from a slow one, so each state has
 * to say which it is.
 *
 * Only the page is under test. The hook, the summary builder and the heavy
 * DischargeSummary component are stubbed so a change in any of them fails in
 * its own test rather than here.
 */

const useVisitDiagnosis = vi.hoisted(() => vi.fn());
const buildDischargeSummaryText = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useVisitDiagnosis', () => ({ useVisitDiagnosis }));
vi.mock('@/lib/dischargeSummaryText', () => ({ buildDischargeSummaryText }));

vi.mock('@/components/DischargeSummary', () => ({
  default: ({ visitId, allPatientData }: { visitId?: string; allPatientData?: string }) => (
    <div data-testid="discharge-summary">
      <p>Visit ID: {visitId}</p>
      <p>Patient Data: {allPatientData ? 'Loaded' : 'Not loaded'}</p>
    </div>
  ),
}));

const renderAt = (visitId = 'TEST123') =>
  render(
    <MemoryRouter initialEntries={[`/discharge-summary-print/${visitId}`]}>
      <Routes>
        <Route path="/discharge-summary-print/:visitId" element={<DischargeSummaryPrint />} />
      </Routes>
    </MemoryRouter>
  );

const hookReturns = (over: Partial<{ data: unknown; isLoading: boolean; error: unknown }>) =>
  useVisitDiagnosis.mockReturnValue({ data: null, isLoading: false, error: null, ...over });

describe('DischargeSummaryPrint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildDischargeSummaryText.mockReturnValue('Patient summary text');
  });

  it('shows a loading state while the diagnosis is being fetched', () => {
    hookReturns({ isLoading: true });
    renderAt();

    expect(screen.getByText('Loading discharge summary data...')).toBeInTheDocument();
    expect(screen.queryByTestId('discharge-summary')).not.toBeInTheDocument();
  });

  it('reports a fetch failure instead of rendering an empty summary', () => {
    hookReturns({ error: new Error('Database connection failed') });
    renderAt();

    expect(screen.getByText('OPD Summary Not Available')).toBeInTheDocument();
    expect(screen.getByText(/Database connection failed/)).toBeInTheDocument();
    expect(screen.queryByTestId('discharge-summary')).not.toBeInTheDocument();
  });

  it('names the visit it could not find, so the desk can check the id', () => {
    hookReturns({ data: null });
    renderAt('V-404');

    expect(screen.getByText('OPD Summary Not Available')).toBeInTheDocument();
    expect(screen.getByText(/No discharge summary data found for Visit ID: V-404/)).toBeInTheDocument();
  });

  it('distinguishes unusable data from missing data', () => {
    // The row loaded, but the builder could make nothing of it. That is a
    // different problem from "no such visit" and must not print as one.
    hookReturns({ data: { visitId: 'TEST123' } });
    buildDischargeSummaryText.mockReturnValue('');
    renderAt();

    expect(screen.getByText('Invalid Patient Data')).toBeInTheDocument();
    expect(screen.queryByText('OPD Summary Not Available')).not.toBeInTheDocument();
  });

  it('renders the printable summary once real data is available', () => {
    hookReturns({ data: { visitId: 'TEST123', patientName: 'Test Patient' } });
    renderAt();

    expect(screen.getByTestId('discharge-summary')).toBeInTheDocument();
    expect(screen.getByText('Patient Data: Loaded')).toBeInTheDocument();
    expect(screen.getByText('🖨️ Print OPD Summary')).toBeInTheDocument();
    expect(screen.getByText('← Back')).toBeInTheDocument();
  });

  it('passes the visit id from the url through to the summary', () => {
    hookReturns({ data: { visitId: 'IH25F14' } });
    renderAt('IH25F14');

    expect(useVisitDiagnosis).toHaveBeenCalledWith('IH25F14');
    expect(screen.getByText('Visit ID: IH25F14')).toBeInTheDocument();
  });
});
