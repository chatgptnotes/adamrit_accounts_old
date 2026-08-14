// ============================================================================
// Corporate Claim Pagination & Server-Side Filtering
// ============================================================================
// Efficient pagination and filtering for large datasets
// Reduces client-side load by fetching data in chunks
// ============================================================================

import { supabase } from '@/integrations/supabase/client';

export interface PaginationFilters {
  scheme?: 'PMJAY' | 'MJPJAY' | 'ALL';
  stage?: string;
  verificationState?: string;
  admissionStatus?: string;
  hospital?: string;
  searchQuery?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface PaginationOptions {
  page: number;
  limit: number;
  filters: PaginationFilters;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

/**
 * Build Supabase query with filters
 */
function buildQuery(filters: PaginationFilters, sortBy?: string, sortOrder?: 'asc' | 'desc' = 'desc') {
  let query = supabase
    .from('corporate_claim_snapshots')
    .select('*', { count: 'exact' });

  // Scheme filter
  if (filters.scheme && filters.scheme !== 'ALL') {
    query = query.eq('scheme_code', filters.scheme);
  }

  // Stage filter
  if (filters.stage && filters.stage !== 'all') {
    query = query.contains('parsed_data', { current_stage: filters.stage });
  }

  // Hospital filter
  if (filters.hospital) {
    query = query.eq('hospital_name', filters.hospital);
  }

  // Search query (searches in parsed_data)
  if (filters.searchQuery && filters.searchQuery.trim()) {
    const searchTerm = filters.searchQuery.trim().toLowerCase();
    query = query.or(`parsed_data->>beneficiary_name.ilike.%${searchTerm}%,parsed_data->>government_registration_id.ilike.%${searchTerm}%`);
  }

  // Date range filter
  if (filters.dateFrom) {
    query = query.gte('created_at', filters.dateFrom);
  }
  if (filters.dateTo) {
    query = query.lte('created_at', filters.dateTo);
  }

  // Sorting
  if (sortBy) {
    query = query.order(sortBy, { ascending: sortOrder === 'asc' });
  } else {
    // Default sort by created_at descending
    query = query.order('created_at', { ascending: false });
  }

  return query;
}

/**
 * Fetch paginated claims from server
 */
export async function fetchClaimsPaginated(
  options: PaginationOptions
): Promise<PaginatedResult<any>> {
  const { page, limit, filters, sortBy, sortOrder } = options;

  // Calculate offset
  const offset = (page - 1) * limit;

  // Build query
  const query = buildQuery(filters, sortBy, sortOrder);

  // Fetch data with pagination
  const { data, error, count } = await query
    .range(offset, offset + limit - 1)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch claims: ${error.message}`);
  }

  // Parse JSONB data for each row
  const parsedData = (data || []).map(row => ({
    id: row.id,
    ...row.parsed_data,
    source_file_name: row.source_file_name,
    row_number: row.row_number,
    created_at: row.created_at
  }));

  // Calculate pagination metadata
  const total = count || 0;
  const totalPages = Math.ceil(total / limit);

  return {
    data: parsedData,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1
    }
  };
}

/**
 * Fetch claims by hospital with pagination
 */
export async function fetchClaimsByHospital(
  hospitalName: string,
  page: number = 1,
  limit: number = 50
): Promise<PaginatedResult<any>> {
  return fetchClaimsPaginated({
    page,
    limit,
    filters: { hospital: hospitalName }
  });
}

/**
 * Fetch claims by scheme with pagination
 */
export async function fetchClaimsByScheme(
  scheme: 'PMJAY' | 'MJPJAY',
  page: number = 1,
  limit: number = 50
): Promise<PaginatedResult<any>> {
  return fetchClaimsPaginated({
    page,
    limit,
    filters: { scheme: scheme }
  });
}

/**
 * Search claims with pagination
 */
export async function searchClaims(
  searchQuery: string,
  page: number = 1,
  limit: number = 50
): Promise<PaginatedResult<any>> {
  return fetchClaimsPaginated({
    page,
    limit,
    filters: { searchQuery }
  });
}

/**
 * Get total counts for dashboard metrics
 */
export async function fetchDashboardMetrics(): Promise<{
  total: number;
  matched: number;
  unmatched: number;
  active_ipd: number;
  discharged: number;
  needs_review: number;
  paid_total: number;
  paid_rows: number;
}> {
  // For now, fetch all and calculate client-side
  // In production, these would be separate optimized queries or materialized views

  const { data, error } = await supabase
    .from('corporate_claim_snapshots')
    .select('id, parsed_data');

  if (error || !data) {
    return {
      total: 0,
      matched: 0,
      unmatched: 0,
      active_ipd: 0,
      discharged: 0,
      needs_review: 0,
      paid_total: 0,
      paid_rows: 0
    };
  }

  // Parse and calculate metrics
  const claims = data.map(row => row.parsed_data);

  return {
    total: claims.length,
    matched: claims.filter((c: any) => c.verification_state === 'matched').length,
    unmatched: claims.filter((c: any) => c.verification_state === 'unmatched').length,
    active_ipd: claims.filter((c: any) => c.admission_status === 'active_ipd').length,
    discharged: claims.filter((c: any) => c.admission_status === 'discharged').length,
    needs_review: claims.filter((c: any) =>
      c.verification_state === 'unmatched' ||
      c.verification_state === 'invalid'
    ).length,
    paid_total: claims.reduce((sum: number, c: any) => sum + Number(c.paid_amount || 0), 0),
    paid_rows: claims.filter((c: any) => Number(c.paid_amount || 0) > 0).length
  };
}

/**
 * Invalidate cache for a specific filter combination
 * Useful when data changes and cache needs to be refreshed
 */
export function invalidatePaginationCache(filters: PaginationFilters): void {
  // In a real implementation, this would clear a cache store
  // For now, it's a placeholder for cache invalidation logic

  const cacheKey = generateCacheKey(filters);
  // Cache invalidation would happen here
  console.log(`Cache invalidated for key: ${cacheKey}`);
}

/**
 * Generate a consistent cache key for filters
 */
function generateCacheKey(filters: PaginationFilters): string {
  const parts = [
    filters.scheme || 'ALL',
    filters.stage || 'all',
    filters.verificationState || 'all',
    filters.admissionStatus || 'all',
    filters.hospital || '',
    filters.searchQuery || '',
    filters.dateFrom || '',
    filters.dateTo || ''
  ];

  return parts.join(':');
}

/**
 * Prefetch next page for smooth UX
 */
export async function prefetchNextPage(
  currentPage: number,
  currentOptions: PaginationOptions
): Promise<void> {
  if (currentPage > 0) {
    // Prefetch next page in background
    fetchClaimsPaginated({
      ...currentOptions,
      page: currentPage + 1
    }).catch(() => {
      // Silently fail prefetch
    });
  }
}
