import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { AlertCircle, ChevronLeft, ChevronRight, Download, Edit, Eye, Plus, Shield, Trash2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { usePermissions } from '@/hooks/usePermissions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/searchable-select';
import { MultiSelectDropdown } from '@/components/EditPatientDialog/MultiSelectDropdown';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

type PmjayPackageRow = {
  id: string;
  scheme: string;
  remark: string | null;
  diagnosis_code: string | null;
  diagnosis: string | null;
  treatment_code: string | null;
  treatment_plan: string | null;
  category: string | null;
  package_price: number | null;
  patient_name_example: string | null;
  anaesthesia_type: string | null;
  is_active: boolean;
  created_at: string | null;
};

type PackageSurgeonRow = {
  package_id: string;
  surgeon_id: string | null;
  surgeon_name: string;
  surgeon_department: string | null;
};

type PackageAnaesthetistRow = {
  package_id: string;
  anaesthetist_name: string;
};

type PackageImplantRow = {
  package_id: string;
  implant_id: string | null;
  implant_name: string;
};

type MasterSurgeon = {
  id: string;
  name: string;
  department: string | null;
  is_active: boolean | null;
};

type MasterAnaesthetist = {
  name: string;
  specialty: string | null;
};

type MasterImplant = {
  id: string;
  name: string;
};

type EnrichedPackage = PmjayPackageRow & {
  surgeon_names: string[];
  surgeon_departments: string[];
  anaesthetist_names: string[];
  implant_names: string[];
};

type PackageFormState = {
  scheme: string;
  remark: string;
  diagnosis_code: string;
  diagnosis: string;
  treatment_code: string;
  treatment_plan: string;
  category: string;
  package_price: string;
  patient_name_example: string;
  anaesthesia_type: string;
  surgeon_names: string[];
  anaesthetist_names: string[];
  implant_names: string[];
};

const EMPTY_FORM: PackageFormState = {
  scheme: 'PMJAY',
  remark: '',
  diagnosis_code: '',
  diagnosis: '',
  treatment_code: '',
  treatment_plan: '',
  category: '',
  package_price: '',
  patient_name_example: '',
  anaesthesia_type: '',
  surgeon_names: [],
  anaesthetist_names: [],
  implant_names: [],
};

const ANAESTHESIA_OPTIONS: SearchableSelectOption[] = [
  { value: 'general', label: 'General Anaesthesia', selectedLabel: 'General Anaesthesia' },
  { value: 'spinal', label: 'Spinal Anaesthesia', selectedLabel: 'Spinal Anaesthesia' },
  { value: 'epidural', label: 'Epidural Anaesthesia', selectedLabel: 'Epidural Anaesthesia' },
  { value: 'regional', label: 'Regional Anaesthesia', selectedLabel: 'Regional Anaesthesia' },
  { value: 'local', label: 'Local Anaesthesia', selectedLabel: 'Local Anaesthesia' },
  { value: 'sedation', label: 'Sedation', selectedLabel: 'Sedation' },
  {
    value: 'monitored-anesthesia-care',
    label: 'Monitored Anesthesia Care',
    selectedLabel: 'Monitored Anesthesia Care',
  },
];

const joinList = (items: string[]) => (items.length > 0 ? items.join(', ') : '-');

const asText = (value: unknown) => (value == null ? '' : String(value));

const splitDelimitedList = (input: unknown) =>
  [...new Set(
    asText(input)
      .split(/[,\n|;]+/)
      .map((part) => part.trim())
      .filter(Boolean),
  )];

const pickText = (...values: Array<unknown>) =>
  values.map((value) => asText(value).trim()).find((value) => value && value.length > 0) || '';

const inferDepartment = (record: EnrichedPackage): string => {
  const haystack = [
    record.treatment_code,
    record.treatment_plan,
    record.diagnosis_code,
    record.diagnosis,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/\bdialysis\b|\bhaemodialysis\b|\bhemodialysis\b|\brenal\b/.test(haystack)) return 'Nephrology';
  if (/neuro|brain|crani|cerebral|stroke|head injury|spine|laminectomy|discectomy/.test(haystack)) return 'Neurosurgery';
  if (/ortho|fracture|plate|nailing|fixation|arthros|tendon|bone|pelviacetabular|elbow|forearm/.test(haystack)) return 'Orthopedics';
  if (/cardio|angioplasty|ptca|pacemaker|coronary|stent|stenting|angiogram/.test(haystack)) return 'Cardiology';
  if (/uro|renal tumor|pcnl|ureter|ureteric|cysto|prostate|bladder|kidney|stenting including cystoscopy/.test(haystack)) return 'Urology';
  if (/hysterectomy|gyne|obstet|obg|pelvic|salpingo|omentectomy/.test(haystack)) return 'Gynecology';
  if (/oncology|tumou?r|cancer|chemotherapy|cyclophosphamide/.test(haystack)) return 'Oncology';
  if (/ent|ear|nose|throat|mastoid|otitis|tonsil|sinus/.test(haystack)) return 'ENT';
  if (/laparotomy|hernia|append|gastro|lap\./.test(haystack)) return 'General Surgery';
  if (/medical|medicine|dehydration|sepsis|ketoacidosis|stroke|hyponatremia|thrombocytopenia/.test(haystack)) return 'General Medicine';
  return record.category || 'Unclassified';
};

const isMissingRelationError = (error: unknown) =>
  Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === '42P01');

const safeSelectRows = async <T,>(
  query: Promise<{ data: T[] | null; error: any }>,
  label: string,
): Promise<T[]> => {
  const { data, error } = await query;
  if (error) {
    if (isMissingRelationError(error)) {
      console.warn(`PMJAY master: ${label} table is missing, using empty links`);
      return [];
    }
    throw error;
  }
  return (data || []) as T[];
};

const PmjayMjpjayMaster = () => {
  const { canEditMasters } = usePermissions();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const searchTerm = searchParams.get('search') || '';
  const currentPage = parseInt(searchParams.get('page') || '1');
  const itemsPerPage = parseInt(searchParams.get('perPage') || '10');

  const updateParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (!value || (key === 'page' && value === '1') || (key === 'perPage' && value === '10')) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
    });
    setSearchParams(next, { replace: true });
  };

  const setSearchTerm = (value: string) => updateParams({ search: value, page: '1' });
  const setCurrentPage = (value: number) => updateParams({ page: String(value) });
  const setItemsPerPage = (value: number) => updateParams({ perPage: String(value), page: '1' });

  const [totalCount, setTotalCount] = useState(0);
  const [showInactive, setShowInactive] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [viewingRecord, setViewingRecord] = useState<EnrichedPackage | null>(null);
  const [editingRecord, setEditingRecord] = useState<EnrichedPackage | null>(null);
  const [deletingRecord, setDeletingRecord] = useState<EnrichedPackage | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [createForm, setCreateForm] = useState<PackageFormState>(EMPTY_FORM);
  const [editForm, setEditForm] = useState<PackageFormState>(EMPTY_FORM);
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState('');
  const selectedDepartment = viewingRecord ? inferDepartment(viewingRecord) : '';

  const { data: surgeons = [] } = useQuery({
    queryKey: ['hope-surgeons-options'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hope_surgeons')
        .select('id, name, department, is_active')
        .order('name');

      if (error) throw error;
      return (data || []) as MasterSurgeon[];
    },
  });

  const { data: anaesthetists = [] } = useQuery({
    queryKey: ['hope-anaesthetists-options'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hope_anaesthetists')
        .select('name, specialty')
        .order('name');

      if (error) throw error;
      return (data || []) as MasterAnaesthetist[];
    },
  });

  const { data: implants = [] } = useQuery({
    queryKey: ['implant-options'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('implants')
        .select('id, name')
        .order('name');

      if (error) throw error;
      return (data || []) as MasterImplant[];
    },
  });

  const surgeonByName = useMemo(
    () => new Map(surgeons.map((surgeon) => [surgeon.name, surgeon])),
    [surgeons],
  );
  const anaesthetistByName = useMemo(
    () => new Map(anaesthetists.map((anaesthetist) => [anaesthetist.name, anaesthetist])),
    [anaesthetists],
  );
  const implantByName = useMemo(
    () => new Map(implants.map((implant) => [implant.name, implant])),
    [implants],
  );

  const surgeonOptions = useMemo(
    () => surgeons.map((surgeon) => surgeon.name),
    [surgeons],
  );
  const anaesthetistOptions = useMemo(
    () => anaesthetists.map((anaesthetist) => anaesthetist.name),
    [anaesthetists],
  );
  const implantOptions = useMemo(
    () => implants.map((implant) => implant.name),
    [implants],
  );

  const packageQuery = useQuery({
    queryKey: ['pmjay-mjpjay-packages', searchTerm, currentPage, itemsPerPage, showInactive],
    queryFn: async () => {
      const from = (currentPage - 1) * itemsPerPage;
      const to = from + itemsPerPage - 1;

      let query = supabase.from('pmjay_mjpjay_packages').select('*', { count: 'exact' });
      if (!showInactive) query = query.eq('is_active', true);
      if (searchTerm.trim()) {
        const term = searchTerm.trim();
        query = query.or(
          [
            `scheme.ilike.*${term}*`,
            `diagnosis_code.ilike.*${term}*`,
            `diagnosis.ilike.*${term}*`,
            `treatment_code.ilike.*${term}*`,
            `treatment_plan.ilike.*${term}*`,
            `category.ilike.*${term}*`,
            `anaesthesia_type.ilike.*${term}*`,
          ].join(','),
        );
      }

      const { data, error, count } = await query.order('created_at', { ascending: true }).range(from, to);
      if (error) throw error;
      setTotalCount(count || 0);

      const rows = (data || []) as PmjayPackageRow[];
      if (rows.length === 0) return [] as EnrichedPackage[];

      const packageIds = rows.map((row) => row.id);
      const [surgeonLinks, anaesthetistLinks, implantLinks] = await Promise.all([
        safeSelectRows<PackageSurgeonRow>(
          supabase
            .from('pmjay_mjpjay_package_surgeons')
            .select('package_id, surgeon_id, surgeon_name, surgeon_department, created_at')
            .in('package_id', packageIds)
            .order('created_at', { ascending: true }),
          'pmjay_mjpjay_package_surgeons',
        ),
        safeSelectRows<PackageAnaesthetistRow>(
          supabase
            .from('pmjay_mjpjay_package_anaesthetists')
            .select('package_id, anaesthetist_name, created_at')
            .in('package_id', packageIds)
            .order('created_at', { ascending: true }),
          'pmjay_mjpjay_package_anaesthetists',
        ),
        safeSelectRows<PackageImplantRow>(
          supabase
            .from('pmjay_mjpjay_package_implants')
            .select('package_id, implant_id, implant_name, created_at')
            .in('package_id', packageIds)
            .order('created_at', { ascending: true }),
          'pmjay_mjpjay_package_implants',
        ),
      ]);

      const packageToSurgeons = new Map<string, PackageSurgeonRow[]>();
      surgeonLinks.forEach((row) => {
        const existing = packageToSurgeons.get(row.package_id) || [];
        existing.push(row);
        packageToSurgeons.set(row.package_id, existing);
      });

      const packageToAnaesthetists = new Map<string, PackageAnaesthetistRow[]>();
      anaesthetistLinks.forEach((row) => {
        const existing = packageToAnaesthetists.get(row.package_id) || [];
        existing.push(row);
        packageToAnaesthetists.set(row.package_id, existing);
      });

      const packageToImplants = new Map<string, PackageImplantRow[]>();
      implantLinks.forEach((row) => {
        const existing = packageToImplants.get(row.package_id) || [];
        existing.push(row);
        packageToImplants.set(row.package_id, existing);
      });

      return rows.map((row) => {
        const surgeonsForPackage = packageToSurgeons.get(row.id) || [];
        const anaesthetistsForPackage = packageToAnaesthetists.get(row.id) || [];
        const implantsForPackage = packageToImplants.get(row.id) || [];

        return {
          ...row,
          surgeon_names: [...new Set(surgeonsForPackage.map((item) => item.surgeon_name).filter(Boolean))],
          surgeon_departments: [
            ...new Set(surgeonsForPackage.map((item) => item.surgeon_department).filter(Boolean) as string[]),
          ],
          anaesthetist_names: [...new Set(anaesthetistsForPackage.map((item) => item.anaesthetist_name).filter(Boolean))],
          implant_names: [...new Set(implantsForPackage.map((item) => item.implant_name).filter(Boolean))],
        } as EnrichedPackage;
      });
    },
  });

  const packageRows = packageQuery.data || [];
  const isLoading = packageQuery.isLoading;
  const error = packageQuery.error;

  const normalizeSelections = (form: PackageFormState) => ({
    surgeons: [...new Set(form.surgeon_names.map((name) => name.trim()).filter(Boolean))],
    anaesthetists: [...new Set(form.anaesthetist_names.map((name) => name.trim()).filter(Boolean))],
    implants: [...new Set(form.implant_names.map((name) => name.trim()).filter(Boolean))],
  });

  const persistPackageLinks = async (packageId: string, form: PackageFormState) => {
    const selections = normalizeSelections(form);

    try {
      const deleteSurgeons = supabase
        .from('pmjay_mjpjay_package_surgeons')
        .delete()
        .eq('package_id', packageId);
      const deleteAnaesthetists = supabase
        .from('pmjay_mjpjay_package_anaesthetists')
        .delete()
        .eq('package_id', packageId);
      const deleteImplants = supabase
        .from('pmjay_mjpjay_package_implants')
        .delete()
        .eq('package_id', packageId);

      const [deleteSurgeonsRes, deleteAnaesthetistsRes, deleteImplantsRes] = await Promise.all([
        deleteSurgeons,
        deleteAnaesthetists,
        deleteImplants,
      ]);

      if (deleteSurgeonsRes.error && !isMissingRelationError(deleteSurgeonsRes.error)) throw deleteSurgeonsRes.error;
      if (deleteAnaesthetistsRes.error && !isMissingRelationError(deleteAnaesthetistsRes.error)) throw deleteAnaesthetistsRes.error;
      if (deleteImplantsRes.error && !isMissingRelationError(deleteImplantsRes.error)) throw deleteImplantsRes.error;
    } catch (error) {
      if (!isMissingRelationError(error)) throw error;
      console.warn('PMJAY master: skipping link table cleanup because one or more link tables are missing');
    }

    if (selections.surgeons.length > 0) {
      const surgeonPayload = selections.surgeons.map((name) => {
        const master = surgeonByName.get(name);
        return {
          package_id: packageId,
          surgeon_id: master?.id || null,
          surgeon_name: name,
          surgeon_department: master?.department || null,
        };
      });
      const { error: surgeonsError } = await supabase
        .from('pmjay_mjpjay_package_surgeons')
        .insert(surgeonPayload);
      if (surgeonsError && !isMissingRelationError(surgeonsError)) throw surgeonsError;
    }

    if (selections.anaesthetists.length > 0) {
      const anaesthetistPayload = selections.anaesthetists.map((name) => ({
        package_id: packageId,
        anaesthetist_name: name,
      }));
      const { error: anaesthetistsError } = await supabase
        .from('pmjay_mjpjay_package_anaesthetists')
        .insert(anaesthetistPayload);
      if (anaesthetistsError && !isMissingRelationError(anaesthetistsError)) throw anaesthetistsError;
    }

    if (selections.implants.length > 0) {
      const implantPayload = selections.implants.map((name) => {
        const master = implantByName.get(name);
        return {
          package_id: packageId,
          implant_id: master?.id || null,
          implant_name: name,
        };
      });
      const { error: implantsError } = await supabase
        .from('pmjay_mjpjay_package_implants')
        .insert(implantPayload);
      if (implantsError && !isMissingRelationError(implantsError)) throw implantsError;
    }
  };

  const savePackage = async (form: PackageFormState, packageId?: string) => {
    const payload = {
      scheme: form.scheme,
      remark: form.remark.trim() || null,
      diagnosis_code: form.diagnosis_code.trim() || null,
      diagnosis: form.diagnosis.trim() || null,
      treatment_code: form.treatment_code.trim() || null,
      treatment_plan: form.treatment_plan.trim() || null,
      category: form.category || null,
      package_price: form.package_price.trim() ? Number(form.package_price) : null,
      patient_name_example: form.patient_name_example.trim() || null,
      anaesthesia_type: form.anaesthesia_type || null,
    };

    if (packageId) {
      const { error } = await supabase
        .from('pmjay_mjpjay_packages')
        .update(payload)
        .eq('id', packageId);
      if (error) throw error;
      await persistPackageLinks(packageId, form);
      return packageId;
    }

    const { data, error } = await supabase
      .from('pmjay_mjpjay_packages')
      .insert({ ...payload, is_active: true })
      .select('id')
      .single();

    if (error) throw error;

    try {
      await persistPackageLinks(data.id, form);
    } catch (linkError) {
      await supabase.from('pmjay_mjpjay_packages').delete().eq('id', data.id);
      throw linkError;
    }

    return data.id as string;
  };

  const createMutation = useMutation({
    mutationFn: async (form: PackageFormState) => savePackage(form),
    onSuccess: () => {
      toast.success('Record created successfully');
      queryClient.invalidateQueries({ queryKey: ['pmjay-mjpjay-packages'] });
      setIsCreating(false);
      setCreateForm(EMPTY_FORM);
    },
    onError: (e: any) => toast.error('Failed to create: ' + e.message),
  });

  const handleEditSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingRecord) return;

    try {
      await savePackage(editForm, editingRecord.id);
      toast.success('Record updated successfully');
      queryClient.invalidateQueries({ queryKey: ['pmjay-mjpjay-packages'] });
      setEditingRecord(null);
    } catch (e: any) {
      toast.error('Failed to update: ' + e.message);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingRecord) return;
    setIsDeleting(true);

    const { error } = await supabase
      .from('pmjay_mjpjay_packages')
      .delete()
      .eq('id', deletingRecord.id);

    if (error) {
      toast.error('Failed to delete');
    } else {
      toast.success('Record deleted');
    }

    queryClient.invalidateQueries({ queryKey: ['pmjay-mjpjay-packages'] });
    setDeletingRecord(null);
    setIsDeleting(false);
  };

  const handleToggleActive = async (record: EnrichedPackage) => {
    const { error } = await supabase
      .from('pmjay_mjpjay_packages')
      .update({ is_active: !record.is_active } as any)
      .eq('id', record.id);

    if (error) {
      toast.error('Failed to update status');
      return;
    }

    toast.success(`Record ${!record.is_active ? 'activated' : 'deactivated'}`);
    queryClient.invalidateQueries({ queryKey: ['pmjay-mjpjay-packages'] });
  };

  const saveInlinePrice = async (packageId: string) => {
    const price = priceInput.trim() === '' ? null : Number(priceInput);
    const { error } = await supabase
      .from('pmjay_mjpjay_packages')
      .update({ package_price: price } as any)
      .eq('id', packageId);

    if (error) {
      toast.error('Failed to save price');
    } else {
      toast.success('Price saved');
      queryClient.invalidateQueries({ queryKey: ['pmjay-mjpjay-packages'] });
    }

    setEditingPriceId(null);
    setPriceInput('');
  };

  const handleExport = async () => {
    const { data, error } = await supabase
      .from('pmjay_mjpjay_packages')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      toast.error('Export failed');
      return;
    }

    const packageIds = (data || []).map((row) => row.id);
    const [surgeonLinks, anaesthetistLinks, implantLinks] = await Promise.all([
      safeSelectRows<PackageSurgeonRow>(
        supabase
          .from('pmjay_mjpjay_package_surgeons')
          .select('package_id, surgeon_name, surgeon_department, created_at')
          .in('package_id', packageIds)
          .order('created_at', { ascending: true }),
        'pmjay_mjpjay_package_surgeons',
      ),
      safeSelectRows<PackageAnaesthetistRow>(
        supabase
          .from('pmjay_mjpjay_package_anaesthetists')
          .select('package_id, anaesthetist_name, created_at')
          .in('package_id', packageIds)
          .order('created_at', { ascending: true }),
        'pmjay_mjpjay_package_anaesthetists',
      ),
      safeSelectRows<PackageImplantRow>(
        supabase
          .from('pmjay_mjpjay_package_implants')
          .select('package_id, implant_name, created_at')
          .in('package_id', packageIds)
          .order('created_at', { ascending: true }),
        'pmjay_mjpjay_package_implants',
      ),
    ]);

    const packageToSurgeons = new Map<string, PackageSurgeonRow[]>();
    surgeonLinks.forEach((row) => {
      const existing = packageToSurgeons.get(row.package_id) || [];
      existing.push(row);
      packageToSurgeons.set(row.package_id, existing);
    });

    const packageToAnaesthetists = new Map<string, PackageAnaesthetistRow[]>();
    anaesthetistLinks.forEach((row) => {
      const existing = packageToAnaesthetists.get(row.package_id) || [];
      existing.push(row);
      packageToAnaesthetists.set(row.package_id, existing);
    });

    const packageToImplants = new Map<string, PackageImplantRow[]>();
    implantLinks.forEach((row) => {
      const existing = packageToImplants.get(row.package_id) || [];
      existing.push(row);
      packageToImplants.set(row.package_id, existing);
    });

    const exportRows = (data || []).map((row: any, index: number) => {
      const surgeonsForPackage = packageToSurgeons.get(row.id) || [];
      const anaesthetistsForPackage = packageToAnaesthetists.get(row.id) || [];
      const implantsForPackage = packageToImplants.get(row.id) || [];
      const surgeonNames = [...new Set(surgeonsForPackage.map((item) => item.surgeon_name).filter(Boolean))];
      const surgeonDepartments = [
        ...new Set(surgeonsForPackage.map((item) => item.surgeon_department).filter(Boolean) as string[]),
      ];
      const anaesthetistNames = [
        ...new Set(anaesthetistsForPackage.map((item) => item.anaesthetist_name).filter(Boolean)),
      ];
      const implantNames = [...new Set(implantsForPackage.map((item) => item.implant_name).filter(Boolean))];

      return {
        'Sr No': index + 1,
        Scheme: row.scheme || '',
        'Yojna Package Name': row.treatment_plan || '',
        'Treatment Code': row.treatment_code || '',
        'Diag. Code': row.diagnosis_code || '',
        Diagnosis: row.diagnosis || '',
        Category: row.category || '',
        'Surgeon Name': surgeonNames.join(', '),
        'Department Name': surgeonDepartments.join(', '),
        Anaesthetists: anaesthetistNames.join(', '),
        'Type of Anaesthesia': row.anaesthesia_type || '',
        Implant: implantNames.join(', '),
        'Package Price': row.package_price || '',
        Remark: row.remark || '',
        'Patient Example': row.patient_name_example || '',
        Created: row.created_at || '',
      };
    });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(exportRows), 'PMJAY-MJPJAY');
    XLSX.writeFile(workbook, `pmjay_mjpjay_master_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success(`Exported ${exportRows.length} records`);
  };

  const importRowToForm = (row: Record<string, any>): PackageFormState => ({
    scheme: asText(row.Scheme || row.scheme || 'PMJAY'),
    remark: asText(row.Remark || row.remark || ''),
    diagnosis_code: asText(row['Diag. Code'] || row['Diagnosis Code'] || row.diagnosis_code || ''),
    diagnosis: asText(row.Diagnosis || row.diagnosis || ''),
    treatment_code: asText(row['Treatment Code'] || row.treatment_code || ''),
    treatment_plan: pickText(row['Yojna Package Name'], row['Treatment Plan'], row.treatment_plan),
    category: asText(row.Category || row.category || ''),
    package_price: asText(row['Package Price'] || row.package_price || ''),
    patient_name_example: asText(row['Patient Example'] || row.patient_name_example || ''),
    anaesthesia_type: asText(row['Type of Anaesthesia'] || row.anaesthesia_type || ''),
    surgeon_names: splitDelimitedList(row['Surgeon Name'] || row.surgeon_names || ''),
    anaesthetist_names: splitDelimitedList(row.Anaesthetists || row.anaesthetists || ''),
    implant_names: splitDelimitedList(row.Implant || row.implant_names || ''),
  });

  const validateImportSelections = (form: PackageFormState) => {
    const missingSurgeons = form.surgeon_names.filter((name) => !surgeonByName.has(name));
    const missingAnaesthetists = form.anaesthetist_names.filter((name) => !anaesthetistByName.has(name));
    const missingImplants = form.implant_names.filter((name) => !implantByName.has(name));

    const messages: string[] = [];
    if (missingSurgeons.length) messages.push(`surgeons: ${missingSurgeons.join(', ')}`);
    if (missingAnaesthetists.length) messages.push(`anaesthetists: ${missingAnaesthetists.join(', ')}`);
    if (missingImplants.length) messages.push(`implants: ${missingImplants.join(', ')}`);

    if (messages.length > 0) {
      throw new Error(`Missing master data for ${messages.join(' | ')}`);
    }
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as Record<string, any>[];

        if (jsonData.length === 0) {
          toast.error('Import failed: no rows found');
          return;
        }

        let imported = 0;
        let skipped = 0;
        const errors: string[] = [];

        for (let index = 0; index < jsonData.length; index += 1) {
          const row = jsonData[index];
          const form = importRowToForm(row);
          if (!pickText(form.treatment_plan, form.treatment_code)) {
            skipped += 1;
            errors.push(`Row ${index + 2}: missing package name or treatment code`);
            continue;
          }

          try {
            validateImportSelections(form);
            await savePackage(form);
            imported += 1;
          } catch (err: any) {
            skipped += 1;
            errors.push(`Row ${index + 2}: ${err.message}`);
          }
        }

        queryClient.invalidateQueries({ queryKey: ['pmjay-mjpjay-packages'] });
        if (imported > 0) {
          toast.success(`Imported ${imported} records${skipped > 0 ? `, skipped ${skipped}` : ''}`);
        } else {
          toast.error(`Import failed${skipped > 0 ? `, skipped ${skipped}` : ''}`);
        }

        if (errors.length > 0) {
          console.error('PMJAY import issues:', errors);
        }
      } catch (err: any) {
        toast.error('Import failed: ' + err.message);
      }
    };

    reader.readAsArrayBuffer(file);
    event.target.value = '';
  };

  const openCreateModal = () => {
    setCreateForm(EMPTY_FORM);
    setIsCreating(true);
  };

  const openEditModal = (record: EnrichedPackage) => {
    setEditingRecord(record);
    setEditForm({
      scheme: record.scheme || 'PMJAY',
      remark: record.remark || '',
      diagnosis_code: record.diagnosis_code || '',
      diagnosis: record.diagnosis || '',
      treatment_code: record.treatment_code || '',
      treatment_plan: record.treatment_plan || '',
      category: record.category || '',
      package_price: record.package_price != null ? String(record.package_price) : '',
      patient_name_example: record.patient_name_example || '',
      anaesthesia_type: record.anaesthesia_type || '',
      surgeon_names: record.surgeon_names || [],
      anaesthetist_names: record.anaesthetist_names || [],
      implant_names: record.implant_names || [],
    });
  };

  const formatPrice = (value: number | null | undefined) =>
    value != null ? `Rs ${Number(value).toLocaleString('en-IN')}` : '-';

  const totalPages = Math.max(1, Math.ceil(totalCount / itemsPerPage));
  const startItem = totalCount === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalCount);

  const schemeOptions = ['PMJAY', 'MJPJAY'];
  const categoryOptions = ['CONSERVATIVE', 'SURGICAL'];

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold text-gray-900">
            <Shield className="h-8 w-8 text-blue-600" />
            PMJAY / MJPJAY YOJNA - PACKAGE MASTER
          </h1>
          <p className="mt-2 text-gray-600">
            Manage package name, surgeons, anaesthetists, anaesthesia type, implant, and package pricing.
          </p>
        </div>
        {canEditMasters && (
          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Add Record
          </button>
        )}
      </div>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <Label htmlFor="search">Search Packages</Label>
          <Input
            id="search"
            placeholder="Search by package name, code, diagnosis, category, or anaesthesia type..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="mt-1"
          />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-4">
            <span>PMJAY / MJPJAY Packages</span>
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-sm font-normal text-gray-500">
                {isLoading
                  ? 'Loading...'
                  : totalCount > 0
                    ? `Showing ${startItem}-${endItem} of ${totalCount} records`
                    : 'No records found'}
              </span>
              <div className="flex items-center gap-2">
                <Label className="text-sm font-normal text-gray-500">Show:</Label>
                <Select value={String(itemsPerPage)} onValueChange={(value) => setItemsPerPage(Number(value))}>
                  <SelectTrigger className="h-8 w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[5, 10, 20, 50, 100].map((count) => (
                      <SelectItem key={count} value={String(count)}>
                        {count}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-sm font-normal">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => {
                    setShowInactive(e.target.checked);
                    setCurrentPage(1);
                  }}
                  className="rounded border-gray-300"
                />
                Show Inactive
              </label>
              {canEditMasters && (
                <>
                  <Button variant="outline" size="sm" onClick={handleExport}>
                    <Download className="mr-2 h-4 w-4" />
                    Export
                  </Button>
                  <label className="cursor-pointer">
                    <Button variant="outline" size="sm" asChild>
                      <span>
                        <Upload className="mr-2 h-4 w-4" />
                        Import
                      </span>
                    </Button>
                    <input type="file" accept=".xlsx,.xls" onChange={handleImport} className="hidden" />
                  </label>
                </>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
              <span className="ml-3 text-gray-600">Loading records...</span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-8 text-red-600">
              <AlertCircle className="mr-2 h-5 w-5" />
              Error loading records.
            </div>
          ) : packageRows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="p-3 text-left font-semibold text-gray-700">Yojna Package Name</th>
                    <th className="p-3 text-left font-semibold text-gray-700">Treatment Code</th>
                    <th className="p-3 text-left font-semibold text-gray-700">Diag. Code</th>
                    <th className="p-3 text-left font-semibold text-gray-700">Diagnosis</th>
                    <th className="p-3 text-left font-semibold text-gray-700">Scheme</th>
                    <th className="p-3 text-left font-semibold text-gray-700">Category</th>
                    <th className="p-3 text-left font-semibold text-gray-700">Surgeon Name</th>
                    <th className="p-3 text-left font-semibold text-gray-700">Department Name</th>
                    <th className="p-3 text-left font-semibold text-gray-700">Anaesthetists</th>
                    <th className="p-3 text-left font-semibold text-gray-700">Type of Anaesthesia</th>
                    <th className="p-3 text-left font-semibold text-gray-700">Implant</th>
                    <th className="p-3 text-left font-semibold text-gray-700">Package Price</th>
                    <th className="p-3 text-left font-semibold text-gray-700">Remark</th>
                    <th className="p-3 text-left font-semibold text-gray-700">Created</th>
                    <th className="p-3 text-left font-semibold text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {packageRows.map((record) => (
                    <tr
                      key={record.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setViewingRecord(record)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setViewingRecord(record);
                        }
                      }}
                      className={`cursor-pointer border-b hover:bg-gray-50 ${!record.is_active ? 'bg-gray-100 opacity-60' : ''}`}
                    >
                      <td className="max-w-[220px] truncate p-3 font-medium text-gray-900" title={record.treatment_plan || ''}>
                        {record.treatment_plan || '-'}
                        {!record.is_active && <span className="ml-2 text-xs text-red-500">(Inactive)</span>}
                      </td>
                      <td className="p-3 font-mono text-gray-600">{record.treatment_code || '-'}</td>
                      <td className="p-3 font-mono text-gray-600">{record.diagnosis_code || '-'}</td>
                      <td className="max-w-[220px] truncate p-3 text-gray-600" title={record.diagnosis || ''}>
                        {record.diagnosis || '-'}
                      </td>
                      <td className="p-3">
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-semibold ${
                            record.scheme === 'PMJAY'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-yellow-100 text-yellow-700'
                          }`}
                        >
                          {record.scheme}
                        </span>
                      </td>
                      <td className="p-3 text-sm text-gray-600">{record.category || '-'}</td>
                      <td className="max-w-[220px] truncate p-3 text-sm text-gray-600" title={joinList(record.surgeon_names)}>
                        {joinList(record.surgeon_names)}
                      </td>
                      <td className="max-w-[220px] truncate p-3 text-sm text-gray-600" title={joinList(record.surgeon_departments)}>
                        {joinList(record.surgeon_departments)}
                      </td>
                      <td className="max-w-[220px] truncate p-3 text-sm text-gray-600" title={joinList(record.anaesthetist_names)}>
                        {joinList(record.anaesthetist_names)}
                      </td>
                      <td className="p-3 text-sm text-gray-600">
                        {ANAESTHESIA_OPTIONS.find((option) => option.value === record.anaesthesia_type)?.selectedLabel ||
                          record.anaesthesia_type ||
                          '-'}
                      </td>
                      <td className="max-w-[220px] truncate p-3 text-sm text-gray-600" title={joinList(record.implant_names)}>
                        {joinList(record.implant_names)}
                      </td>
                      <td className="p-3">
                        {editingPriceId === record.id ? (
                          <input
                            autoFocus
                            type="number"
                            value={priceInput}
                            onClick={(event) => event.stopPropagation()}
                            onMouseDown={(event) => event.stopPropagation()}
                            onChange={(e) => setPriceInput(e.target.value)}
                            onBlur={() => saveInlinePrice(record.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveInlinePrice(record.id);
                              if (e.key === 'Escape') {
                                setEditingPriceId(null);
                                setPriceInput('');
                              }
                            }}
                            className="w-28 rounded border border-blue-400 px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                            placeholder="Enter price"
                          />
                        ) : (
                          <span
                            className={`cursor-pointer font-semibold ${
                              record.package_price != null ? 'text-green-700' : 'text-sm italic text-gray-400'
                            }`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setEditingPriceId(record.id);
                              setPriceInput(record.package_price?.toString() || '');
                            }}
                            title="Click to enter price"
                          >
                            {formatPrice(record.package_price)}
                          </span>
                        )}
                      </td>
                      <td className="max-w-[200px] truncate p-3 text-sm text-gray-600" title={record.remark || ''}>
                        {record.remark || '-'}
                      </td>
                      <td className="p-3 text-sm text-gray-600">
                        {record.created_at ? new Date(record.created_at).toLocaleDateString() : '-'}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setViewingRecord(record)}
                            className="p-1 text-blue-600 hover:text-blue-800"
                            title="View"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          {canEditMasters && (
                            <button
                              onClick={() => openEditModal(record)}
                              className="p-1 text-green-600 hover:text-green-800"
                              title="Edit"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                          )}
                          {canEditMasters && (
                            <button
                              onClick={() => handleToggleActive(record)}
                              className="p-1 text-orange-600 hover:text-orange-800"
                              title={record.is_active ? 'Deactivate' : 'Activate'}
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                          )}
                          {canEditMasters && (
                            <button
                              onClick={() => setDeletingRecord(record)}
                              className="p-1 text-red-600 hover:text-red-800"
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-gray-500">
              <Shield className="mb-4 h-12 w-12 text-gray-300" />
              <p className="mb-2 text-lg font-medium">No records found</p>
              <p className="text-sm">{searchTerm ? 'No records match your search' : 'Add your first PMJAY/MJPJAY package'}</p>
            </div>
          )}

          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-between border-t pt-4">
              <div className="text-sm text-gray-500">
                Showing {startItem}-{endItem} of {totalCount} results
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setCurrentPage(currentPage - 1)} disabled={currentPage === 1}>
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, index) => {
                  const page =
                    totalPages <= 5
                      ? index + 1
                      : currentPage <= 3
                        ? index + 1
                        : currentPage >= totalPages - 2
                          ? totalPages - 4 + index
                          : currentPage - 2 + index;

                  return (
                    <Button
                      key={page}
                      variant={page === currentPage ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setCurrentPage(page)}
                      className="h-8 w-8 p-0"
                    >
                      {page}
                    </Button>
                  );
                })}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(currentPage + 1)}
                  disabled={currentPage === totalPages}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {isCreating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="mx-4 max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-lg bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold">Add PMJAY / MJPJAY Record</h2>
              <button onClick={() => setIsCreating(false)}>
                <X className="h-6 w-6 text-gray-500" />
              </button>
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                createMutation.mutate(createForm);
              }}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label className="mb-2 block text-sm font-medium text-gray-700">Scheme *</Label>
                  <Select value={createForm.scheme} onValueChange={(value) => setCreateForm((prev) => ({ ...prev, scheme: value }))}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {schemeOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="mb-2 block text-sm font-medium text-gray-700">Category</Label>
                  <Select value={createForm.category} onValueChange={(value) => setCreateForm((prev) => ({ ...prev, category: value }))}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {categoryOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="mb-2 block text-sm font-medium text-gray-700">Diagnosis Code</Label>
                  <Input
                    value={createForm.diagnosis_code}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, diagnosis_code: e.target.value }))}
                    placeholder="e.g. NA07.7"
                  />
                </div>

                <div>
                  <Label className="mb-2 block text-sm font-medium text-gray-700">Treatment Code</Label>
                  <Input
                    value={createForm.treatment_code}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, treatment_code: e.target.value }))}
                    placeholder="e.g. SN063B"
                  />
                </div>

                <div className="md:col-span-2">
                  <Label className="mb-2 block text-sm font-medium text-gray-700">Yojna Package Name</Label>
                  <Input
                    value={createForm.treatment_plan}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, treatment_plan: e.target.value }))}
                    placeholder="Package name"
                  />
                </div>

                <div className="md:col-span-2">
                  <Label className="mb-2 block text-sm font-medium text-gray-700">Diagnosis</Label>
                  <Input
                    value={createForm.diagnosis}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, diagnosis: e.target.value }))}
                    placeholder="Diagnosis description"
                  />
                </div>

                <div>
                  <Label className="mb-2 block text-sm font-medium text-gray-700">Package Price</Label>
                  <Input
                    type="number"
                    value={createForm.package_price}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, package_price: e.target.value }))}
                    placeholder="e.g. 15000"
                  />
                </div>

                <div>
                  <Label className="mb-2 block text-sm font-medium text-gray-700">Anaesthesia Type</Label>
                  <SearchableSelect
                    options={ANAESTHESIA_OPTIONS}
                    value={createForm.anaesthesia_type}
                    onValueChange={(value) => setCreateForm((prev) => ({ ...prev, anaesthesia_type: value }))}
                    placeholder="Select anaesthesia type"
                    searchPlaceholder="Search anaesthesia type..."
                  />
                </div>

                <div className="md:col-span-2">
                  <MultiSelectDropdown
                    label="Surgeon Name"
                    placeholder="Search and add surgeon"
                    options={surgeonOptions}
                    selectedItems={createForm.surgeon_names}
                    onItemSelect={(item) =>
                      setCreateForm((prev) =>
                        prev.surgeon_names.includes(item)
                          ? prev
                          : { ...prev, surgeon_names: [...prev.surgeon_names, item] },
                      )
                    }
                    onItemRemove={(item) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        surgeon_names: prev.surgeon_names.filter((selected) => selected !== item),
                      }))
                    }
                  />
                </div>

                <div className="md:col-span-2">
                  <MultiSelectDropdown
                    label="Anaesthetists"
                    placeholder="Search and add anaesthetist"
                    options={anaesthetistOptions}
                    selectedItems={createForm.anaesthetist_names}
                    onItemSelect={(item) =>
                      setCreateForm((prev) =>
                        prev.anaesthetist_names.includes(item)
                          ? prev
                          : { ...prev, anaesthetist_names: [...prev.anaesthetist_names, item] },
                      )
                    }
                    onItemRemove={(item) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        anaesthetist_names: prev.anaesthetist_names.filter((selected) => selected !== item),
                      }))
                    }
                  />
                </div>

                <div className="md:col-span-2">
                  <MultiSelectDropdown
                    label="Implant"
                    placeholder="Search and add implant"
                    options={implantOptions}
                    selectedItems={createForm.implant_names}
                    onItemSelect={(item) =>
                      setCreateForm((prev) =>
                        prev.implant_names.includes(item)
                          ? prev
                          : { ...prev, implant_names: [...prev.implant_names, item] },
                      )
                    }
                    onItemRemove={(item) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        implant_names: prev.implant_names.filter((selected) => selected !== item),
                      }))
                    }
                  />
                </div>

                <div>
                  <Label className="mb-2 block text-sm font-medium text-gray-700">Remark</Label>
                  <Input
                    value={createForm.remark}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, remark: e.target.value }))}
                    placeholder="Optional remark"
                  />
                </div>

                <div>
                  <Label className="mb-2 block text-sm font-medium text-gray-700">Patient Example</Label>
                  <Input
                    value={createForm.patient_name_example}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, patient_name_example: e.target.value }))}
                    placeholder="Example patient name"
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {createMutation.isPending ? 'Saving...' : 'Add Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <Sheet open={!!viewingRecord} onOpenChange={(open) => !open && setViewingRecord(null)}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          {viewingRecord && (
            <div className="space-y-6 pt-2">
              <SheetHeader className="space-y-2 pr-8 text-left">
                <SheetTitle className="text-2xl font-bold">
                  {viewingRecord.treatment_plan || viewingRecord.treatment_code || 'Package Details'}
                </SheetTitle>
                <SheetDescription className="text-sm text-muted-foreground">
                  Full record details and hidden metadata for this package.
                </SheetDescription>
              </SheetHeader>

              <div className="flex flex-wrap gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${viewingRecord.scheme === 'PMJAY' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-800'}`}>
                  {viewingRecord.scheme}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                  {selectedDepartment}
                </span>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${viewingRecord.is_active ? 'bg-blue-100 text-blue-700' : 'bg-rose-100 text-rose-700'}`}>
                  {viewingRecord.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {[
                  ['Scheme', viewingRecord.scheme],
                  ['Yojna Package Name', viewingRecord.treatment_plan],
                  ['Treatment Code', viewingRecord.treatment_code],
                  ['Diag. Code', viewingRecord.diagnosis_code],
                  ['Diagnosis', viewingRecord.diagnosis],
                  ['Category', viewingRecord.category],
                  ['Package Price', formatPrice(viewingRecord.package_price)],
                  ['Anaesthesia Type', viewingRecord.anaesthesia_type],
                  ['Remark', viewingRecord.remark],
                  ['Patient Example', viewingRecord.patient_name_example],
                  ['Created', viewingRecord.created_at ? new Date(viewingRecord.created_at).toLocaleString() : '-'],
                ].map(([label, value]) => (
                  <div key={label} className={label === 'Yojna Package Name' || label === 'Diagnosis' ? 'md:col-span-2' : ''}>
                    <Label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</Label>
                    <p className="mt-1 break-words text-sm text-slate-900">{value || '-'}</p>
                  </div>
                ))}

                <div className="md:col-span-2">
                  <Label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Surgeon Name</Label>
                  <p className="mt-1 break-words text-sm text-slate-900">{joinList(viewingRecord.surgeon_names)}</p>
                </div>

                <div className="md:col-span-2">
                  <Label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Department Name</Label>
                  <p className="mt-1 break-words text-sm text-slate-900">{joinList(viewingRecord.surgeon_departments)}</p>
                </div>

                <div className="md:col-span-2">
                  <Label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Anaesthetists</Label>
                  <p className="mt-1 break-words text-sm text-slate-900">{joinList(viewingRecord.anaesthetist_names)}</p>
                </div>

                <div className="md:col-span-2">
                  <Label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Implant</Label>
                  <p className="mt-1 break-words text-sm text-slate-900">{joinList(viewingRecord.implant_names)}</p>
                </div>
              </div>

              <div className="rounded-lg border bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Department Notes</div>
                <p className="mt-2 text-sm text-slate-700">
                  This package is grouped under <span className="font-semibold text-slate-900">{selectedDepartment}</span> based on the procedure code and package name. The table keeps the name truncated; the sidebar shows the full record.
                </p>
              </div>

              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setViewingRecord(null)}>Close</Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {editingRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="mx-4 max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-lg bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold">Edit Record</h2>
              <button onClick={() => setEditingRecord(null)}>
                <X className="h-6 w-6 text-gray-500" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label className="mb-2 block text-sm font-medium text-gray-700">Scheme *</Label>
                  <Select value={editForm.scheme} onValueChange={(value) => setEditForm((prev) => ({ ...prev, scheme: value }))}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {schemeOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="mb-2 block text-sm font-medium text-gray-700">Category</Label>
                  <Select value={editForm.category} onValueChange={(value) => setEditForm((prev) => ({ ...prev, category: value }))}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {categoryOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="mb-2 block text-sm font-medium text-gray-700">Diagnosis Code</Label>
                  <Input
                    value={editForm.diagnosis_code}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, diagnosis_code: e.target.value }))}
                  />
                </div>

                <div>
                  <Label className="mb-2 block text-sm font-medium text-gray-700">Treatment Code</Label>
                  <Input
                    value={editForm.treatment_code}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, treatment_code: e.target.value }))}
                  />
                </div>

                <div className="md:col-span-2">
                  <Label className="mb-2 block text-sm font-medium text-gray-700">Yojna Package Name</Label>
                  <Input
                    value={editForm.treatment_plan}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, treatment_plan: e.target.value }))}
                  />
                </div>

                <div className="md:col-span-2">
                  <Label className="mb-2 block text-sm font-medium text-gray-700">Diagnosis</Label>
                  <Input
                    value={editForm.diagnosis}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, diagnosis: e.target.value }))}
                  />
                </div>

                <div>
                  <Label className="mb-2 block text-sm font-medium text-gray-700">Package Price</Label>
                  <Input
                    type="number"
                    value={editForm.package_price}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, package_price: e.target.value }))}
                  />
                </div>

                <div>
                  <Label className="mb-2 block text-sm font-medium text-gray-700">Anaesthesia Type</Label>
                  <SearchableSelect
                    options={ANAESTHESIA_OPTIONS}
                    value={editForm.anaesthesia_type}
                    onValueChange={(value) => setEditForm((prev) => ({ ...prev, anaesthesia_type: value }))}
                    placeholder="Select anaesthesia type"
                    searchPlaceholder="Search anaesthesia type..."
                  />
                </div>

                <div className="md:col-span-2">
                  <MultiSelectDropdown
                    label="Surgeon Name"
                    placeholder="Search and add surgeon"
                    options={surgeonOptions}
                    selectedItems={editForm.surgeon_names}
                    onItemSelect={(item) =>
                      setEditForm((prev) =>
                        prev.surgeon_names.includes(item)
                          ? prev
                          : { ...prev, surgeon_names: [...prev.surgeon_names, item] },
                      )
                    }
                    onItemRemove={(item) =>
                      setEditForm((prev) => ({
                        ...prev,
                        surgeon_names: prev.surgeon_names.filter((selected) => selected !== item),
                      }))
                    }
                  />
                </div>

                <div className="md:col-span-2">
                  <MultiSelectDropdown
                    label="Anaesthetists"
                    placeholder="Search and add anaesthetist"
                    options={anaesthetistOptions}
                    selectedItems={editForm.anaesthetist_names}
                    onItemSelect={(item) =>
                      setEditForm((prev) =>
                        prev.anaesthetist_names.includes(item)
                          ? prev
                          : { ...prev, anaesthetist_names: [...prev.anaesthetist_names, item] },
                      )
                    }
                    onItemRemove={(item) =>
                      setEditForm((prev) => ({
                        ...prev,
                        anaesthetist_names: prev.anaesthetist_names.filter((selected) => selected !== item),
                      }))
                    }
                  />
                </div>

                <div className="md:col-span-2">
                  <MultiSelectDropdown
                    label="Implant"
                    placeholder="Search and add implant"
                    options={implantOptions}
                    selectedItems={editForm.implant_names}
                    onItemSelect={(item) =>
                      setEditForm((prev) =>
                        prev.implant_names.includes(item)
                          ? prev
                          : { ...prev, implant_names: [...prev.implant_names, item] },
                      )
                    }
                    onItemRemove={(item) =>
                      setEditForm((prev) => ({
                        ...prev,
                        implant_names: prev.implant_names.filter((selected) => selected !== item),
                      }))
                    }
                  />
                </div>

                <div>
                  <Label className="mb-2 block text-sm font-medium text-gray-700">Remark</Label>
                  <Input
                    value={editForm.remark}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, remark: e.target.value }))}
                  />
                </div>

                <div>
                  <Label className="mb-2 block text-sm font-medium text-gray-700">Patient Example</Label>
                  <Input
                    value={editForm.patient_name_example}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, patient_name_example: e.target.value }))}
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditingRecord(null)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
                >
                  Update Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deletingRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6">
            <div className="mb-4 flex items-center">
              <div className="mr-4 flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                <Trash2 className="h-6 w-6 text-red-600" />
              </div>
              <h3 className="text-lg font-medium">Delete Record</h3>
            </div>
            <p className="mb-4 text-sm text-gray-500">
              Are you sure you want to delete <strong>"{deletingRecord.treatment_plan || deletingRecord.treatment_code}"</strong>?
              This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeletingRecord(null)}
                disabled={isDeleting}
                className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PmjayMjpjayMaster;
