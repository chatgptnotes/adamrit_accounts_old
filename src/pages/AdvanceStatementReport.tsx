import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, FileText, Search, Download, Printer } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { BillDocumentsSection } from '@/pages/corporate-bill/BillDocumentsSection';
import {
  fetchLatestGovernmentPortalReport,
  syncPortalDataForRegistrationId,
} from '@/lib/governmentPortalReportDb';
import { toast } from 'sonner';
import '@/styles/print.css';

const normalizeLookupValue = (value?: string | null) =>
  (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const getRowRegistrationNos = (item: any) => {
  const patient = item?.patients;
  return [
    item?.yojana_registration_id,
    item?.thumb_registration_no,
    patient?.patients_id,
  ].filter((value): value is string => Boolean(value && String(value).trim()));
};

const getPrimaryRegistrationNo = (item: any) => getRowRegistrationNos(item)[0] || '';

const getRowSearchTokens = (item: any) => {
  const patient = item?.patients;
  return [
    item?.visit_id,
    item?.id,
    patient?.name,
    ...getRowRegistrationNos(item),
  ];
};

const matchesRowSearchTerm = (item: any, searchTerm: string) => {
  const search = normalizeLookupValue(searchTerm);
  if (!search) return true;

  return getRowSearchTokens(item).some((token) =>
    normalizeLookupValue(token).includes(search)
  );
};

const normalizePortalProcedureDetails = (value?: string | null) =>
  [...new Set((value || '').split('|').map((part) => part.trim()).filter(Boolean))].join(', ');

const AdvanceStatementReport = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hospitalConfig, hospitalType } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // URL-persisted state
  const searchParamTerm = searchParams.get('search') || '';
  const dateFrom = searchParams.get('from') || '';
  const dateTo = searchParams.get('to') || '';
  const includeDischargedPatients = searchParams.get('includeDischarged') === '1';
  const [searchInput, setSearchInput] = useState(searchParamTerm);
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState(searchParamTerm);
  const activeSearchTerm = debouncedSearchTerm.trim().length >= 2
    ? debouncedSearchTerm.trim()
    : '';

  // Helper to update URL params
  const updateParams = (updates: Record<string, string | null>) => {
    const newParams = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === '') {
        newParams.delete(key);
      } else {
        newParams.set(key, value);
      }
    });
    setSearchParams(newParams, { replace: true });
  };

  // Setter functions
  const setSearchTerm = (value: string) => {
    setSearchInput(value);
    updateParams({ search: value });
  };
  const setDateFrom = (value: string) => updateParams({ from: value });
  const setDateTo = (value: string) => updateParams({ to: value });
  const setIncludeDischargedPatients = (value: boolean) =>
    updateParams({ includeDischarged: value ? '1' : null });

  const reportScopeLabel = includeDischargedPatients
    ? 'Currently Admitted + Discharged'
    : 'Currently Admitted';
  const reportTitle = includeDischargedPatients
    ? 'Advance Statement Report - Currently Admitted + Discharged'
    : 'Advance Statement Report - Currently Admitted';
  const reportSubtitle = includeDischargedPatients
    ? 'Currently admitted and discharged patients with diagnosis, and planned surgery procedures with costs'
    : 'Currently admitted patients with diagnosis, and planned surgery procedures with costs';

  // Financial data for print report
  const [billsData, setBillsData] = useState<Record<string, number>>({});
  const [advancePaymentsData, setAdvancePaymentsData] = useState<Record<string, { totalAdvance: number; lastPayment: { amount: number; date: string | null } }>>({});
  const [packageNames, setPackageNames] = useState<Record<string, string>>({});
  const [packages, setPackages] = useState<Array<{ id: string; name: string }>>([]);
  const [diagnosesList, setDiagnosesList] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedRow, setSelectedRow] = useState<any | null>(null);
  const [selectedImplantId, setSelectedImplantId] = useState('');
  const [selectedImplantName, setSelectedImplantName] = useState('');
  const [selectedImplantCost, setSelectedImplantCost] = useState('');
  const { data: latestPortalReport } = useQuery({
    queryKey: ['latest-government-portal-report-for-advance-statement'],
    queryFn: () => fetchLatestGovernmentPortalReport(),
    staleTime: 5 * 60_000,
  });
  const { data: implantOptions = [] } = useQuery({
    queryKey: ['advance-statement-implant-options'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('implants')
        .select('id, name')
        .order('name');
      if (error) throw error;
      return (data || []).map((implant: { id: string; name: string | null }) => ({
        value: implant.id,
        label: implant.name || '',
      })).filter((implant) => implant.label);
    },
  });
  const { data: activeVisitImplant } = useQuery({
    queryKey: ['advance-statement-active-implant', selectedRow?.id],
    enabled: !!selectedRow?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('visit_implants')
        .select('id, implant_id, implant_name, amount')
        .eq('visit_id', selectedRow.id)
        .eq('status', 'Active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Debounce search term
  useEffect(() => {
    const timer = setTimeout(() => {
      console.log('🔍 Setting debounced search term:', searchInput);
      setDebouncedSearchTerm(searchInput);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setSearchInput(searchParamTerm);
  }, [searchParamTerm]);

  // Fetch packages for the searchable dropdown from both Yojana masters,
  // followed by CGHS surgeries.
  useEffect(() => {
    const fetchPackages = async () => {
      const [pmjayRes, yojanaRes, cghsRes] = await Promise.all([
        supabase
          .from('pmjay_mjpjay_packages')
          .select('id, treatment_code, treatment_plan')
          .eq('is_active', true)
          .order('treatment_plan'),
        supabase
          .from('yojana_mh_procedures')
          .select('id, procedure_code, package_code, package_name, procedure_name, procedure_label')
          .order('package_name'),
        supabase.from('cghs_surgery').select('id, name').eq('is_active', true).order('name'),
      ]);

      const pmjay = (pmjayRes.data || [])
        .map((p: any) => ({
          id: p.id,
          name: [p.treatment_code, p.treatment_plan].filter(Boolean).join(' - '),
        }))
        .filter((p) => p.name);

      const yojana = (yojanaRes.data || [])
        .map((p: any) => ({
          id: p.id,
          name: [
            p.procedure_code,
            p.package_name || p.procedure_name || p.procedure_label || p.package_code,
          ].filter(Boolean).join(' - '),
        }))
        .filter((p) => p.name);

      const uniquePackages = Array.from(
        new Map([...yojana, ...pmjay, ...(cghsRes.data || [])].map((pkg) => [pkg.name, pkg])).values(),
      );
      setPackages(uniquePackages);
    };

    fetchPackages();
  }, []);

  // Fetch diagnoses master for the editable diagnosis dropdown
  useEffect(() => {
    const fetchDiagnoses = async () => {
      const { data, error } = await supabase
        .from('diagnoses')
        .select('id, name')
        .order('name');

      if (!error && data) {
        setDiagnosesList(data);
      }
    };

    fetchDiagnoses();
  }, []);

  // Fetch advance statement data
  const { data: allData = [], isLoading } = useQuery({
    queryKey: [
      'advance-statement-report-currently-admitted',
      hospitalConfig?.name,
      includeDischargedPatients,
      dateFrom,
      dateTo,
      activeSearchTerm,
    ],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      console.log('🏥 Fetching advance statement data for hospital:', hospitalConfig?.name);
      console.log('🔍 Search params:', { activeSearchTerm, dateFrom, dateTo, includeDischargedPatients });

      let searchOr: string | null = null;
      let matchingPatientIds: string[] = [];
      if (activeSearchTerm) {
        const safeSearch = activeSearchTerm.replace(/[,()]/g, '');
        let patientSearchQuery = supabase
          .from('patients')
          .select('id')
          .or(`name.ilike.%${safeSearch}%,patients_id.ilike.%${safeSearch}%`)
          .limit(100);

        if (hospitalConfig?.name) {
          patientSearchQuery = patientSearchQuery.eq('hospital_name', hospitalConfig.name);
        }

        const { data: matchingPatients, error: patientSearchError } = await patientSearchQuery;
        if (patientSearchError) {
          console.error('Error searching patients for advance statement report:', patientSearchError);
        }

        matchingPatientIds = (matchingPatients || [])
          .map((patient) => patient.id)
          .filter((id): id is string => Boolean(id));

        const visitSearchParts = [
          `visit_id.ilike.%${safeSearch}%`,
          `thumb_registration_no.ilike.%${safeSearch}%`,
          `yojana_registration_id.ilike.%${safeSearch}%`,
        ];
        searchOr = visitSearchParts.join(',');
      }

      let query = supabase
        .from('visits')
        .select(`
          id,
          visit_id,
          thumb_registration_no,
          visit_date,
          status,
          created_at,
          admission_date,
          discharge_date,
          file_status,
          ward_allotted,
          room_allotted,
          comments,
          reason_for_visit,
          package_days,
          package_amount,
          extension_days_count,
          package_name,
          treatment_type,
          yojana_registration_id,
          ipd_admission_notes,
          patients!inner (
            id,
            name,
            patients_id,
            age,
            gender,
            insurance_person_no,
            hospital_name,
            corporate
          ),
          diagnoses!diagnosis_id (
            id,
            name
          ),
          visit_diagnoses (
            diagnoses (
              id,
              name
            )
          ),
          visit_surgeries (
            cghs_surgery (
              id,
              name,
              code,
              category,
              cost,
              NABH_NABL_Rate,
              Non_NABH_NABL_Rate
            )
          )
        `)
        .not('admission_date', 'is', null) // Only get visits with admission date
        .eq('patient_type', 'IPD'); // Only IPD patients (match Currently Admitted Patients)

      if (!includeDischargedPatients) {
        query = query.is('discharge_date', null); // Only get visits WITHOUT discharge date (currently admitted)
      }

      // Apply hospital filter if hospitalConfig exists
      if (hospitalConfig?.name) {
        query = query.eq('patients.hospital_name', hospitalConfig.name);
        console.log('🏥 Applied hospital filter for:', hospitalConfig.name);
      }

      if (matchingPatientIds.length > 0) {
        // Use a direct visit foreign-key filter for patient searches. Combining
        // patient_id.in(...) with visit-column OR filters is unreliable with
        // embedded Supabase relationships.
        query = query.in('patient_id', matchingPatientIds);
        console.log('Applied patient search filter:', matchingPatientIds.length, 'patients');
      } else if (searchOr) {
        query = query.or(searchOr);
        console.log('Applying server-side search filter:', activeSearchTerm);
      }

      // Apply date filters using admission_date instead of visit_date
      if (dateFrom) {
        query = query.gte('admission_date', dateFrom);
      }
      if (dateTo) {
        query = query.lte('admission_date', dateTo);
      }

      query = query
        .order('admission_date', { ascending: false });
      // Removed limit to show all currently admitted patients

      console.log('🔍 Final query before execution:', query);
      const { data, error } = await query;

      if (error) {
        console.error('❌ Error fetching advance statement data:', error);
        console.error('Error details:', error.message, error.details, error.hint);
        console.error('Search term that caused error:', activeSearchTerm);
        throw error;
      }

      console.log(
        '🔍 Query filters applied: admission_date not null,',
        includeDischargedPatients ? 'all discharge states' : 'discharge_date is null,',
        'patient_type = IPD, hospital_name =',
        hospitalConfig?.name
      );
      console.log('🔍 Date filters: from:', dateFrom, 'to:', dateTo);
      console.log('🔍 Raw data length:', data?.length || 0);

      // Fetch room_management data for ward types
      const wardIds = data
        ?.map(visit => visit.ward_allotted)
        .filter((id): id is string => id !== null && id !== undefined) || [];

      const uniqueWardIds = Array.from(new Set(wardIds));

      let wardMapping: Record<string, string> = {};

      if (uniqueWardIds.length > 0) {
        const { data: wardData, error: wardError } = await supabase
          .from('room_management')
          .select('ward_id, ward_type')
          .in('ward_id', uniqueWardIds);

        if (wardError) {
          console.error('Error fetching ward data:', wardError);
        } else if (wardData) {
          // Create a mapping of ward_id to ward_type
          wardMapping = wardData.reduce((acc, ward) => {
            acc[ward.ward_id] = ward.ward_type;
            return acc;
          }, {} as Record<string, string>);
        }
      }

      // Fetch financial_summary for package days, lab, pharmacy
      const visitIds = data?.map(visit => visit.visit_id).filter((id): id is string => id !== null && id !== undefined) || [];
      const uniqueVisitIds = Array.from(new Set(visitIds));

      let financialMapping: Record<string, { total_package_days: number; total_admission_days: number; total_amount_laboratory_services: number; total_amount_pharmacy: number }> = {};

      if (uniqueVisitIds.length > 0) {
        const { data: financialData, error: financialError } = await supabase
          .from('financial_summary')
          .select('visit_id, total_package_days, total_admission_days, total_amount_laboratory_services, total_amount_pharmacy')
          .in('visit_id', uniqueVisitIds);

        if (financialError) {
          console.error('Error fetching financial summary data:', financialError);
        } else if (financialData) {
          financialMapping = financialData.reduce((acc, fs) => {
            if (fs.visit_id) {
              acc[fs.visit_id] = {
                total_package_days: fs.total_package_days || 0,
                total_admission_days: fs.total_admission_days || 0,
                total_amount_laboratory_services: fs.total_amount_laboratory_services || 0,
                total_amount_pharmacy: fs.total_amount_pharmacy || 0,
              };
            }
            return acc;
          }, {} as Record<string, { total_package_days: number; total_admission_days: number; total_amount_laboratory_services: number; total_amount_pharmacy: number }>);
        }
      }

      // Fetch visit_labs for lab totals using UUID ids
      const visitUUIDs = data?.map(visit => visit.id).filter(Boolean) || [];
      const uniqueVisitUUIDs = Array.from(new Set(visitUUIDs));

      const labTotalMapping: Record<string, number> = {};

      if (uniqueVisitUUIDs.length > 0) {
        const { data: labData, error: labError } = await supabase
          .from('visit_labs')
          .select('visit_id, cost')
          .in('visit_id', uniqueVisitUUIDs);

        if (labError) {
          console.error('Error fetching visit_labs data:', labError);
        } else if (labData) {
          labData.forEach((lab: { visit_id: string; cost: string | number | null }) => {
            if (lab.visit_id) {
              labTotalMapping[lab.visit_id] = (labTotalMapping[lab.visit_id] || 0) + (parseFloat(String(lab.cost || '0')) || 0);
            }
          });
        }
      }

      // Build visit_id → patient_id mapping for pharmacy validation
      const visitPatientMap: Record<string, string> = {};
      data?.forEach(visit => {
        if (visit.visit_id && visit.patients?.patients_id) {
          visitPatientMap[visit.visit_id] = visit.patients.patients_id;
        }
      });

      // Fetch pharmacy_sales for pharmacy totals and paid using visit_id
      const pharmacyTotalMapping: Record<string, number> = {};
      const pharmacyPaidMapping: Record<string, number> = {};

      if (uniqueVisitIds.length > 0) {
        const { data: pharmacyData, error: pharmacyError } = await supabase
          .from('pharmacy_sales')
          .select('visit_id, patient_id, total_amount, payment_method, sale_id')
          .in('visit_id', uniqueVisitIds)
          .eq('hospital_name', hospitalConfig?.name || '');

        if (pharmacyError) {
          console.error('Error fetching pharmacy_sales data:', pharmacyError);
        } else if (pharmacyData) {
          const creditSaleIds: number[] = [];
          const creditSaleVisitMap: Record<number, string> = {};

          pharmacyData.forEach((sale: { visit_id: string; patient_id: string | null; total_amount: number | null; payment_method: string | null; sale_id: number }) => {
            if (sale.visit_id) {
              // Only count pharmacy sales that belong to the correct patient for this visit
              const expectedPatientId = visitPatientMap[sale.visit_id];
              if (expectedPatientId && sale.patient_id !== expectedPatientId) {
                return; // Skip records from a different patient
              }
              pharmacyTotalMapping[sale.visit_id] = (pharmacyTotalMapping[sale.visit_id] || 0) + (sale.total_amount || 0);
              if (sale.payment_method !== 'CREDIT') {
                pharmacyPaidMapping[sale.visit_id] = (pharmacyPaidMapping[sale.visit_id] || 0) + (sale.total_amount || 0);
              } else {
                creditSaleIds.push(sale.sale_id);
                creditSaleVisitMap[sale.sale_id] = sale.visit_id;
              }
            }
          });

          if (creditSaleIds.length > 0) {
            const { data: creditPayments } = await supabase
              .from('pharmacy_credit_payments')
              .select('sale_id, amount')
              .in('sale_id', creditSaleIds)
              .eq('hospital_name', hospitalConfig?.name || '');

            (creditPayments || []).forEach((payment: { sale_id: number; amount: number | null }) => {
              const visitId = creditSaleVisitMap[payment.sale_id];
              if (visitId) {
                pharmacyPaidMapping[visitId] = (pharmacyPaidMapping[visitId] || 0) + (payment.amount || 0);
              }
            });
          }
        }
      }

      // Fetch package names from advance_payment
      const packageNameMapping: Record<string, string> = {};
      if (uniqueVisitIds.length > 0) {
        const { data: pkgData, error: pkgError } = await supabase
          .from('advance_payment')
          .select('visit_id, package_name')
          .in('visit_id', uniqueVisitIds)
          .not('package_name', 'is', null)
          .order('created_at', { ascending: false });

        if (!pkgError && pkgData) {
          pkgData.forEach((p: { visit_id: string; package_name: string | null }) => {
            if (p.visit_id && p.package_name && !packageNameMapping[p.visit_id]) {
              packageNameMapping[p.visit_id] = p.package_name;
            }
          });
        }
      }

      // Fetch intimation + bill submission data from bill_preparation
      const billPrepMapping: Record<string, {
        intimation_date: string | null;
        date_of_submission: string | null;
        bill_amount: number | null;
        received_amount: number | null;
        executive_who_submitted: string | null;
        expected_payment_date: string | null;
      }> = {};

      if (uniqueVisitIds.length > 0) {
        const { data: billPrepData, error: billPrepError } = await supabase
          .from('bill_preparation' as any)
          .select('visit_id, intimation_date, date_of_submission, bill_amount, received_amount, executive_who_submitted, expected_payment_date')
          .in('visit_id', uniqueVisitIds);

        if (billPrepError) {
          console.error('Error fetching bill_preparation data:', billPrepError);
        } else if (billPrepData) {
          (billPrepData as any[]).forEach(bp => {
            if (bp.visit_id) {
              billPrepMapping[bp.visit_id] = bp;
            }
          });
        }
      }

      // Merge ward data, financial data, lab totals, and pharmacy totals with visits
      const visitsWithRoomInfo = data?.map(visit => ({
        ...visit,
        room_management: visit.ward_allotted && wardMapping[visit.ward_allotted]
          ? { ward_type: wardMapping[visit.ward_allotted] }
          : null,
        financial_summary: visit.visit_id && financialMapping[visit.visit_id]
          ? financialMapping[visit.visit_id]
          : null,
        lab_total: labTotalMapping[visit.id] || 0,
        pharmacy_total: visit.visit_id ? (pharmacyTotalMapping[visit.visit_id] || 0) : 0,
        pharmacy_paid: visit.visit_id ? (pharmacyPaidMapping[visit.visit_id] || 0) : 0,
        package_details: (visit as any).package_name || packageNameMapping[visit.visit_id || ''] || '',
        bill_prep: visit.visit_id ? (billPrepMapping[visit.visit_id] || null) : null
      })) || [];

      return visitsWithRoomInfo;
    },
  });

  // Keep a defensive client-side filter for any fields returned by the query.
  const advanceData = useMemo(
    () => allData.filter((item) => matchesRowSearchTerm(item, activeSearchTerm)),
    [allData, activeSearchTerm]
  );

  const matchedPortalRegistrationIds = useMemo(() => {
    const ids = (latestPortalReport?.report.rows || [])
      .map((row) => normalizeLookupValue(row.values['Registration ID']))
      .filter((value): value is string => Boolean(value));
    return new Set(ids);
  }, [latestPortalReport]);

  const portalProcedurePackages = useMemo(() => {
    const unique = new Map<string, { id: string; name: string }>();
    for (const row of latestPortalReport?.report.rows || []) {
      const name = normalizePortalProcedureDetails(row.values['Procedure Details']);
      if (!name || unique.has(name)) continue;
      unique.set(name, { id: name, name });
    }
    return [...unique.values()];
  }, [latestPortalReport]);

  const allPackageOptions = useMemo(
    () => Array.from(new Map([...portalProcedurePackages, ...packages].map((pkg) => [pkg.name, pkg])).values()),
    [portalProcedurePackages, packages],
  );

  useEffect(() => {
    if (!selectedRow) {
      setSelectedImplantId('');
      setSelectedImplantName('');
      setSelectedImplantCost('');
      return;
    }

    setSelectedImplantId(activeVisitImplant?.implant_id || '');
    setSelectedImplantName(activeVisitImplant?.implant_name || '');
    setSelectedImplantCost(
      activeVisitImplant?.amount !== null && activeVisitImplant?.amount !== undefined
        ? String(activeVisitImplant.amount)
        : ''
    );
  }, [selectedRow, activeVisitImplant]);

  const isPortalMatchedRegistrationId = (value: string) =>
    matchedPortalRegistrationIds.has(normalizeLookupValue(value));

  const handleImplantSave = async () => {
    if (!selectedRow?.id) {
      toast.error('No visit selected.');
      return;
    }

    const implantName = selectedImplantName.trim();
    const implantCost = Number(selectedImplantCost);

    if (!implantName) {
      toast.error('Enter or select an implant name.');
      return;
    }

    if (!Number.isFinite(implantCost) || implantCost <= 0) {
      toast.error('Enter a valid implant cost.');
      return;
    }

    try {
      let implantId = selectedImplantId;

      if (!implantId) {
        const { data: createdImplant, error: createImplantError } = await supabase
          .from('implants')
          .insert({ name: implantName })
          .select('id')
          .single();

        if (createImplantError) throw createImplantError;
        implantId = createdImplant.id;
        setSelectedImplantId(implantId);
      }

      if (activeVisitImplant?.id) {
        const { error: updateError } = await supabase
          .from('visit_implants')
          .update({
            implant_id: implantId,
            implant_name: implantName,
            quantity: 1,
            rate: implantCost,
            amount: implantCost,
            status: 'Active',
          })
          .eq('id', activeVisitImplant.id);

        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from('visit_implants')
          .insert({
            visit_id: selectedRow.id,
            implant_id: implantId,
            implant_name: implantName,
            quantity: 1,
            rate: implantCost,
            amount: implantCost,
            rate_type: 'private',
            status: 'Active',
          });

        if (insertError) throw insertError;
      }

      await queryClient.invalidateQueries({ queryKey: ['advance-statement-active-implant', selectedRow.id] });
      await queryClient.invalidateQueries({ queryKey: ['advance-statement-implant-options'] });
      await refreshAdvanceStatementData();
      toast.success('Implant saved.');
    } catch (error) {
      console.error('Failed to save implant:', error);
      toast.error('Could not save implant.');
    }
  };

  const refreshAdvanceStatementData = async () => {
    await queryClient.invalidateQueries({ queryKey: ['advance-statement-report-currently-admitted'] });
    await queryClient.refetchQueries({
      queryKey: ['advance-statement-report-currently-admitted'],
      type: 'active',
    });
  };

  useEffect(() => {
    if (!selectedRow) return;
    const refreshedRow = advanceData.find((row) => row.id === selectedRow.id);
    if (!refreshedRow) {
      setSelectedRow(null);
      return;
    }
    if (refreshedRow !== selectedRow) {
      setSelectedRow(refreshedRow);
    }
  }, [advanceData, selectedRow]);

  // Fetch financial data for print report (bills and advance payments)
  useEffect(() => {
    const fetchFinancialData = async () => {
      const filtered = advanceData;

      if (filtered.length === 0) return;

      const visitIds = filtered.map(v => v.visit_id).filter(Boolean) as string[];
      const visitUUIDs = filtered.map(v => v.id).filter(Boolean) as string[];

      if (visitIds.length === 0) return;

      try {
        // Fetch total bill from financial_summary
        const billMap: Record<string, number> = {};

        // Primary approach: bills (text visit_id) → financial_summary (bill_id)
        // This is most reliable since bill_id is the unique constraint in financial_summary
        const { data: billsByVisit } = await supabase
          .from('bills')
          .select('id, patient_id, visit_id')
          .in('visit_id', visitIds);

        console.log('📊 bills by visit_id:', billsByVisit?.length || 0, 'records');

        if (billsByVisit && billsByVisit.length > 0) {
          const billIds = billsByVisit.map(b => b.id);
          const billToPatient: Record<string, string> = {};
          billsByVisit.forEach((b: any) => {
            if (b.patient_id) billToPatient[b.id] = b.patient_id;
          });

          const { data: fsBills, error: fsError } = await supabase
            .from('financial_summary')
            .select('bill_id, total_amount_total')
            .in('bill_id', billIds);

          console.log('📊 financial_summary by bill_id:', fsBills?.length || 0, 'records', fsError);

          if (!fsError && fsBills) {
            fsBills.forEach((fs: any) => {
              const patientId = billToPatient[fs.bill_id];
              if (patientId) {
                billMap[patientId] = (billMap[patientId] || 0) + (fs.total_amount_total || 0);
              }
            });
          }
        }

        // Fallback: try financial_summary by visit UUID directly
        if (Object.keys(billMap).length === 0 || Object.values(billMap).every(v => v === 0)) {
          Object.keys(billMap).forEach(k => delete billMap[k]);

          if (visitUUIDs.length > 0) {
            const { data: fsByVisit, error: fsByVisitError } = await supabase
              .from('financial_summary')
              .select('visit_id, total_amount_total')
              .in('visit_id', visitUUIDs);

            console.log('📊 financial_summary by visit UUID fallback:', fsByVisit?.length || 0, 'records', fsByVisitError);

            if (!fsByVisitError && fsByVisit) {
              const uuidToPatientId: Record<string, string> = {};
              filtered.forEach(v => {
                if (v.id && v.patients?.id) {
                  uuidToPatientId[v.id] = v.patients.id;
                }
              });

              fsByVisit.forEach((fs: any) => {
                if (fs.visit_id) {
                  const patientId = uuidToPatientId[fs.visit_id];
                  if (patientId) {
                    billMap[patientId] = (billMap[patientId] || 0) + (fs.total_amount_total || 0);
                  }
                }
              });
            }
          }
        }

        // Fallback: Calculate total from source service tables if financial_summary has no data
        if (Object.keys(billMap).length === 0 || Object.values(billMap).every(v => v === 0)) {
          Object.keys(billMap).forEach(k => delete billMap[k]);

          try {
            console.log('📊 Calculating total from source service tables...');

            // Batch query all service tables using visit UUIDs
            const [clinicalRes, mandatoryRes, radiologyRes, implantRes, accommodationRes, anesthetistRes] = await Promise.all([
              supabase.from('visit_clinical_services').select('visit_id, amount').in('visit_id', visitUUIDs),
              supabase.from('visit_mandatory_services').select('visit_id, amount').in('visit_id', visitUUIDs),
              supabase.from('visit_radiology').select('visit_id, cost').in('visit_id', visitUUIDs),
              supabase.from('visit_implants').select('visit_id, amount, status').in('visit_id', visitUUIDs),
              supabase.from('visit_accommodations').select('visit_id, amount').in('visit_id', visitUUIDs),
              supabase.from('visit_anesthetists').select('visit_id, rate').in('visit_id', visitUUIDs),
            ]);

            // Build per-visit-UUID totals for each service
            const serviceTotals: Record<string, number> = {};

            const addAmounts = (data: any[] | null, amountField: string, filterFn?: (item: any) => boolean) => {
              if (!data) return;
              data.forEach(item => {
                if (filterFn && !filterFn(item)) return;
                if (item.visit_id) {
                  serviceTotals[item.visit_id] = (serviceTotals[item.visit_id] || 0) + (parseFloat(String(item[amountField] || '0')) || 0);
                }
              });
            };

            addAmounts(clinicalRes.data, 'amount');
            addAmounts(mandatoryRes.data, 'amount');
            addAmounts(radiologyRes.data, 'cost');
            addAmounts(implantRes.data, 'amount', item => item.status === 'Active');
            addAmounts(accommodationRes.data, 'amount');
            addAmounts(anesthetistRes.data, 'rate');

            // Combine with already-available data (lab, surgery) per patient
            filtered.forEach(v => {
              const patientId = v.patients?.id;
              if (!patientId) return;

              const serviceTotal = serviceTotals[v.id] || 0;
              const labTotal = (v as any).lab_total || 0;

              // Calculate surgery total from visit_surgeries data
              let surgeryTotal = 0;
              if (v.visit_surgeries && Array.isArray(v.visit_surgeries)) {
                v.visit_surgeries.forEach((vs: any) => {
                  const surgery = vs.cghs_surgery;
                  if (surgery) {
                    surgeryTotal += parseFloat(String(surgery.NABH_NABL_Rate || surgery.cost || '0')) || 0;
                  }
                });
              }

              const total = serviceTotal + labTotal + surgeryTotal;
              if (total > 0) {
                billMap[patientId] = total;
              }
            });

            console.log('📊 Calculated billMap from source tables:', billMap);
          } catch (serviceError) {
            console.error('Error calculating from service tables:', serviceError);
          }
        }

        console.log('📊 Final billMap:', billMap);

        // Fetch advance payments data
        const advanceMap: Record<string, { totalAdvance: number; lastPayment: { amount: number; date: string | null } }> = {};
        const { data: advances, error: advancesError } = await supabase
          .from('advance_payment')
          .select('visit_id, advance_amount, payment_date')
          .in('visit_id', visitIds)
          .order('payment_date', { ascending: false });

        if (advancesError) {
          console.error('Error fetching advance payments:', advancesError);
        } else if (advances) {
          advances.forEach((payment: { visit_id: string; advance_amount: number; payment_date: string | null }) => {
            if (payment.visit_id) {
              if (!advanceMap[payment.visit_id]) {
                advanceMap[payment.visit_id] = {
                  totalAdvance: 0,
                  lastPayment: { amount: payment.advance_amount || 0, date: payment.payment_date }
                };
              }
              advanceMap[payment.visit_id].totalAdvance += (payment.advance_amount || 0);
            }
          });
        }

        // Set both states together to avoid race condition
        setBillsData(billMap);
        setAdvancePaymentsData(advanceMap);
      } catch (error) {
        console.error('Error fetching financial data:', error);
      }
    };

    fetchFinancialData();
  }, [advanceData]);

  const handlePackageDaysUpdate = async (visitId: string, value: number) => {
    const { error } = await supabase
      .from('visits')
      .update({ package_days: value })
      .eq('id', visitId);

    if (error) {
      console.error('Error updating package days:', error);
    } else {
      await refreshAdvanceStatementData();
    }
  };

  const handlePackageAmountUpdate = async (visitId: string, value: string) => {
    const { error } = await supabase
      .from('visits')
      .update({ package_amount: value })
      .eq('id', visitId);

    if (error) {
      console.error('Error updating package amount:', error);
    } else {
      await refreshAdvanceStatementData();
    }
  };

  const handlePackageNameUpdate = async (visitId: string, name: string) => {
    const { error } = await supabase
      .from('visits')
      .update({ package_name: name || null })
      .eq('id', visitId);

    if (error) {
      console.error('Error updating package name:', error);
    } else {
      await refreshAdvanceStatementData();
    }
  };

  const handleRegistrationIdUpdate = async (visitId: string, value: string) => {
    const normalizedValue = value.trim().toUpperCase();
    const { error } = await supabase
      .from('visits')
      .update({ yojana_registration_id: normalizedValue || null })
      .eq('id', visitId);

    if (error) {
      console.error('Error updating Yojana Registration ID:', error);
      toast.error('Failed to save Registration ID');
      return;
    }

    let portalMatched = false;
    if (normalizedValue) {
      try {
        portalMatched = await syncPortalDataForRegistrationId(normalizedValue);
      } catch (syncError) {
        console.error('Error syncing portal data for Registration ID:', syncError);
      }
    }

    if (selectedRow?.id === visitId) {
      setSelectedRow({ ...selectedRow, yojana_registration_id: normalizedValue || null });
    }

    await refreshAdvanceStatementData();

    toast.success(
      portalMatched
        ? 'Registration ID saved — portal data auto-filled'
        : 'Registration ID saved',
    );
  };

  const handleDiagnosisUpdate = async (visitId: string, diagnosisId: string) => {
    const { error } = await supabase
      .from('visits')
      .update({ diagnosis_id: diagnosisId || null })
      .eq('id', visitId);

    if (error) {
      console.error('Error updating diagnosis:', error);
      toast.error('Failed to update diagnosis');
    } else {
      toast.success('Diagnosis updated');
      queryClient.invalidateQueries({ queryKey: ['advance-statement-report-currently-admitted'] });
    }
  };

  // The typed additional diagnosis lives in visits.ipd_admission_notes.provisional_diagnosis —
  // the same field the Admission Notes page types into — so it syncs both ways.
  const handleAdmissionDiagnosisUpdate = async (visitId: string, existingNotes: any, text: string) => {
    const notes = { ...(existingNotes || {}), provisional_diagnosis: text };
    const { error } = await supabase
      .from('visits')
      .update({ ipd_admission_notes: notes })
      .eq('id', visitId);

    if (error) {
      console.error('Error updating additional diagnosis:', error);
      toast.error('Failed to save diagnosis');
    } else {
      toast.success('Additional diagnosis saved');
      queryClient.invalidateQueries({ queryKey: ['advance-statement-report-currently-admitted'] });
    }
  };

  const handleAdditionalDiagnosisRemove = async (visitId: string, diagnosisId: string) => {
    const { error } = await supabase
      .from('visit_diagnoses' as any)
      .delete()
      .eq('visit_id', visitId)
      .eq('diagnosis_id', diagnosisId);

    if (error) {
      console.error('Error removing additional diagnosis:', error);
      toast.error('Failed to remove diagnosis');
    } else {
      toast.success('Additional diagnosis removed');
      queryClient.invalidateQueries({ queryKey: ['advance-statement-report-currently-admitted'] });
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(amount);
  };

  const handlePrint = async () => {
    // Fetch financial data fresh before printing to guarantee availability
    const visitIds = advanceData.map(v => v.visit_id).filter(Boolean) as string[];
    const visitUUIDs = advanceData.map(v => v.id).filter(Boolean) as string[];

    // Fetch total bill
    let printBillsData: Record<string, number> = {};
    try {
      // Primary: bills → financial_summary
      const { data: billsByVisit } = await supabase
        .from('bills')
        .select('id, patient_id, visit_id')
        .in('visit_id', visitIds);

      if (billsByVisit && billsByVisit.length > 0) {
        const billIds = billsByVisit.map(b => b.id);
        const billToPatient: Record<string, string> = {};
        billsByVisit.forEach((b: any) => { if (b.patient_id) billToPatient[b.id] = b.patient_id; });

        const { data: fsBills, error: fsError } = await supabase
          .from('financial_summary')
          .select('bill_id, total_amount_total')
          .in('bill_id', billIds);

        if (!fsError && fsBills) {
          fsBills.forEach((fs: any) => {
            const patientId = billToPatient[fs.bill_id];
            if (patientId) {
              printBillsData[patientId] = (printBillsData[patientId] || 0) + (fs.total_amount_total || 0);
            }
          });
        }
      }

      // Fallback: financial_summary by visit UUID
      if (Object.keys(printBillsData).length === 0 || Object.values(printBillsData).every(v => v === 0)) {
        printBillsData = {};
        const { data: fsByVisit } = await supabase
          .from('financial_summary')
          .select('visit_id, total_amount_total')
          .in('visit_id', visitUUIDs);

        if (fsByVisit) {
          const uuidToPatientId: Record<string, string> = {};
          advanceData.forEach(v => { if (v.id && v.patients?.id) uuidToPatientId[v.id] = v.patients.id; });
          fsByVisit.forEach((fs: any) => {
            if (fs.visit_id) {
              const patientId = uuidToPatientId[fs.visit_id];
              if (patientId) printBillsData[patientId] = (printBillsData[patientId] || 0) + (fs.total_amount_total || 0);
            }
          });
        }
      }

      // Fallback: calculate from service tables
      if (Object.keys(printBillsData).length === 0 || Object.values(printBillsData).every(v => v === 0)) {
        printBillsData = {};
        try {
          const [clinicalRes, mandatoryRes, radiologyRes, implantRes, accommodationRes, anesthetistRes] = await Promise.all([
            supabase.from('visit_clinical_services').select('visit_id, amount').in('visit_id', visitUUIDs),
            supabase.from('visit_mandatory_services').select('visit_id, amount').in('visit_id', visitUUIDs),
            supabase.from('visit_radiology').select('visit_id, cost').in('visit_id', visitUUIDs),
            supabase.from('visit_implants').select('visit_id, amount, status').in('visit_id', visitUUIDs),
            supabase.from('visit_accommodations').select('visit_id, amount').in('visit_id', visitUUIDs),
            supabase.from('visit_anesthetists').select('visit_id, rate').in('visit_id', visitUUIDs),
          ]);

          const serviceTotals: Record<string, number> = {};
          const addAmounts = (data: any[] | null, field: string, filterFn?: (item: any) => boolean) => {
            if (!data) return;
            data.forEach(item => {
              if (filterFn && !filterFn(item)) return;
              if (item.visit_id) serviceTotals[item.visit_id] = (serviceTotals[item.visit_id] || 0) + (parseFloat(String(item[field] || '0')) || 0);
            });
          };
          addAmounts(clinicalRes.data, 'amount');
          addAmounts(mandatoryRes.data, 'amount');
          addAmounts(radiologyRes.data, 'cost');
          addAmounts(implantRes.data, 'amount', item => item.status === 'Active');
          addAmounts(accommodationRes.data, 'amount');
          addAmounts(anesthetistRes.data, 'rate');

          advanceData.forEach(v => {
            const patientId = v.patients?.id;
            if (!patientId) return;
            const serviceTotal = serviceTotals[v.id] || 0;
            const labTotal = (v as any).lab_total || 0;
            let surgeryTotal = 0;
            if (v.visit_surgeries && Array.isArray(v.visit_surgeries)) {
              v.visit_surgeries.forEach((vs: any) => {
                const surgery = vs.cghs_surgery;
                if (surgery) surgeryTotal += parseFloat(String(surgery.NABH_NABL_Rate || surgery.cost || '0')) || 0;
              });
            }
            const total = serviceTotal + labTotal + surgeryTotal;
            if (total > 0) printBillsData[patientId] = total;
          });
        } catch (e) { console.error('Service tables error:', e); }
      }
    } catch (e) { console.error('Error fetching bills for print:', e); }

    // Fetch advance payments
    const printAdvanceData: Record<string, { totalAdvance: number; lastPayment: { amount: number; date: string | null } }> = {};
    try {
      const { data: advances } = await supabase
        .from('advance_payment')
        .select('visit_id, advance_amount, payment_date')
        .in('visit_id', visitIds)
        .order('payment_date', { ascending: false });

      if (advances) {
        advances.forEach((payment: any) => {
          if (payment.visit_id) {
            if (!printAdvanceData[payment.visit_id]) {
              printAdvanceData[payment.visit_id] = {
                totalAdvance: 0,
                lastPayment: { amount: payment.advance_amount || 0, date: payment.payment_date }
              };
            }
            printAdvanceData[payment.visit_id].totalAdvance += (payment.advance_amount || 0);
          }
        });
      }
    } catch (e) { console.error('Error fetching advance payments for print:', e); }

    console.log('📊 Print billsData:', printBillsData);
    console.log('📊 Print advanceData:', printAdvanceData);

    // Create a print container with only the data
    const printWindow = window.open('', '', 'width=800,height=600');
    
    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Advance Statement Report</title>
          <style>
            @page {
              size: A4 landscape;
              margin: 10mm;
            }
            @media print {
              body { margin: 0; padding: 10px; font-family: Arial, sans-serif; }
              h1 { font-size: 18px; margin-bottom: 20px; text-align: center; }
              h2 { font-size: 16px; margin: 15px 0 10px 0; }
              table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; table-layout: fixed; }
              th, td { border: 1px solid #000; padding: 4px; text-align: left; vertical-align: top; font-size: 10px; word-wrap: break-word; overflow-wrap: break-word; }
              th { background-color: #f5f5f5; font-weight: bold; }
              .patient-details { margin-bottom: 5px; font-size: 10px; }
              .diagnosis-item { background-color: #f0f8ff; padding: 4px; margin: 2px 0; border-radius: 3px; display: inline-block; font-size: 10px; }
              .surgery-item { background-color: #f0fff0; padding: 4px; margin: 2px 0; border-radius: 3px; font-size: 10px; }
              .stats { display: flex; justify-content: space-around; margin: 20px 0; }
              .stat-item { text-align: center; }
              .stat-number { font-size: 20px; font-weight: bold; }
              .stat-label { font-size: 12px; color: #666; }
              .corporate-cell { color: #000000 !important; font-weight: bold; }
            }
            @media screen {
              body { margin: 20px; font-family: Arial, sans-serif; }
              h1 { text-align: center; }
              table { width: 100%; border-collapse: collapse; margin-top: 10px; }
              th, td { border: 1px solid #ddd; padding: 8px; text-align: left; vertical-align: top; }
              th { background-color: #f5f5f5; }
            }
          </style>
        </head>
        <body>
          <h1>${reportTitle}</h1>
          <p style="text-align: center; margin-bottom: 20px;">${reportSubtitle}</p>
          
          <div class="stats">
            <div class="stat-item">
              <div class="stat-number">${advanceData.length}</div>
              <div class="stat-label">${reportScopeLabel}</div>
            </div>
            <div class="stat-item">
              <div class="stat-number">${advanceData.filter(item => item.diagnoses || (item.visit_diagnoses && item.visit_diagnoses.length > 0)).length}</div>
              <div class="stat-label">Patients with Diagnosis</div>
            </div>
            <div class="stat-item">
              <div class="stat-number">${advanceData.reduce((sum, item) => sum + (item.visit_surgeries?.length || 0), 0)}</div>
              <div class="stat-label">Planned Surgeries</div>
            </div>
            <div class="stat-item">
              <div class="stat-number">${new Set(advanceData.flatMap(item => item.visit_surgeries?.map(vs => vs.cghs_surgery?.category).filter(Boolean) || [])).size}</div>
              <div class="stat-label">Surgery Categories</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th style="width: 2%;">Sr.</th>
                <th style="width: 9%;">Patient Details</th>
                ${hospitalType === 'hope' ? '<th style="width: 5%;">Corporate</th>' : ''}
                <th style="width: 5%;">Room/Bed</th>
                <th style="width: 5%;">Admission</th>
                <th style="width: 4%;">Intimation</th>
                <th style="width: 6%;">Diagnosis</th>
                <th style="width: 4%;">Treatment</th>
                <th style="width: 5%;">Pkg Name</th>
                <th style="width: 5%;">Pkg Details</th>
                <th style="width: 3%;">Pkg Days</th>
                <th style="width: 4%;">Pkg Amt</th>
                <th style="width: 4%;">Submission</th>
                <th style="width: 4%;">Lab Amt</th>
                <th style="width: 4%;">Pharmacy</th>
                <th style="width: 4%;">Pharma Paid</th>
                <th style="width: 7%;">Surgery/Procedure</th>
                <th style="width: 5%;">Total Bill</th>
                <th style="width: 5%;">Advance</th>
                <th style="width: 7%;">Last Payment</th>
                <th style="width: 5%;">Balance</th>
                <th style="width: 5%;">Ask to Pay</th>
                <th style="width: 6%;">Remark</th>
              </tr>
            </thead>
            <tbody>
              ${advanceData.map((item, index) => {
                const patient = item.patients;
                const registrationNo = getPrimaryRegistrationNo(item) || 'N/A';
                const patientDetailsText = `
                  <div class="patient-details">
                    <strong>${patient?.name || 'N/A'}</strong><br/>
                    Visit ID: ${item.visit_id || 'N/A'} | Patient ID: ${patient?.patients_id || 'N/A'} | Reg No: ${registrationNo}<br/>
                    Age: ${patient?.age || 'N/A'} | Sex: ${patient?.gender || 'N/A'}${patient?.insurance_person_no ? `<br/>Insurance: ${patient.insurance_person_no}` : ''}
                  </div>
                `;

                const directDiagnosis = item.diagnoses?.name;
                const junctionDiagnoses = item.visit_diagnoses?.map(vd => vd.diagnoses?.name).filter(Boolean) || [];
                const admissionNotesDiagnosis = (item.ipd_admission_notes as any)?.provisional_diagnosis;
                const reasonForVisit = item.reason_for_visit;
                const diagnoses = directDiagnosis ? [directDiagnosis, ...junctionDiagnoses] : junctionDiagnoses;
                const allDiagnoses = [
                  ...diagnoses,
                  ...(admissionNotesDiagnosis ? [admissionNotesDiagnosis] : []),
                  ...(diagnoses.length === 0 && !admissionNotesDiagnosis && reasonForVisit ? [reasonForVisit] : []),
                ];
                const diagnosisText = allDiagnoses.length > 0 ?
                  allDiagnoses.map(diagnosis => `<div class="diagnosis-item">${diagnosis}</div>`).join('') :
                  'No diagnosis recorded';

                const surgeries = item.visit_surgeries?.map(vs => vs.cghs_surgery ? {
                  name: vs.cghs_surgery.name,
                  code: vs.cghs_surgery.code,
                  category: vs.cghs_surgery.category,
                  cost: vs.cghs_surgery.cost,
                  NABH_NABL_Rate: vs.cghs_surgery.NABH_NABL_Rate,
                  Non_NABH_NABL_Rate: vs.cghs_surgery.Non_NABH_NABL_Rate
                } : null).filter(Boolean) || [];

                const surgeryText = surgeries.length > 0 ?
                  surgeries.map(surgery => {
                    let costInfo = '';
                    if (surgery.cost || surgery.NABH_NABL_Rate || surgery.Non_NABH_NABL_Rate) {
                      costInfo = '<br/><span style="color: #16a34a; font-size: 11px;">';
                      if (surgery.cost) costInfo += `Cost: ₹${surgery.cost} `;
                      if (surgery.NABH_NABL_Rate) costInfo += `| NABH/NABL: ₹${surgery.NABH_NABL_Rate} `;
                      if (surgery.Non_NABH_NABL_Rate) costInfo += `| Non-NABH/NABL: ₹${surgery.Non_NABH_NABL_Rate}`;
                      costInfo += '</span>';
                    }
                    return `<div class="surgery-item"><strong>${surgery.name}</strong><br/>Code: ${surgery.code} | Category: ${surgery.category}${costInfo}</div>`;
                  }).join('') :
                  'No surgery planned';

                // Room/Bed text
                const roomBedText = item.room_management?.ward_type && item.room_allotted
                  ? `<strong>${item.room_management.ward_type}</strong><br/>Room ${item.room_allotted}`
                  : 'Not Assigned';

                // Admission date text
                const admissionDateText = item.admission_date
                  ? format(new Date(item.admission_date), 'dd/MM/yyyy')
                  : 'N/A';

                // Corporate type text - will be black in print via CSS class
                const corporateText = patient?.corporate || 'N/A';

                // Financial calculations
                const patientId = patient?.id || '';
                const visitId = item.visit_id || '';
                const totalBill = printBillsData[patientId] || 0;
                const advanceInfo = printAdvanceData[visitId] || { totalAdvance: 0, lastPayment: { amount: 0, date: null } };
                const advanceTillDate = advanceInfo.totalAdvance;
                const lastPayment = advanceInfo.lastPayment;
                const balance = totalBill - advanceTillDate;
                const askToPay = balance > 0 ? balance : 0;
                const remark = item.comments || '';

                // Format last payment text
                const lastPaymentText = lastPayment.amount > 0
                  ? `₹${lastPayment.amount.toLocaleString('en-IN')}${lastPayment.date ? '<br/>' + format(new Date(lastPayment.date), 'dd/MM/yyyy') : ''}`
                  : '-';

                const billPrep = (item as any).bill_prep;
                const intimationDateText = billPrep?.intimation_date
                  ? format(new Date(billPrep.intimation_date), 'dd/MM/yyyy')
                  : '-';
                const submissionDateText = billPrep?.date_of_submission
                  ? format(new Date(billPrep.date_of_submission), 'dd/MM/yyyy')
                  : '-';

                return `
                  <tr>
                    <td style="text-align: center;">${index + 1}</td>
                    <td>${patientDetailsText}</td>
                    ${hospitalType === 'hope' ? `<td style="text-align: center;" class="corporate-cell"><strong>${corporateText}</strong></td>` : ''}
                    <td>${roomBedText}</td>
                    <td style="text-align: center;">${admissionDateText}</td>
                    <td style="text-align: center;">${intimationDateText}</td>
                    <td>${diagnosisText}</td>
                    <td style="text-align: center;">${(item as any).treatment_type || '-'}</td>
                    <td style="text-align: center;">${(item as any).package_name || '-'}</td>
                    <td style="text-align: center;">${item.package_details || '-'}</td>
                    <td style="text-align: center;">${item.package_days || 0}</td>
                    <td style="text-align: right;">₹${(parseFloat(item.package_amount || '0') || 0).toLocaleString('en-IN')}</td>
                    <td style="text-align: center;">${submissionDateText}</td>
                    <td style="text-align: right;">₹${(item.lab_total || 0).toLocaleString('en-IN')}</td>
                    <td style="text-align: right;">₹${(item.pharmacy_total || 0).toLocaleString('en-IN')}</td>
                    <td style="text-align: right;">₹${(item.pharmacy_paid || 0).toLocaleString('en-IN')}</td>
                    <td>${surgeryText}</td>
                    <td style="text-align: right; font-weight: bold;">₹${totalBill.toLocaleString('en-IN')}</td>
                    <td style="text-align: right; color: #16a34a;">₹${advanceTillDate.toLocaleString('en-IN')}</td>
                    <td style="text-align: center; font-size: 11px;">${lastPaymentText}</td>
                    <td style="text-align: right; color: ${balance > 0 ? '#dc2626' : '#16a34a'}; font-weight: bold;">₹${balance.toLocaleString('en-IN')}</td>
                    <td style="text-align: right; color: #ea580c; font-weight: bold;">₹${askToPay.toLocaleString('en-IN')}</td>
                    <td style="font-size: 11px;">${remark || '-'}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
          
          <div style="margin-top: 30px; text-align: center; font-size: 10px; color: #666;">
            Report generated on ${format(new Date(), 'dd/MM/yyyy HH:mm')}
          </div>
        </body>
      </html>
    `;

    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.focus();
      
      // Wait for content to load then print
      setTimeout(() => {
        printWindow.print();
      }, 250);
    }
  };

  const handleExport = () => {
    // Create CSV content
    const headers = ['Sr. No.', 'Patient Details', 'Corporate Type', 'Room/Bed', 'Admission Date', 'Diagnosis', 'Treatment Type', 'Package Details', 'Package Days', 'Package Amount', 'Lab Amount', 'Pharmacy', 'Pharmacy Paid', 'Referral Letter', 'Planned Surgery or Procedure and Cost'];
    const csvContent = [
      headers.join(','),
      ...advanceData.map((item, index) => {
        const patient = item.patients;
        const patientDetails = `${patient?.name || 'N/A'} (Visit: ${item.visit_id || 'N/A'}, Patient ID: ${patient?.patients_id || 'N/A'}, Reg No: ${getPrimaryRegistrationNo(item) || 'N/A'}, Age: ${patient?.age || 'N/A'}, Sex: ${patient?.gender || 'N/A'})`;

        // Room/Bed
        const roomBed = item.room_management?.ward_type && item.room_allotted
          ? `${item.room_management.ward_type} - Room ${item.room_allotted}`
          : 'Not Assigned';

        // Admission Date
        const admissionDate = item.admission_date
          ? format(new Date(item.admission_date), 'dd/MM/yyyy')
          : 'N/A';

        // Corporate Type
        const corporate = patient?.corporate || 'N/A';

        const admissionNotesDiagnosis = (item.ipd_admission_notes as any)?.provisional_diagnosis;
        const diagnoses = item.diagnoses?.name || item.visit_diagnoses?.map(vd => vd.diagnoses?.name).filter(Boolean).join(', ') || admissionNotesDiagnosis || item.reason_for_visit || 'No diagnosis';
        const surgeries = item.visit_surgeries?.map(vs => {
          if (!vs.cghs_surgery) return null;
          let surgeryInfo = `${vs.cghs_surgery.name} (Code: ${vs.cghs_surgery.code})`;
          const costs = [];
          if (vs.cghs_surgery.cost) costs.push(`Cost: ₹${vs.cghs_surgery.cost}`);
          if (vs.cghs_surgery.NABH_NABL_Rate) costs.push(`NABH/NABL: ₹${vs.cghs_surgery.NABH_NABL_Rate}`);
          if (vs.cghs_surgery.Non_NABH_NABL_Rate) costs.push(`Non-NABH/NABL: ₹${vs.cghs_surgery.Non_NABH_NABL_Rate}`);
          if (costs.length > 0) surgeryInfo += ` [${costs.join(', ')}]`;
          return surgeryInfo;
        }).filter(Boolean).join(', ') || 'No surgery planned';

        // Get Referral Letter status
        const getReferralLetterDisplay = (status: string | null) => {
          switch (status) {
            case 'available': return 'Sanctioned';
            case 'missing': return 'Not Sanction';
            case 'pending': return 'Initiated Sanction';
            default: return 'Not Set';
          }
        };

        const referralLetter = getReferralLetterDisplay(item.file_status);

        const packageDays = item.package_days || 0;
        const packageAmount = item.package_amount || '0';
        const packageDetails = (item as any).package_details || '';
        const labAmount = item.lab_total || 0;
        const pharmacyAmount = item.pharmacy_total || 0;
        const pharmacyPaidAmount = item.pharmacy_paid || 0;

        return [
          index + 1,
          `"${patientDetails}"`,
          `"${corporate}"`,
          `"${roomBed}"`,
          `"${admissionDate}"`,
          `"${diagnoses}"`,
          `"${(item as any).treatment_type || ''}"`,
          `"${packageDetails}"`,
          `"${packageDays}"`,
          packageAmount,
          labAmount,
          pharmacyAmount,
          pharmacyPaidAmount,
          `"${referralLetter}"`,
          `"${surgeries}"`
        ].join(',');
      })
    ].join('\n');

    // Download CSV
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `advance_statement_report_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 print:bg-white print:p-0">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button
              onClick={() => navigate('/dashboard')}
              variant="ghost"
              size="sm"
              className="flex w-full items-center justify-center gap-2 print:hidden sm:w-auto"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Adamrit
            </Button>
            <FileText className="hidden h-8 w-8 text-primary sm:block" />
            <div>
              <h1 className="text-2xl font-bold text-primary sm:text-3xl">{reportTitle}</h1>
              <p className="text-sm text-muted-foreground sm:text-base">
                {reportSubtitle}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden sm:gap-4 lg:justify-end">
            <Button
              onClick={handlePrint}
              variant="outline"
              className="flex flex-1 items-center justify-center gap-2 sm:flex-none"
            >
              <Printer className="h-4 w-4" />
              Print Report
            </Button>
            <Button
              onClick={handleExport}
              variant="outline"
              className="flex flex-1 items-center justify-center gap-2 sm:flex-none"
            >
              <Download className="h-4 w-4" />
              Export
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white p-4 rounded-lg shadow-sm border print:hidden sm:p-6">
          <h2 className="mb-4 text-lg font-semibold">Filters</h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
            <div className="space-y-3 lg:col-span-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <Input
                  placeholder="Search by patient name, ID, registration no, or visit ID..."
                  value={searchInput}
                  onChange={(e) => {
                    console.log('🔍 Search input changed:', e.target.value);
                    setSearchTerm(e.target.value);
                  }}
                  className="pl-10"
                />
              </div>
              <div className="flex items-center gap-3 rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-2">
                <Checkbox
                  id="include-discharged"
                  checked={includeDischargedPatients}
                  onCheckedChange={(checked) => setIncludeDischargedPatients(checked === true)}
                />
                <label
                  htmlFor="include-discharged"
                  className="cursor-pointer text-sm font-medium leading-none text-gray-700"
                >
                  Include discharged patients
                </label>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">From Date</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">To Date</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={() => {
                  setSearchTerm('');
                  setDateFrom('');
                  setDateTo('');
                  setIncludeDischargedPatients(false);
                }}
                variant="outline"
                className="w-full"
              >
                Clear Filters
              </Button>
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4 sm:gap-6">
          <div className="bg-white p-4 rounded-lg shadow-sm border sm:p-6">
            <h3 className="text-sm font-medium text-gray-500">{reportScopeLabel}</h3>
            <p className="text-2xl font-bold text-primary">{advanceData.length}</p>
            <p className="text-xs text-gray-500">Raw data: {allData.length}</p>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm border sm:p-6">
            <h3 className="text-sm font-medium text-gray-500">With Diagnosis</h3>
            <p className="text-2xl font-bold text-green-600">
              {advanceData.filter(item =>
                item.diagnoses || (item.visit_diagnoses && item.visit_diagnoses.length > 0)
              ).length}
            </p>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm border sm:p-6">
            <h3 className="text-sm font-medium text-gray-500">Planned Surgeries</h3>
            <p className="text-2xl font-bold text-blue-600">
              {advanceData.reduce((sum, item) =>
                sum + (item.visit_surgeries?.length || 0), 0
              )}
            </p>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm border sm:p-6">
            <h3 className="text-sm font-medium text-gray-500">Surgery Categories</h3>
            <p className="text-2xl font-bold text-purple-600">
              {new Set(
                advanceData.flatMap(item =>
                  item.visit_surgeries?.map(vs => vs.cghs_surgery?.category).filter(Boolean) || []
                )
              ).size}
            </p>
          </div>
        </div>

        {/* Mobile Cards */}
        <div className="grid gap-4 md:hidden print:hidden">
          {isLoading ? (
            <div className="rounded-lg border bg-white p-4 text-center text-sm text-gray-500">
              Loading...
            </div>
          ) : advanceData.length === 0 ? (
            <div className="rounded-lg border bg-white p-4 text-center text-sm text-gray-500">
              No data found
            </div>
          ) : (
            advanceData.map((item, index) => {
              const patient = item.patients;
              const billPrep = (item as any).bill_prep;
              const admissionDate = item.admission_date ? format(new Date(item.admission_date), 'dd/MM/yyyy') : 'N/A';
              const intimationDate = billPrep?.intimation_date ? format(new Date(billPrep.intimation_date), 'dd/MM/yyyy') : '-';
              const submissionDate = billPrep?.date_of_submission ? format(new Date(billPrep.date_of_submission), 'dd/MM/yyyy') : '-';
              const regNo = getPrimaryRegistrationNo(item) || 'N/A';
              const packageName = (item as any).package_name || '-';
              const packageAmount = item.package_amount ? `₹${Number(item.package_amount).toLocaleString('en-IN')}` : '-';
              const billAmount = billPrep?.bill_amount ? `₹${Number(billPrep.bill_amount).toLocaleString('en-IN')}` : '-';

              return (
                <div key={item.id} className="rounded-xl border bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="truncate text-base font-semibold text-gray-900">
                        {index + 1}. {patient?.name || 'N/A'}
                      </div>
                      <div className="text-xs text-gray-500">
                        Visit ID: {item.visit_id || 'N/A'}
                      </div>
                      <div className="text-xs text-gray-500">
                        Reg No: {regNo}
                      </div>
                    </div>
                    <Button type="button" size="sm" variant="outline" onClick={() => setSelectedRow(item)}>
                      Open
                    </Button>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-xs text-gray-500">Admission</div>
                      <div className="font-medium">{admissionDate}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Intimation</div>
                      <div className="font-medium">{intimationDate}</div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-xs text-gray-500">Package</div>
                      <div className="font-medium">{packageName}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Package Amount</div>
                      <div className="font-medium">{packageAmount}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Bill Amount</div>
                      <div className="font-medium">{billAmount}</div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-xs text-gray-500">Submission</div>
                      <div className="font-medium">{submissionDate}</div>
                    </div>
                  </div>

                  <div className="mt-4 flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1"
                      onClick={() => navigate(`/quick-discharge-summary/${item.visit_id}`)}
                    >
                      Discharge Summary
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Data Table */}
        <div className="hidden rounded-lg border bg-white shadow-sm md:block">
          <div className="p-6 border-b">
            <h2 className="text-lg font-semibold">Patient Details with Diagnosis and Surgery Plans</h2>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Sr. No.</TableHead>
                  <TableHead className="min-w-[250px]">Patient Details</TableHead>
                  <TableHead className="min-w-[170px]">Discharge Summary</TableHead>
                  <TableHead className="min-w-[180px]">Registration ID</TableHead>
                  {hospitalType === 'hope' && (
                    <TableHead className="min-w-[150px]">Corporate Type</TableHead>
                  )}
                  <TableHead className="min-w-[120px]">Admission Date</TableHead>
                  <TableHead className="min-w-[120px]">Intimation Date</TableHead>
                  <TableHead className="min-w-[220px]">Diagnosis</TableHead>
                  <TableHead className="min-w-[180px]">Package Name</TableHead>
                  <TableHead className="min-w-[120px]">Package Amount</TableHead>
                  <TableHead className="min-w-[120px]">Submission Date</TableHead>
                  <TableHead className="min-w-[120px]">Bill Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={hospitalType === 'hope' ? 12 : 11} className="text-center py-8">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : advanceData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={hospitalType === 'hope' ? 12 : 11} className="text-center py-8 text-gray-500">
                      No data found
                    </TableCell>
                  </TableRow>
                ) : (
                  advanceData.map((item, index) => {
                    const patient = item.patients;
                    const patientDetails = (
                      <div className="space-y-1">
                        <div className="font-medium">{patient?.name || 'N/A'}</div>
                        <div className="text-sm text-gray-500">
                          Visit ID: {item.visit_id || 'N/A'} | Patient ID: {patient?.patients_id || 'N/A'} | Reg No: {getPrimaryRegistrationNo(item) || 'N/A'}
                        </div>
                        <div className="text-sm text-gray-500">
                          Age: {patient?.age || 'N/A'} | Sex: {patient?.gender || 'N/A'}
                        </div>
                        {patient?.insurance_person_no && (
                          <div className="text-sm text-blue-600">Insurance: {patient.insurance_person_no}</div>
                        )}
                      </div>
                    );

                    const directDiagnosis = item.diagnoses?.name;
                    const junctionDiagnoses = item.visit_diagnoses?.map(vd => vd.diagnoses?.name).filter(Boolean) || [];
                    const admissionNotesDiagnosis = (item.ipd_admission_notes as any)?.provisional_diagnosis;
                    const reasonForVisit = item.reason_for_visit;
                    const diagnoses = directDiagnosis ? [directDiagnosis, ...junctionDiagnoses] : junctionDiagnoses;
                    const allDiagnoses = [
                      ...diagnoses,
                      ...(admissionNotesDiagnosis ? [admissionNotesDiagnosis] : []),
                      ...(diagnoses.length === 0 && !admissionNotesDiagnosis && reasonForVisit ? [reasonForVisit] : []),
                    ];
                    const junctionDiagObjs = (item.visit_diagnoses?.map(vd => vd.diagnoses).filter(Boolean) || []) as Array<{ id: string; name: string }>;

                    // Admission date display
                    const admissionDateDisplay = item.admission_date ? (
                      <span className="text-sm">{format(new Date(item.admission_date), 'dd/MM/yyyy')}</span>
                    ) : (
                      <span className="text-gray-500">N/A</span>
                    );

                    // Corporate type display - blue on desktop, black on print
                    const corporateDisplay = patient?.corporate ? (
                      <span className="text-sm font-medium text-indigo-600 print:text-black">{patient.corporate}</span>
                    ) : (
                      <span className="text-gray-500">N/A</span>
                    );

                    const billPrep = (item as any).bill_prep;

                    return (
                      <TableRow
                        key={item.id}
                        onClick={() => setSelectedRow(item)}
                        className="cursor-pointer hover:bg-gray-50"
                      >
                        <TableCell className="text-center">{index + 1}</TableCell>
                        <TableCell>{patientDetails}</TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="whitespace-nowrap"
                            onClick={() => navigate(`/quick-discharge-summary/${item.visit_id}`)}
                          >
                            <FileText className="mr-1 h-4 w-4" />
                            Generate
                          </Button>
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div
                            className={
                              `rounded-md border p-0.5 transition-colors ${
                                isPortalMatchedRegistrationId((item as any).yojana_registration_id || '')
                                  ? 'border-emerald-400 bg-emerald-50'
                                  : 'border-transparent'
                              }`
                            }
                          >
                            <Input
                              defaultValue={(item as any).yojana_registration_id || ''}
                              placeholder="Registration ID..."
                              className="h-8 border-0 bg-transparent text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                              onBlur={(e) => {
                                const v = e.target.value.trim();
                                if (v !== ((item as any).yojana_registration_id || '')) {
                                  handleRegistrationIdUpdate(item.id, v);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  (e.target as HTMLInputElement).blur();
                                }
                              }}
                            />
                          </div>
                        </TableCell>
                        {hospitalType === 'hope' && (
                          <TableCell>{corporateDisplay}</TableCell>
                        )}
                        <TableCell>{admissionDateDisplay}</TableCell>
                        <TableCell>
                          {billPrep?.intimation_date ? (
                            <span className="text-sm">{format(new Date(billPrep.intimation_date), 'dd/MM/yyyy')}</span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="space-y-1">
                            <SearchableSelect
                              options={diagnosesList.map(d => ({ value: d.id, label: d.name }))}
                              value={item.diagnoses?.id || ''}
                              onValueChange={(value) => handleDiagnosisUpdate(item.id, value)}
                              placeholder="Select diagnosis..."
                              searchPlaceholder="Type to search..."
                              className="w-full"
                            />
                            {junctionDiagObjs.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {junctionDiagObjs.map((d) => (
                                  <span
                                    key={d.id}
                                    className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700"
                                  >
                                    {d.name}
                                    <button
                                      type="button"
                                      className="text-gray-400 hover:text-red-600"
                                      title="Remove this diagnosis"
                                      onClick={() => handleAdditionalDiagnosisRemove(item.id, d.id)}
                                    >
                                      ×
                                    </button>
                                  </span>
                                ))}
                              </div>
                            )}
                            <Input
                              defaultValue={admissionNotesDiagnosis || ''}
                              placeholder="Type additional diagnosis..."
                              className="h-8 text-xs"
                              onBlur={(e) => {
                                const v = e.target.value.trim();
                                if (v !== (admissionNotesDiagnosis || '')) {
                                  handleAdmissionDiagnosisUpdate(item.id, item.ipd_admission_notes, v);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  (e.target as HTMLInputElement).blur();
                                }
                              }}
                            />
                          </div>
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <SearchableSelect
                            options={allPackageOptions.map(pkg => ({ value: pkg.name, label: pkg.name }))}
                            value={(item as any).package_name || ''}
                            onValueChange={(value) => handlePackageNameUpdate(item.id, value)}
                            placeholder="Select package..."
                            searchPlaceholder="Type to search..."
                            className="w-full"
                          />
                        </TableCell>
                        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                          <Input
                            type="number"
                            className="w-24 text-center h-8 text-sm"
                            defaultValue={item.package_amount || ''}
                            placeholder="0"
                            onBlur={(e) => {
                              const val = e.target.value;
                              if (val !== (item.package_amount || '')) {
                                handlePackageAmountUpdate(item.id, val);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                (e.target as HTMLInputElement).blur();
                              }
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          {billPrep?.date_of_submission ? (
                            <span className="text-sm">{format(new Date(billPrep.date_of_submission), 'dd/MM/yyyy')}</span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {billPrep?.bill_amount ? (
                            <span className="text-sm font-medium">₹{Number(billPrep.bill_amount).toLocaleString('en-IN')}</span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {/* Extended row details in a right sidebar */}
      <Sheet open={!!selectedRow} onOpenChange={(open) => { if (!open) setSelectedRow(null); }}>
        <SheetContent className="w-full sm:w-[480px] sm:max-w-[480px] overflow-y-auto">
          {selectedRow && (() => {
            const patient = selectedRow.patients;
            const billPrep = selectedRow.bill_prep;
            const patientId = patient?.id || '';
            const visitId = selectedRow.visit_id || '';
            const totalBill = billsData[patientId] || 0;
            const advanceInfo = advancePaymentsData[visitId] || { totalAdvance: 0, lastPayment: { amount: 0, date: null } };
            const balance = totalBill - advanceInfo.totalAdvance;

            const directDiagnosis = selectedRow.diagnoses?.name;
            const junctionDiagnoses = selectedRow.visit_diagnoses?.map((vd: any) => vd.diagnoses?.name).filter(Boolean) || [];
            const admissionNotesDiagnosis = selectedRow.ipd_admission_notes?.provisional_diagnosis;
            const allDiagnoses = [
              ...(directDiagnosis ? [directDiagnosis] : []),
              ...junctionDiagnoses,
              ...(admissionNotesDiagnosis ? [admissionNotesDiagnosis] : []),
            ];

            const surgeries = selectedRow.visit_surgeries?.map((vs: any) => vs.cghs_surgery).filter(Boolean) || [];

            const detailRow = (label: string, value: ReactNode) => (
              <div className="flex flex-col gap-1 border-b border-gray-100 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span className="shrink-0 text-gray-500">{label}</span>
                <span className="text-left font-medium sm:text-right">{value}</span>
              </div>
            );

            const sectionCard = (title: string, children: ReactNode) => (
              <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
                <div className="space-y-2">{children}</div>
              </div>
            );

            const formatDateOrDash = (d: string | null | undefined) =>
              d ? format(new Date(d), 'dd/MM/yyyy') : '-';

            return (
              <div className="space-y-6">
                <SheetHeader>
                  <SheetTitle>{patient?.name || 'N/A'}</SheetTitle>
                  <div className="text-sm text-gray-500">
                    Visit ID: {selectedRow.visit_id || 'N/A'} | Patient ID: {patient?.patients_id || 'N/A'} | Reg No: {getPrimaryRegistrationNo(selectedRow) || 'N/A'}
                  </div>
                  <div className="text-sm text-gray-500">
                    Age: {patient?.age || 'N/A'} | Sex: {patient?.gender || 'N/A'}
                    {patient?.corporate && <> | {patient.corporate}</>}
                  </div>
                  {patient?.insurance_person_no && (
                    <div className="text-sm text-blue-600">Insurance: {patient.insurance_person_no}</div>
                  )}
                </SheetHeader>

                {sectionCard('Patient Details', (
                  <>
                    {detailRow('Patient Name', patient?.name || 'N/A')}
                    {detailRow('Visit ID', selectedRow.visit_id || 'N/A')}
                    {detailRow('Patient ID', patient?.patients_id || 'N/A')}
                    {detailRow('Age / Sex', `${patient?.age || 'N/A'} / ${patient?.gender || 'N/A'}`)}
                    {detailRow('Corporate', patient?.corporate || 'N/A')}
                  </>
                ))}

                {sectionCard('Registration ID', (
                  <Input
                    value={selectedRow.yojana_registration_id || ''}
                    onChange={(e) => setSelectedRow({ ...selectedRow, yojana_registration_id: e.target.value })}
                    onBlur={(e) => {
                      const value = e.target.value.trim();
                      if (value !== (selectedRow.yojana_registration_id || '')) {
                        handleRegistrationIdUpdate(selectedRow.id, value);
                        setSelectedRow({ ...selectedRow, yojana_registration_id: value || null });
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    placeholder="Enter registration ID"
                    className="h-11"
                  />
                ))}

                <div>
                  <h3 className="text-sm font-semibold mb-2">Admission</h3>
                  {detailRow('Admission Date', formatDateOrDash(selectedRow.admission_date))}
                  {detailRow('Room/Bed', selectedRow.room_management?.ward_type && selectedRow.room_allotted
                    ? `${selectedRow.room_management.ward_type} - Room ${selectedRow.room_allotted}`
                    : 'Not Assigned')}
                  {detailRow('Treatment Type', selectedRow.treatment_type
                    ? <Badge variant="outline" className="capitalize">{selectedRow.treatment_type}</Badge>
                    : '-')}
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-2">Diagnosis</h3>
                  {allDiagnoses.length > 0 ? (
                    <div className="space-y-1">
                      {allDiagnoses.map((diagnosis: string, idx: number) => (
                        <div key={idx} className="text-sm bg-blue-50 px-2 py-1 rounded">{diagnosis}</div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-sm text-gray-500">No diagnosis recorded</span>
                  )}
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-2">Package</h3>
                  {detailRow('Package Name', (
                    <SearchableSelect
                      options={allPackageOptions.map(pkg => ({ value: pkg.name, label: pkg.name }))}
                      value={selectedRow.package_name || ''}
                      onValueChange={(value) => {
                        handlePackageNameUpdate(selectedRow.id, value);
                        setSelectedRow({ ...selectedRow, package_name: value });
                      }}
                      placeholder="Select package..."
                      searchPlaceholder="Type to search..."
                      className="w-60"
                    />
                  ))}
                  {detailRow('Package Amount', selectedRow.package_amount
                    ? `₹${(parseFloat(selectedRow.package_amount) || 0).toLocaleString('en-IN')}`
                    : '-')}
                  {detailRow('Package Days', (
                    <Input
                      type="number"
                      className="w-20 text-center h-7 text-sm"
                      defaultValue={selectedRow.package_days || 0}
                      min={0}
                      onBlur={(e) => {
                        const val = parseInt(e.target.value) || 0;
                        if (val !== (selectedRow.package_days || 0)) {
                          handlePackageDaysUpdate(selectedRow.id, val);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                    />
                  ))}
                  {detailRow('Extension Days', selectedRow.extension_days_count ?? 0)}
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-2">Implant</h3>
                  {detailRow('Implant Name', (
                    <div className="space-y-2">
                      <SearchableSelect
                        options={implantOptions}
                        value={selectedImplantId}
                        onValueChange={(value) => {
                          setSelectedImplantId(value);
                          const selectedOption = implantOptions.find((opt) => opt.value === value);
                          setSelectedImplantName(selectedOption?.label || '');
                        }}
                        placeholder="Select implant..."
                        searchPlaceholder="Type to search..."
                        className="w-60"
                      />
                      <Input
                        value={selectedImplantName}
                        onChange={(e) => setSelectedImplantName(e.target.value)}
                        placeholder="Enter implant name"
                        className="w-60"
                      />
                    </div>
                  ))}
                  {detailRow('Implant Cost', (
                    <Input
                      type="number"
                      value={selectedImplantCost}
                      onChange={(e) => setSelectedImplantCost(e.target.value)}
                      placeholder="Enter implant cost"
                      className="w-40 text-right"
                    />
                  ))}
                  <div className="pt-2">
                    <Button type="button" variant="outline" onClick={() => void handleImplantSave()}>
                      Save Implant
                    </Button>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-2">Intimation + Bill Submission</h3>
                  {detailRow('Intimation Date', formatDateOrDash(billPrep?.intimation_date))}
                  {detailRow('Submission Date', formatDateOrDash(billPrep?.date_of_submission))}
                  {detailRow('Bill Amount', billPrep?.bill_amount
                    ? `₹${Number(billPrep.bill_amount).toLocaleString('en-IN')}`
                    : '-')}
                  {detailRow('Received Amount', billPrep?.received_amount
                    ? `₹${Number(billPrep.received_amount).toLocaleString('en-IN')}`
                    : '-')}
                  {detailRow('Submitted By', billPrep?.executive_who_submitted || '-')}
                  {detailRow('Expected Payment', formatDateOrDash(billPrep?.expected_payment_date))}
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-2">Charges</h3>
                  {detailRow('Lab Amount', `₹${(selectedRow.lab_total || 0).toLocaleString('en-IN')}`)}
                  {detailRow('Pharmacy', `₹${(selectedRow.pharmacy_total || 0).toLocaleString('en-IN')}`)}
                  {detailRow('Pharmacy Paid', `₹${(selectedRow.pharmacy_paid || 0).toLocaleString('en-IN')}`)}
                  {detailRow('Total Bill', `₹${totalBill.toLocaleString('en-IN')}`)}
                  {detailRow('Advance Till Date', `₹${advanceInfo.totalAdvance.toLocaleString('en-IN')}`)}
                  {detailRow('Balance', (
                    <span className={balance > 0 ? 'text-red-600' : 'text-green-600'}>
                      ₹{balance.toLocaleString('en-IN')}
                    </span>
                  ))}
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-2">Planned Surgery / Procedure</h3>
                  {surgeries.length > 0 ? (
                    <div className="space-y-2">
                      {surgeries.map((surgery: any, idx: number) => (
                        <div key={idx} className="border-l-2 border-green-200 pl-3 bg-green-50 p-2 rounded">
                          <div className="font-medium text-sm">{surgery.name}</div>
                          <div className="text-xs text-gray-600">
                            Code: {surgery.code} | Category: {surgery.category}
                          </div>
                          {(surgery.cost || surgery.NABH_NABL_Rate || surgery.Non_NABH_NABL_Rate) && (
                            <div className="text-xs text-green-700 mt-1 space-y-0.5">
                              {surgery.cost && <div>Cost: ₹{surgery.cost}</div>}
                              {surgery.NABH_NABL_Rate && <div>NABH/NABL Rate: ₹{surgery.NABH_NABL_Rate}</div>}
                              {surgery.Non_NABH_NABL_Rate && <div>Non-NABH/NABL Rate: ₹{surgery.Non_NABH_NABL_Rate}</div>}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-sm text-gray-500">No surgery planned</span>
                  )}
                </div>

                {selectedRow.comments && (
                  <div>
                    <h3 className="text-sm font-semibold mb-2">Remark</h3>
                    <p className="text-sm text-gray-700">{selectedRow.comments}</p>
                  </div>
                )}

                <BillDocumentsSection
                  patientId={patient?.id}
                  patientName={patient?.name}
                  patientRegistrationNo={getPrimaryRegistrationNo(selectedRow) || patient?.patients_id || ''}
                  visitId={selectedRow?.visit_id || patient?.visit_id || ''}
                />
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default AdvanceStatementReport;
