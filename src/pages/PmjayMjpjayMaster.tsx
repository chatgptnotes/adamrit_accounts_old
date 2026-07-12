import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { AlertCircle, ChevronLeft, ChevronRight, Download, Edit, Eye, FileText, Plus, Shield, Trash2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { usePermissions } from '@/hooks/usePermissions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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

const PACKAGE_CATEGORY_OPTIONS: SearchableSelectOption[] = [
  'Burns Management',
  'Cardio-thoracic & Vascular surgery',
  'Cardiology',
  'Emergency Room Packages (Care requiring less than 12 hrs stay)',
  'General Medicine',
  'General Surgery',
  'High end Diagnostics',
  'High end Medicine',
  'High end procedures',
  'Interventional Neuroradiology',
  'Mental Disorders Packages',
  'Neo-natal care Packages',
  'Neuro Surgery',
  'Obstetrics & Gynaecology',
  'Ophthalmology',
  'Orthopaedics',
  'Otorhinolaryngology',
  'Paediatric Medical management',
  'Paediatric Surgery',
  'Plastic & reconstructive Surgery',
  'Polytrauma',
  'Surgical Oncology',
  'Urology',
  'CONSERVATIVE',
  'SURGICAL',
].map((label) => ({ value: label, label }));

const joinList = (items: string[]) => (items.length > 0 ? items.join(', ') : '-');

const asText = (value: unknown) => (value == null ? '' : String(value));

const trimOrEmpty = (value: unknown) => asText(value).trim();

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

  if (/\bburn\b|\bburns\b|\bskin graft\b/.test(haystack)) return 'Burns Management';
  if (/vascular|cardio.?thoracic|cabg|coronary bypass|aortic|aneurysm/.test(haystack)) return 'Cardio-thoracic & Vascular surgery';
  if (/urology|uro|renal tumor|pcnl|ureter|ureteric|cysto|prostate|bladder|kidney|stenting including cystoscopy|dj stent|dj stenting/.test(haystack)) return 'Urology';
  if (/cardio|angioplasty|ptca|pacemaker|coronary|stent|stenting|angiogram/.test(haystack)) return 'Cardiology';
  if (/emergency room|er package|care requiring less than 12 hrs stay|short stay emergency/.test(haystack)) return 'Emergency Room Packages (Care requiring less than 12 hrs stay)';
  if (/dialysis|haemodialysis|hemodialysis|renal/.test(haystack)) return 'General Medicine';
  if (/medicine|dehydration|sepsis|ketoacidosis|stroke|hyponatremia|thrombocytopenia/.test(haystack)) return 'General Medicine';
  if (/laparotomy|hernia|append|gastro|lap\./.test(haystack)) return 'General Surgery';
  if (/diagnostic|ct scan|mri|pet scan|endoscopy|colonoscopy|echocardiogram/.test(haystack)) return 'High end Diagnostics';
  if (/oncology|tumou?r|cancer|chemotherapy|cyclophosphamide/.test(haystack)) return 'Surgical Oncology';
  if (/interventional neuroradiology|angiography|embolization|thrombectomy/.test(haystack)) return 'Interventional Neuroradiology';
  if (/psychiatr|mental|depression|schizoph|bipolar|anxiety/.test(haystack)) return 'Mental Disorders Packages';
  if (/neonatal|neo-natal|nicu|preterm|premature/.test(haystack)) return 'Neo-natal care Packages';
  if (/neuro|brain|crani|cerebral|stroke|head injury|spine|laminectomy|discectomy/.test(haystack)) return 'Neuro Surgery';
  if (/hysterectomy|gyne|obstet|obg|pelvic|salpingo|omentectomy/.test(haystack)) return 'Obstetrics & Gynaecology';
  if (/ophthal|eye|cataract|retina|glaucoma/.test(haystack)) return 'Ophthalmology';
  if (/ortho|fracture|plate|nailing|fixation|arthros|tendon|bone|pelviacetabular|elbow|forearm/.test(haystack)) return 'Orthopaedics';
  if (/ent|ear|nose|throat|mastoid|otitis|tonsil|sinus|laryng/.test(haystack)) return 'Otorhinolaryngology';
  if (/paediatric medical|pediatric medical|child medicine|neonatal medicine/.test(haystack)) return 'Paediatric Medical management';
  if (/paediatric surgery|pediatric surgery|child surgery/.test(haystack)) return 'Paediatric Surgery';
  if (/plastic|reconstructive|flap|cleft|burn scar/.test(haystack)) return 'Plastic & reconstructive Surgery';
  if (/polytrauma|multiple trauma|trauma/.test(haystack)) return 'Polytrauma';
  return record.category || 'Unclassified';
};

const LEGACY_CATEGORY_VALUES = new Set(['CONSERVATIVE', 'SURGICAL']);

const getDisplayCategory = (record: EnrichedPackage): string => {
  const stored = record.category?.trim() || '';
  if (stored && !LEGACY_CATEGORY_VALUES.has(stored.toUpperCase())) {
    return stored;
  }
  return inferDepartment(record);
};

const getStoredOrDisplayCategory = (record: EnrichedPackage): string => {
  const stored = record.category?.trim() || '';
  return stored && !LEGACY_CATEGORY_VALUES.has(stored.toUpperCase()) ? stored : inferDepartment(record);
};

const CATEGORY_SORT_ORDER = PACKAGE_CATEGORY_OPTIONS.map((option) => option.label);

const getCategoryGroup = (record: EnrichedPackage): string => getDisplayCategory(record) || 'Unclassified';

type PackageNoteSource = {
  treatment_plan?: string | null;
  category?: string | null;
  treatment_code?: string | null;
};

const buildOtNoteTheme = (source: PackageNoteSource) => {
  const haystack = [
    source.treatment_plan,
    source.category,
    source.treatment_code,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/(laparoscopic|laparoscopy|robotic)/.test(haystack) || /cystectomy/.test(haystack)) {
    const procedure = /cystectomy/.test(haystack)
      ? 'cystic lesion'
      : /hysterectomy/.test(haystack)
        ? 'pelvic organs'
        : /cholecystectomy/.test(haystack)
          ? 'gallbladder'
          : /append/.test(haystack)
            ? 'appendix'
            : /hernia/.test(haystack)
              ? 'hernia sac and defect'
              : 'target lesion';

    return {
      access: 'The patient was positioned appropriately for laparoscopy, the abdomen was painted and draped in a sterile fashion, pneumoperitoneum was created, and the initial port was introduced under direct vision. Additional working ports were placed under vision as required.',
      dissection: `The ${procedure} was identified and carefully dissected from the surrounding tissues using sharp and blunt dissection, with meticulous attention to adjacent bowel, bladder, ureteric, vascular, or other critical structures as applicable.`,
      confirmation: /cholecystectomy/.test(haystack)
        ? 'Critical view of safety was obtained, the cystic duct and artery were secured, and the intended anatomical endpoint was achieved without visible leak or bleeding.'
        : /append/.test(haystack)
          ? 'The appendiceal base was secured and the specimen was delivered intact, with no residual stump bleeding or contamination seen at completion.'
          : /hernia/.test(haystack)
            ? 'The defect was closed or reinforced as planned, the reduced contents were viable, and no active bleeding or bowel compromise was seen.'
            : /hysterectomy/.test(haystack)
              ? 'The intended pelvic dissection was completed, the target tissue was removed, and the operative field showed satisfactory haemostasis with preserved adjacent structures.'
              : 'The intended lesion was completely excised or treated, the operative bed was dry, and no unintended injury or residual target tissue was seen at completion.',
      closure: 'The specimen was retrieved in a bag where applicable, ports were removed under vision, pneumoperitoneum was released, fascial closure was performed at larger port sites as required, skin was approximated with sutures or staples, dressings were applied, and the patient was shifted to recovery in stable condition.',
    };
  }

  if (/urology|uro|dj stent|dj stenting|stenting including cystoscopy|ureter|ureteric|pcnl|pyeloplasty|nephrectomy|cysto/.test(haystack)) {
    if (/pcnl/.test(haystack)) {
      return {
        access: 'The patient was positioned prone, the flank was prepared and draped, and access to the pelvicalyceal system was obtained under image guidance with tract creation and dilation.',
        dissection: 'The collecting system was entered in a controlled manner, the calculi were fragmented and cleared, and the calyceal and ureteric system were inspected for residual obstruction.',
        confirmation: 'Stone clearance was confirmed endoscopically and fluoroscopically, the renal system was adequately decompressed, and there was no immediate collecting-system injury.',
        closure: 'The tract was secured, haemostasis was confirmed, the access site was dressed or closed as required, and the patient was transferred to recovery in stable condition.',
      };
    }

    if (/pyeloplasty/.test(haystack)) {
      return {
        access: 'A flank or laparoscopic approach was used, the operative site was painted and draped, and the ureteropelvic junction was exposed with adequate working space.',
        dissection: 'The stenotic ureteropelvic junction was dissected, the fibrotic segment was excised when indicated, the pelvis was mobilised, and the ureter was spatulated to allow a tension-free repair.',
        confirmation: 'The anastomosis was inspected for watertight alignment, free drainage, and absence of twist or tension, with adequate patency demonstrated at completion.',
        closure: 'Meticulous haemostasis was obtained, the repair was completed in layers with absorbable sutures where appropriate, and dressings were applied before recovery transfer.',
      };
    }

    if (/nephrectomy/.test(haystack)) {
      return {
        access: 'The kidney was approached through the planned open or minimally invasive incision after the site was painted and draped, with layered entry through the skin, subcutaneous tissue, fascia, and muscular planes.',
        dissection: 'The renal unit and surrounding hilar structures were carefully dissected, the intended segment or tissue was separated from adjacent structures, and vascular control was maintained throughout.',
        confirmation: 'The resected specimen was confirmed, haemostasis at the renal bed and hilum was satisfactory, and no active bleeding or urinary leak was seen at completion.',
        closure: 'After final count verification, layered closure was completed with appropriate absorbable and skin sutures, dressing was applied, and the patient was shifted stable to recovery.',
      };
    }

    return {
      access: 'No external cutaneous incision was required for this endoscopic urology procedure; the bladder and ureteric orifice were accessed cystoscopically under direct vision after sterile preparation and draping.',
      dissection: 'The urethra, bladder, and ureteric lumen were inspected, a guidewire was advanced across the ureteric obstruction or target segment, and the double-J stent or endoscopic treatment was deployed in the planned position.',
      confirmation: 'Correct proximal and distal curl position or treatment effect was confirmed endoscopically and/or fluoroscopically, urine drainage was checked, and no perforation or active bleeding was seen.',
      closure: 'The bladder was emptied, haemostasis was confirmed, no cutaneous incision required closure, and the patient was transferred in stable condition with the prescribed follow-up plan.',
    };
  }

  if (/cardio|angioplasty|ptca|pacemaker|coronary|angiogram|stent/.test(haystack)) {
    return {
      access: 'Percutaneous vascular access was obtained under sterile precautions after painting and draping, and the target vessel was cannulated using the standard approach for the approved cardiology procedure.',
      dissection: 'Guidewire and catheter manipulation were performed across the relevant vascular or coronary segment, with lesion treatment, dilation, or device deployment according to the operative plan.',
      confirmation: 'Final angiographic or procedural confirmation showed the intended result, with preserved flow, stable device position, and no immediate procedural complication.',
      closure: 'Access-site haemostasis was secured, the puncture site was dressed, and the patient was transferred to recovery in stable condition.',
    };
  }

  if (/neuro|brain|crani|spine|laminectomy|discectomy/.test(haystack)) {
    return {
      access: 'A standard cranial or posterior spinal incision was made as appropriate, after the operative field was painted and draped under strict aseptic precautions.',
      dissection: 'The relevant soft tissues, muscle planes, bone window, lamina, disc space, or neural elements were exposed and decompressed carefully according to the planned neurosurgical procedure.',
      confirmation: 'Adequate decompression, restoration of the intended anatomy, haemostasis, and absence of obvious neural compromise were confirmed before closure.',
      closure: 'The wound was irrigated, layered closure was completed with appropriate sutures, dressing was applied, and the patient was moved to recovery in stable condition.',
    };
  }

  if (/ortho|fracture|plate|nailing|fixation|arthros|tendon|bone|joint/.test(haystack)) {
    return {
      access: 'A skin incision was made over the affected segment after painting and draping, and the subcutaneous tissue, fascia, and muscle were dissected to expose the fracture, joint, or operative bone surface.',
      dissection: 'The fracture or joint pathology was reduced, debrided, or prepared as needed, and fixation or reconstruction was completed using the planned orthopaedic technique.',
      confirmation: 'Alignment, stability, and implant position were checked clinically and/or radiologically, with satisfactory correction and haemostasis at the end of the procedure.',
      closure: 'Layered closure was performed with absorbable sutures for deep tissue and appropriate skin sutures or staples, followed by dressing and recovery transfer.',
    };
  }

  if (/general surgery|laparotomy|append|hernia|gastro|chole|lap\./.test(haystack)) {
    return {
      access: 'A standard abdominal or operative incision was made after painting and draping, followed by careful entry through the subcutaneous tissues and fascia.',
      dissection: 'The target bowel, appendix, gallbladder, hernia sac, or other involved structures were dissected, controlled, and treated according to the operative plan.',
      confirmation: 'The operative field was inspected for completeness of treatment, haemostasis, and absence of leak, with the intended anatomical correction confirmed before closure.',
      closure: 'The wound was closed in layers with appropriate sutures, dressing was applied, and the patient was transferred to recovery in stable condition.',
    };
  }

  return {
    access: 'The operative site was painted and draped under strict aseptic precautions, and the standard incision or access route was used for the procedure.',
    dissection: 'The relevant anatomical planes and target structures were carefully dissected, protected, and treated using the accepted technique for the procedure.',
    confirmation: 'Completion of the intended operative goal, satisfactory haemostasis, and preservation of adjacent structures were confirmed before the case was closed.',
    closure: 'Layered closure was completed with appropriate sutures, dressings were applied, and the patient was shifted to recovery in stable condition.',
  };
};

const buildOtNotes = (source: PackageNoteSource) => {
  const procedureName = trimOrEmpty(source.treatment_plan) || trimOrEmpty(source.treatment_code) || 'Approved procedure';
  const theme = buildOtNoteTheme(source);

  return [
    'OT NOTES',
    `Procedure: ${procedureName}`,
    '',
    'Operative Note',
    '1. The patient was brought to the operating theatre, identity was verified, consent was checked, the site and procedure were confirmed, and anaesthesia was induced as planned.',
    `2. The patient was positioned appropriately. The operative field was painted, draped, and prepared in the usual sterile fashion. ${theme.access}`,
    `3. ${theme.dissection}`,
    `4. Operative findings: ${theme.confirmation}`,
    '5. Haemostasis was secured, any specimen or excised tissue was handled as indicated, and the operative endpoint was confirmed before closure.',
    `6. ${theme.closure}`,
  ]
    .filter(Boolean)
    .join('\n');
};

const parseOtNotes = (notes: string) => {
  const lines = notes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const procedureLine = lines.find((line) => line.toLowerCase().startsWith('procedure:')) || '';
  const procedureIndex = lines.findIndex((line) => line.toLowerCase() === 'operative note');
  const steps = lines
    .slice(procedureIndex >= 0 ? procedureIndex + 1 : 0)
    .map((line) => line.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean);

  return {
    procedureLine: procedureLine.replace(/^procedure:\s*/i, '').trim(),
    steps,
  };
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
  const itemsPerPage = parseInt(searchParams.get('perPage') || '200');

  const updateParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (!value || (key === 'page' && value === '1') || (key === 'perPage' && value === '200')) {
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
  const [viewingOtNotesRecord, setViewingOtNotesRecord] = useState<EnrichedPackage | null>(null);
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

  const groupedPackageSections = useMemo(() => {
    const categoryToRows = new Map<string, EnrichedPackage[]>();

    packageRows.forEach((record) => {
      const category = getCategoryGroup(record);
      const existing = categoryToRows.get(category) || [];
      existing.push(record);
      categoryToRows.set(category, existing);
    });

    const categoryWeight = (category: string) => {
      const weight = CATEGORY_SORT_ORDER.indexOf(category);
      return weight === -1 ? Number.MAX_SAFE_INTEGER : weight;
    };

    return [...categoryToRows.entries()]
      .map(([category, records]) => ({
        category,
        records,
      }))
      .sort((left, right) => {
        const weightDiff = categoryWeight(left.category) - categoryWeight(right.category);
        if (weightDiff !== 0) return weightDiff;
        return left.category.localeCompare(right.category);
      });
  }, [packageRows]);

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
      remark:
        trimOrEmpty(form.remark) ||
        buildOtNotes({
          treatment_plan: form.treatment_plan,
          category: form.category,
          treatment_code: form.treatment_code,
        }),
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
        'OT Notes': buildOtNotes({
          treatment_plan: row.treatment_plan,
          category: row.category,
          treatment_code: row.treatment_code,
        }),
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
    remark: asText(row['OT Notes'] || row.Remark || row.remark || ''),
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

  const getDisplayOtNotes = (record: EnrichedPackage) =>
    buildOtNotes({
      treatment_plan: record.treatment_plan,
      category: record.category,
      treatment_code: record.treatment_code,
    });

  const totalPages = Math.max(1, Math.ceil(totalCount / itemsPerPage));
  const startItem = totalCount === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalCount);

  const schemeOptions = ['PMJAY', 'MJPJAY'];
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
                    {[5, 10, 20, 50, 100, 200].map((count) => (
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
            <div className="space-y-4">
              {groupedPackageSections.map(({ category, records }) => (
                <details key={category} open className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900">{category}</div>
                      <div className="text-xs text-slate-500">{records.length} package{records.length === 1 ? '' : 's'}</div>
                    </div>
                    <div className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm">
                      {records.length}
                    </div>
                  </summary>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-b bg-slate-100">
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Yojna Package Name</th>
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Diag. Code</th>
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Diagnosis</th>
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Scheme</th>
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Surgeon Name</th>
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Department Name</th>
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Anaesthetists</th>
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Type of Anaesthesia</th>
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Implant</th>
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Treatment Code</th>
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Created</th>
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {records.map((record) => (
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
                            className={`cursor-pointer border-b last:border-b-0 hover:bg-slate-50 ${!record.is_active ? 'bg-gray-100 opacity-60' : ''}`}
                          >
                            <td className="min-w-[340px] p-3 align-top">
                              <div className="space-y-1">
                                <div className="whitespace-normal break-words text-sm font-medium leading-5 text-slate-900" title={record.treatment_plan || ''}>
                                  {record.treatment_plan || '-'}
                                </div>
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
                                    className="h-8 w-32 rounded border border-blue-400 px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    placeholder="Enter amount"
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                                      record.package_price != null
                                        ? 'bg-emerald-100 text-emerald-700'
                                        : 'bg-slate-100 text-slate-500'
                                    }`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setEditingPriceId(record.id);
                                      setPriceInput(record.package_price?.toString() || '');
                                    }}
                                    title="Click to edit package amount"
                                  >
                                    {formatPrice(record.package_price)}
                                  </button>
                                )}
                                {!record.is_active && <span className="block text-xs text-red-500">(Inactive)</span>}
                              </div>
                            </td>
                            <td className="p-3 font-mono text-slate-600">{record.diagnosis_code || '-'}</td>
                            <td className="max-w-[240px] truncate p-3 text-slate-600" title={record.diagnosis || ''}>
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
                            <td className="max-w-[220px] truncate p-3 text-sm text-slate-600" title={joinList(record.surgeon_names)}>
                              {joinList(record.surgeon_names)}
                            </td>
                            <td className="max-w-[220px] truncate p-3 text-sm text-slate-600" title={joinList(record.surgeon_departments)}>
                              {joinList(record.surgeon_departments)}
                            </td>
                            <td className="max-w-[220px] truncate p-3 text-sm text-slate-600" title={joinList(record.anaesthetist_names)}>
                              {joinList(record.anaesthetist_names)}
                            </td>
                            <td className="p-3 text-sm text-slate-600">
                              {ANAESTHESIA_OPTIONS.find((option) => option.value === record.anaesthesia_type)?.selectedLabel ||
                                record.anaesthesia_type ||
                                '-'}
                            </td>
                            <td className="max-w-[220px] truncate p-3 text-sm text-slate-600" title={joinList(record.implant_names)}>
                              {joinList(record.implant_names)}
                            </td>
                            <td className="p-3 font-mono text-sm text-slate-600">{record.treatment_code || '-'}</td>
                            <td className="p-3 text-sm text-slate-600">
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
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setViewingOtNotesRecord(record);
                                  }}
                                  className="p-1 text-slate-600 hover:text-slate-900"
                                  title="View OT Notes"
                                >
                                  <FileText className="h-4 w-4" />
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
                </details>
              ))}
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
                  <SearchableSelect
                    options={PACKAGE_CATEGORY_OPTIONS}
                    value={createForm.category}
                    onValueChange={(value) => setCreateForm((prev) => ({ ...prev, category: value }))}
                    placeholder="Select category"
                    searchPlaceholder="Search category..."
                    emptyText="No category found."
                  />
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

                <div className="md:col-span-2">
                  <Label className="mb-2 block text-sm font-medium text-gray-700">OT Notes</Label>
                  <Textarea
                    value={createForm.remark}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, remark: e.target.value }))}
                    placeholder="Leave blank to auto-generate from package data"
                    rows={4}
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
                  ['Package Price', formatPrice(viewingRecord.package_price)],
                  ['Diag. Code', viewingRecord.diagnosis_code],
                  ['Diagnosis', viewingRecord.diagnosis],
                  ['Category', getStoredOrDisplayCategory(viewingRecord)],
                  ['Anaesthesia Type', viewingRecord.anaesthesia_type],
                  ['Patient Example', viewingRecord.patient_name_example],
                  ['Treatment Code', viewingRecord.treatment_code],
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
                  This package is grouped under <span className="font-semibold text-slate-900">{selectedDepartment}</span> based on the procedure code and package name. The table keeps the full package name readable, places the amount beside it, and moves the treatment code to the end. OT notes are available from the notes action on the row.
                </p>
              </div>

              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setViewingRecord(null)}>Close</Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={!!viewingOtNotesRecord} onOpenChange={(open) => !open && setViewingOtNotesRecord(null)}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
          {viewingOtNotesRecord && (
            <div className="space-y-6 pt-2">
              <SheetHeader className="space-y-2 pr-8 text-left">
                <SheetTitle className="text-2xl font-bold">
                  OT Notes
                </SheetTitle>
                <SheetDescription className="text-sm text-muted-foreground">
                  Structured operative note for the selected procedure.
                </SheetDescription>
              </SheetHeader>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_12px_30px_-18px_rgba(15,23,42,0.18)]">
                {(() => {
                  const noteText = getDisplayOtNotes(viewingOtNotesRecord);
                  const { procedureLine, steps } = parseOtNotes(noteText);

                  return (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Operative Note
                          </div>
                          <div className="mt-1 text-lg font-semibold text-slate-950">
                            {procedureLine || viewingOtNotesRecord.treatment_plan || viewingOtNotesRecord.treatment_code || 'Procedure'}
                          </div>
                        </div>
                        <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Generated
                        </div>
                      </div>

                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Operative Steps
                        </div>
                        <ol className="mt-3 space-y-3">
                          {steps.map((step, index) => (
                            <li
                              key={`${step.slice(0, 24)}-${index}`}
                              className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3"
                            >
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
                                {index + 1}
                              </span>
                              <p className="text-sm leading-6 text-slate-700">
                                {step}
                              </p>
                            </li>
                          ))}
                        </ol>
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setViewingOtNotesRecord(null)}>Close</Button>
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
                  <SearchableSelect
                    options={PACKAGE_CATEGORY_OPTIONS}
                    value={editForm.category}
                    onValueChange={(value) => setEditForm((prev) => ({ ...prev, category: value }))}
                    placeholder="Select category"
                    searchPlaceholder="Search category..."
                    emptyText="No category found."
                  />
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

                <div className="md:col-span-2">
                  <Label className="mb-2 block text-sm font-medium text-gray-700">OT Notes</Label>
                  <Textarea
                    value={editForm.remark}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, remark: e.target.value }))}
                    rows={4}
                    placeholder="Leave blank to auto-generate from package data"
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
