/**
 * Panel-wise mandatory document hooks.
 *
 * Every mutation invalidates BOTH the checklist key and the tablet bell key —
 * the bell derives its pending-document count from the same RPC, so marking a
 * document N/A on the checklist has to drop the bell count in the same tick.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import {
  fetchCorporatePatientCounts,
  fetchPanelDocumentStatus,
  fetchPendingPanelDocumentPatients,
  findUnmappedPanelCorporates,
  unwaivePanelDocument,
  waivePanelDocument,
  type PanelDocumentStatusFilter,
  type WaivePanelDocumentInput,
} from '@/lib/panelDocumentsDb';
import type { RegistrationPanelName } from '@/lib/registrationDocuments';

export const PANEL_DOCUMENT_QUERY_KEY = ['panel-document-status'] as const;

/**
 * The yellow bell's existing query key, re-exported so mutations here can
 * invalidate it without importing the component.
 * Keep in sync with src/tablet/shell/GovernmentPortalExtensionBell.tsx.
 */
export const PANEL_DOCUMENT_BELL_QUERY_KEY = [
  'tablet-government-portal-extension-alerts',
] as const;

interface UsePanelDocumentStatusOptions {
  panel?: RegistrationPanelName | null;
  status?: PanelDocumentStatusFilter;
  search?: string | null;
  /** Null covers both hospitals, matching the cross-hospital Director view. */
  hospitalName?: string | null;
  page?: number;
  pageSize?: number;
}

export function usePanelDocumentStatus({
  panel = null,
  status = 'pending',
  search = null,
  hospitalName = null,
  page = 0,
  pageSize = 20,
}: UsePanelDocumentStatusOptions = {}) {
  return useQuery({
    queryKey: [...PANEL_DOCUMENT_QUERY_KEY, hospitalName, panel, status, search, page, pageSize],
    queryFn: () =>
      fetchPanelDocumentStatus({
        hospitalName,
        panel,
        status,
        search,
        limit: pageSize,
        offset: page * pageSize,
      }),
    // Keep the current page on screen while the next one loads, so paging and
    // typing in the search box don't flash an empty table.
    placeholderData: (previous) => previous,
    staleTime: 30 * 1000,
  });
}

/** Just the count of patients with pending documents — for the preview card. */
export function usePanelPendingDocumentCount(hospitalName: string | null = null) {
  return useQuery({
    queryKey: [...PANEL_DOCUMENT_QUERY_KEY, 'pending-count', hospitalName],
    queryFn: () => fetchPendingPanelDocumentPatients({ hospitalName, limit: 1 }),
    staleTime: 60 * 1000,
  });
}

/**
 * One patient's checklist row, resolved from a UUID. Backs the bell's deep
 * link, so it must not filter by status — the screen still has to open after
 * the last document is submitted.
 */
export function usePanelDocumentPatient(patientUuid: string | null) {
  return useQuery({
    queryKey: [...PANEL_DOCUMENT_QUERY_KEY, 'patient', patientUuid],
    enabled: Boolean(patientUuid),
    queryFn: async () => {
      const { rows } = await fetchPanelDocumentStatus({
        patientUuid,
        status: 'all',
        limit: 1,
      });
      return rows[0] ?? null;
    },
    staleTime: 30 * 1000,
  });
}

/** First page of pending-document patients, for the Director preview list. */
export function usePendingPanelDocumentPatients(
  hospitalName: string | null = null,
  limit = 5,
) {
  return useQuery({
    queryKey: [...PANEL_DOCUMENT_QUERY_KEY, 'pending-preview', hospitalName, limit],
    queryFn: () => fetchPendingPanelDocumentPatients({ hospitalName, limit }),
    staleTime: 60 * 1000,
  });
}

function useInvalidatePanelDocuments() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: PANEL_DOCUMENT_QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: PANEL_DOCUMENT_BELL_QUERY_KEY });
  };
}

export function useWaivePanelDocument() {
  const { user } = useAuth();
  const invalidate = useInvalidatePanelDocuments();

  return useMutation({
    mutationFn: (input: Omit<WaivePanelDocumentInput, 'waivedBy'>) =>
      waivePanelDocument({
        ...input,
        waivedBy: user?.email || user?.username || null,
      }),
    onSuccess: invalidate,
  });
}

export function useUnwaivePanelDocument() {
  const invalidate = useInvalidatePanelDocuments();

  return useMutation({
    mutationFn: ({
      patientUuid,
      documentName,
    }: {
      patientUuid: string;
      documentName: string;
    }) => unwaivePanelDocument(patientUuid, documentName),
    onSuccess: invalidate,
  });
}

/**
 * Corporate spellings that look like a panel but match no alias, so their
 * patients silently never appear in the checklist or the bell.
 */
export function useUnmappedPanelCorporates(hospitalName: string | null = null) {
  return useQuery({
    queryKey: ['panel-document-unmapped-corporates', hospitalName],
    queryFn: async () => findUnmappedPanelCorporates(
      await fetchCorporatePatientCounts(hospitalName),
    ),
    staleTime: 5 * 60 * 1000,
  });
}
