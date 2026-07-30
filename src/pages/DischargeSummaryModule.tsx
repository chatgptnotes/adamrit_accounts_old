import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  FileText,
  Loader2,
  Plus,
  Printer,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { GEMINI_MODEL, describeGeminiError, geminiFetch, geminiGenerateContentUrl } from "@/lib/gemini";

type MedicationRow = {
  id: string;
  name: string;
  strength: string;
  route: string;
  dosageEn: string;
  dosageHi: string;
  days: string;
};

type FormState = {
  diagnosis: string;
  chiefComplaints: string;
  historyOfPresentIllness: string;
  examination: string;
  investigations: string;
  hospitalCourse: string;
  procedureDetails: string;
  operationNotes: string;
  conditionOnDischarge: string;
  dischargeAdvice: string;
  followUpInstructions: string;
  warningSigns: string;
  medications: MedicationRow[];
};

type VisitContext = {
  id: string;
  visitId: string;
  patientId: string;
  patientName: string;
  regId: string;
  ageSex: string;
  address: string;
  consultant: string;
  admissionDate: string;
  dischargeDate: string;
  treatmentType: string;
  hasProcedure: boolean;
};

const EMPTY_MEDICATION = (): MedicationRow => ({
  id: String(Date.now()) + Math.random().toString(36).slice(2, 8),
  name: "",
  strength: "",
  route: "Oral",
  dosageEn: "",
  dosageHi: "",
  days: "",
});

const EMERGENCY_LINE =
  "URGENT CARE/ EMERGENCY CARE IS AVAILABLE 24 X 7. PLEASE CONTACT:-7030974619, 9373111709.";

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatDate(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB");
}

function formatDateInput(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inferHindiDosage(dosageEn: string): string {
  const text = dosageEn.trim().toLowerCase();
  if (!text) return "";
  if (text.includes("once daily")) return "दिन में एक बार";
  if (text.includes("twice daily") || text.includes("bd")) return "दिन में दो बार";
  if (text.includes("thrice daily") || text.includes("tid")) return "दिन में तीन बार";
  if (text.includes("four times") || text.includes("qid")) return "दिन में चार बार";
  if (text.includes("at bedtime") || text.includes("hs")) return "रात में सोते समय";
  if (text.includes("after food")) return "खाना खाने के बाद";
  if (text.includes("before food")) return "खाना खाने से पहले";
  if (text.includes("as needed") || text.includes("sos")) return "जरूरत होने पर";
  return "";
}

function safeJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseMedicationRows(value: unknown): MedicationRow[] {
  if (!Array.isArray(value)) return [];
  return value.map((item: any, index) => ({
    id: String(item?.id ?? index + 1),
    name: asText(item?.name),
    strength: asText(item?.strength || item?.unit),
    route: asText(item?.route) || "Oral",
    dosageEn: asText(item?.dosageEn || item?.dose || item?.dosage || item?.frequency || item?.remark),
    dosageHi: asText(item?.dosageHi) || inferHindiDosage(asText(item?.dosageEn || item?.dose || item?.dosage || item?.frequency || item?.remark)),
    days: asText(item?.days || item?.duration),
  }));
}

function buildVisitCandidates(rawVisitId: string): string[] {
  const trimmed = rawVisitId.trim();
  if (!trimmed) return [];

  const candidates = new Set<string>([trimmed]);
  candidates.add(trimmed.replace(/^I+H/i, "IH"));
  candidates.add(trimmed.replace(/^I{2,}/i, "I"));

  return Array.from(candidates).filter(Boolean);
}

function normalizeVitals(raw: unknown): string {
  const obj = safeJsonObject(raw);
  if (!Object.keys(obj).length) return "";
  const lines = [
    obj.temperature ? `Temperature: ${asText(obj.temperature)}` : "",
    obj.pulse_rate ? `Pulse Rate: ${asText(obj.pulse_rate)}` : "",
    obj.respiratory_rate ? `Respiratory Rate: ${asText(obj.respiratory_rate)}` : "",
    obj.blood_pressure ? `Blood Pressure: ${asText(obj.blood_pressure)}` : "",
    obj.oxygen_saturation ? `SpO2: ${asText(obj.oxygen_saturation)}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

function serializeFormToSummaryRecord(
  form: FormState,
  generatedSummary: string | null,
  visit: VisitContext,
  existingAdditionalData: unknown,
) {
  const medications = form.medications
    .map((med) => ({
      ...med,
      dosageHi: med.dosageHi.trim() || inferHindiDosage(med.dosageEn),
    }))
    .filter((med) => med.name.trim() || med.dosageEn.trim() || med.days.trim());

  const procedures = form.procedureDetails.trim()
    ? [
        {
          details: form.procedureDetails.trim(),
        },
      ]
    : [];

  const additionalData = {
    ...safeJsonObject(existingAdditionalData),
    generated_summary: generatedSummary,
    generated_at: generatedSummary ? new Date().toISOString() : null,
    module_version: "independent-discharge-summary-v1",
  };

  return {
    patient_id: visit.patientId,
    patient_name: visit.patientName,
    visit_id: visit.visitId,
    admission_date: visit.admissionDate || new Date().toISOString(),
    date_of_discharge: visit.dischargeDate || null,
    reg_id: visit.regId || null,
    address: visit.address || null,
    age_sex: visit.ageSex || null,
    treating_consultant: visit.consultant || null,
    primary_diagnosis: form.diagnosis.trim() || null,
    chief_complaints: form.chiefComplaints.trim() || null,
    history_of_present_illness: form.historyOfPresentIllness.trim() || null,
    general_examination: form.examination.trim() || null,
    lab_investigations: { text: form.investigations.trim() },
    hospital_course: form.hospitalCourse.trim() || null,
    hospital_stay_notes: form.hospitalCourse.trim() || null,
    procedures_performed: procedures,
    operation_notes: form.operationNotes.trim() || null,
    condition_on_discharge: form.conditionOnDischarge.trim() || null,
    discharge_advice: form.dischargeAdvice.trim() || null,
    follow_up_instructions: form.followUpInstructions.trim() || null,
    warning_signs: form.warningSigns.trim() || null,
    discharge_medications: medications,
    summary_date: new Date().toISOString(),
    treatment_during_stay: visit.treatmentType || null,
    additional_data: additionalData,
  };
}

async function generateDischargeSummary(record: Record<string, unknown>) {
  const response = await geminiFetch(geminiGenerateContentUrl("", GEMINI_MODEL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: `You are a senior medical specialist writing a professional hospital discharge summary for another doctor.

Rules:
- Use ONLY the structured clinical data provided below.
- Do NOT mention patient name, sex, or age.
- Do NOT invent symptoms, findings, events, surgeries, clinician names, complications, brands, medicines, doses, lab values, advice, or diagnoses.
- If a section is not available and not required, write "Not recorded".
- If no procedure is recorded, do not include operation notes.
- Start with a heading named "Diagnosis".
- Immediately after Diagnosis, include "Discharge Medications" as a Markdown table with columns: Name | Strength | Route | Dosage | Days.
- In the Dosage cell, put the English dosage first and the Hindi dosage on the next line using <br/>.
- Use clear headings, subheadings, bullet points, and concise doctor-facing language.
- End with this exact line and nothing changed: ${EMERGENCY_LINE}

Return Markdown only.

STRUCTURED DATA:
${JSON.stringify(record, null, 2)}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(describeGeminiError(data, response.status));
  }
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text || typeof text !== "string") {
    throw new Error("The AI returned an empty discharge summary.");
  }
  return text.trim();
}

async function fetchVisitRecord(visitId: string) {
  const visitSelect = `
    id,
    visit_id,
    patient_id,
    diagnosis_id,
    admission_date,
    discharge_date,
    reason_for_visit,
    treatment_type,
    doctor_name,
    appointment_with,
    vital_signs,
    ipd_admission_notes,
    package_name,
    package_amount,
    package_days,
    package_status,
    package_includes_medicine,
    is_package_patient,
    corporate,
    insurance_type,
    surgery_date,
    discharge_mode,
    discharge_notes
  `;

  const candidates = buildVisitCandidates(visitId);
  let lastError: any = null;

  for (const candidate of candidates) {
    const exactText = await supabase.from("visits").select(visitSelect).eq("visit_id", candidate).maybeSingle();
    if (exactText.data) return { visit: exactText.data, error: null };
    if (exactText.error && exactText.error.code !== "PGRST116") lastError = exactText.error;

    const exactUuid = await supabase.from("visits").select(visitSelect).eq("id", candidate).maybeSingle();
    if (exactUuid.data) return { visit: exactUuid.data, error: null };
    if (exactUuid.error && exactUuid.error.code !== "PGRST116") lastError = exactUuid.error;
  }

  return { visit: null, error: lastError };
}

async function fetchSavedSummary(visitIds: string[]) {
  for (const candidate of visitIds) {
    const { data, error } = await supabase
      .from("ipd_discharge_summary")
      .select("*")
      .eq("visit_id", candidate)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (error) continue;
    if (data?.[0]) return data[0];
  }

  return null;
}

export default function DischargeSummaryModule() {
  const { visitId } = useParams<{ visitId: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [summaryRowId, setSummaryRowId] = useState<string | null>(null);
  const [existingAdditionalData, setExistingAdditionalData] = useState<unknown>({});
  const [context, setContext] = useState<VisitContext | null>(null);
  const [generatedSummary, setGeneratedSummary] = useState("");
  const [form, setForm] = useState<FormState>({
    diagnosis: "",
    chiefComplaints: "",
    historyOfPresentIllness: "",
    examination: "",
    investigations: "",
    hospitalCourse: "",
    procedureDetails: "",
    operationNotes: "",
    conditionOnDischarge: "",
    dischargeAdvice: "",
    followUpInstructions: "",
    warningSigns: "",
    medications: [EMPTY_MEDICATION()],
  });

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (!visitId) {
        toast({ title: "Missing visit", description: "Visit ID is required.", variant: "destructive" });
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const candidateIds = buildVisitCandidates(visitId);
        const { visit: foundVisit, error: visitLookupError } = await fetchVisitRecord(visitId);
        const savedSummary = await fetchSavedSummary(candidateIds);

        if (!foundVisit && !savedSummary) {
          throw new Error(visitLookupError?.message || `Visit record or saved discharge summary was not found for ID: ${visitId}`);
        }

        const visitRecord: any = foundVisit || {
          id: String(savedSummary?.visit_id || visitId),
          visit_id: String(savedSummary?.visit_id || visitId),
          patient_id: savedSummary?.patient_id || null,
          diagnosis_id: null,
          admission_date: savedSummary?.admission_date || null,
          discharge_date: savedSummary?.date_of_discharge || null,
          reason_for_visit: savedSummary?.chief_complaints || null,
          treatment_type: savedSummary?.treatment_during_stay || null,
          doctor_name: savedSummary?.treating_consultant || null,
          appointment_with: savedSummary?.treating_consultant || null,
          vital_signs: savedSummary?.vital_signs || null,
          ipd_admission_notes: savedSummary?.hospital_stay_notes || savedSummary?.hospital_course || null,
          package_name: savedSummary?.additional_data && typeof savedSummary.additional_data === "object" ? (savedSummary.additional_data as any).package_name ?? null : null,
          package_amount: savedSummary?.additional_data && typeof savedSummary.additional_data === "object" ? (savedSummary.additional_data as any).package_amount ?? null : null,
          package_days: savedSummary?.additional_data && typeof savedSummary.additional_data === "object" ? (savedSummary.additional_data as any).package_days ?? null : null,
          package_status: null,
          package_includes_medicine: null,
          is_package_patient: null,
          corporate: savedSummary?.corporate_type || null,
          insurance_type: null,
          surgery_date: null,
          discharge_mode: null,
          discharge_notes: null,
        };

        const [patientResult, directDiagnosisResult, junctionDiagnosisResult, surgeriesResult] = await Promise.all([
          supabase
            .from("patients")
            .select("id, name, age, gender, address, patients_id, corporate, corporate_type, insurance_company, phone")
            .eq("id", visitRecord.patient_id)
            .maybeSingle(),
          foundVisit?.diagnosis_id
            ? supabase.from("diagnoses").select("id, name").eq("id", foundVisit.diagnosis_id).maybeSingle()
            : Promise.resolve({ data: null, error: null } as any),
          foundVisit?.id
            ? supabase
                .from("visit_diagnoses")
                .select(`
                  is_primary,
                  notes,
                  diagnoses(
                    id,
                    name
                  )
                `)
                .eq("visit_id", foundVisit.id)
            : Promise.resolve({ data: [], error: null } as any),
          foundVisit?.id
            ? supabase
                .from("visit_surgeries")
                .select(`
                  id,
                  surgeon,
                  anaesthetist_name,
                  anaesthesia_type,
                  surgery_date,
                  notes,
                  cghs_surgery(
                    name,
                    code,
                    category
                  ),
                  yojana_mh_procedures:yojana_procedure_id(
                    package_name,
                    procedure_name,
                    procedure_code,
                    package_code,
                    medical_or_surgical,
                    specialty,
                    level_of_care,
                    los
                  )
                `)
                .eq("visit_id", foundVisit.id)
            : Promise.resolve({ data: [], error: null } as any),
        ]);

        const patient = patientResult.data;
        if (foundVisit) {
          foundVisit.diagnoses = directDiagnosisResult.data;
          foundVisit.visit_diagnoses = junctionDiagnosisResult.data || [];
          foundVisit.visit_surgeries = surgeriesResult.data || [];
        }

        const [medicationsByUuid, medicationsByText, labsByUuid, labsByText, radiologyByUuid, radiologyByText] = await Promise.all([
          supabase
            .from("visit_medications")
            .select(`
              id,
              dosage,
              frequency,
              duration,
              route,
              medication:medication_id(name, strength)
            `)
            .eq("visit_id", visitRecord.id),
          supabase
            .from("visit_medications")
            .select(`
              id,
              dosage,
              frequency,
              duration,
              route,
              medication:medication_id(name, strength)
            `)
            .eq("visit_id", visitRecord.visit_id),
          supabase
            .from("lab_results")
            .select("id, test_name, main_test_name, test_category, result_value, result_unit, created_at")
            .eq("visit_id", visitRecord.id),
          supabase
            .from("lab_results")
            .select("id, test_name, main_test_name, test_category, result_value, result_unit, created_at")
            .eq("visit_id", visitRecord.visit_id),
          supabase
            .from("visit_radiology")
            .select("id, ordered_date, completed_date, findings, impression, notes, radiology(name, category)")
            .eq("visit_id", visitRecord.id),
          supabase
            .from("visit_radiology")
            .select("id, ordered_date, completed_date, findings, impression, notes, radiology(name, category)")
            .eq("visit_id", visitRecord.visit_id),
        ]);

        const labMap = new Map<string, any>();
        [...(labsByUuid.data || []), ...(labsByText.data || [])].forEach((item: any) => {
          labMap.set(String(item.id), item);
        });

        const radiologyMap = new Map<string, any>();
        [...(radiologyByUuid.data || []), ...(radiologyByText.data || [])].forEach((item: any) => {
          radiologyMap.set(String(item.id), item);
        });

        const diagnoses = [
          foundVisit?.diagnoses?.name,
          ...((foundVisit?.visit_diagnoses || []).map((row: any) => row?.diagnoses?.name).filter(Boolean)),
        ].filter(Boolean);

        const procedureRows = (foundVisit?.visit_surgeries || []).map((row: any) => {
          const procedureName = row?.cghs_surgery?.name || "Procedure recorded";
          const procedureCode = row?.cghs_surgery?.code ? ` (${row.cghs_surgery.code})` : "";
          const datePart = row?.surgery_date ? `Date: ${formatDate(row.surgery_date)}` : "";
          const surgeonPart = row?.surgeon ? `Surgeon: ${row.surgeon}` : "";
          const anesthesiaPart = row?.anaesthesia_type ? `Anaesthesia: ${row.anaesthesia_type}` : "";
          return [procedureName + procedureCode, datePart, surgeonPart, anesthesiaPart, asText(row?.notes)]
            .filter(Boolean)
            .join("\n");
        });

        const medicationMap = new Map<string, any>();
        [...(medicationsByUuid.data || []), ...(medicationsByText.data || [])].forEach((item: any) => {
          medicationMap.set(String(item.id), item);
        });

        const derivedMedications = Array.from(medicationMap.values()).map((row: any, index: number) => ({
          id: String(row?.id || index + 1),
          name: asText(row?.medication?.name),
          strength: asText(row?.medication?.strength),
          route: asText(row?.route) || "Oral",
          dosageEn: [asText(row?.dosage), asText(row?.frequency)].filter(Boolean).join(" ").trim(),
          dosageHi: inferHindiDosage([asText(row?.dosage), asText(row?.frequency)].filter(Boolean).join(" ").trim()),
          days: asText(row?.duration),
        }));

        const investigationSections: string[] = [];
        if (labMap.size > 0) {
          investigationSections.push(
            "Laboratory Results:\n" +
              Array.from(labMap.values())
                .map((item: any) => {
                  const name = item.test_name || item.main_test_name || item.test_category || "Lab test";
                  const value = item.result_value ? `: ${item.result_value}${item.result_unit ? ` ${item.result_unit}` : ""}` : "";
                  const date = item.created_at ? ` (${formatDate(item.created_at)})` : "";
                  return `- ${name}${value}${date}`;
                })
                .join("\n"),
          );
        }
        if (radiologyMap.size > 0) {
          investigationSections.push(
            "Radiology Results:\n" +
              Array.from(radiologyMap.values())
                .map((item: any) => {
                  const study = item?.radiology?.name || "Radiology study";
                  const findings = asText(item?.findings || item?.impression || item?.notes);
                  return `- ${study}${findings ? `: ${findings}` : ""}`;
                })
                .join("\n"),
          );
        }

        const savedMeds = parseMedicationRows(savedSummary?.discharge_medications);
        const generated = safeJsonObject(savedSummary?.additional_data).generated_summary;

        const nextContext: VisitContext = {
          id: String(visitRecord.id),
          visitId: String(visitRecord.visit_id || visitId),
          patientId: String(patient?.id || visitRecord.patient_id || ""),
          patientName: asText(patient?.name || savedSummary?.patient_name || "Unknown Patient"),
          regId: asText(patient?.patients_id || savedSummary?.reg_id),
          ageSex: `${asText(patient?.age || "").trim()}${patient?.age ? " Years / " : ""}${asText(patient?.gender || "").trim()}`.replace(/^ Years \/ /, ""),
          address: asText(patient?.address || savedSummary?.address),
          consultant: asText(visitRecord.doctor_name || visitRecord.appointment_with || savedSummary?.treating_consultant),
          admissionDate: formatDateInput(visitRecord.admission_date || savedSummary?.admission_date),
          dischargeDate: formatDateInput(visitRecord.discharge_date || savedSummary?.date_of_discharge),
          treatmentType: asText(visitRecord.treatment_type || savedSummary?.treatment_during_stay),
          hasProcedure: procedureRows.length > 0 || Boolean(asText(savedSummary?.procedures_performed).trim()),
        };

        const nextForm: FormState = {
          diagnosis: asText(savedSummary?.primary_diagnosis || diagnoses[0] || "").trim(),
          chiefComplaints: asText(savedSummary?.chief_complaints || visitRecord.reason_for_visit || "").trim(),
          historyOfPresentIllness: asText(savedSummary?.history_of_present_illness || "").trim(),
          examination: asText(savedSummary?.general_examination || normalizeVitals(visitRecord.vital_signs)).trim(),
          investigations:
            asText(safeJsonObject(savedSummary?.lab_investigations).text || investigationSections.join("\n\n")).trim(),
          hospitalCourse: asText(savedSummary?.hospital_course || savedSummary?.hospital_stay_notes || visitRecord.ipd_admission_notes || "").trim(),
          procedureDetails:
            asText(
              Array.isArray(savedSummary?.procedures_performed)
                ? savedSummary.procedures_performed.map((row: any) => asText(row?.details || row?.name || row)).join("\n\n")
                : procedureRows.join("\n\n"),
            ).trim(),
          operationNotes: asText(savedSummary?.operation_notes || savedSummary?.ot_notes || "").trim(),
          conditionOnDischarge: asText(savedSummary?.condition_on_discharge || "").trim(),
          dischargeAdvice: asText(savedSummary?.discharge_advice || "").trim(),
          followUpInstructions: asText(savedSummary?.follow_up_instructions || "").trim(),
          warningSigns: asText(savedSummary?.warning_signs || "").trim(),
          medications: savedMeds.length > 0 ? savedMeds : derivedMedications.length > 0 ? derivedMedications : [EMPTY_MEDICATION()],
        };

        if (!active) return;
        setContext(nextContext);
        setSummaryRowId(savedSummary?.id || null);
        setExistingAdditionalData(savedSummary?.additional_data || {});
        setGeneratedSummary(typeof generated === "string" ? generated : "");
        setForm(nextForm);
      } catch (error) {
        if (!active) return;
        toast({
          title: "Failed to load discharge summary",
          description: error instanceof Error ? error.message : "Unknown error",
          variant: "destructive",
        });
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [visitId]);

  const validMedicationRows = useMemo(
    () =>
      form.medications.filter(
        (med) => med.name.trim() && med.dosageEn.trim() && med.days.trim(),
      ),
    [form.medications],
  );

  const missingFields = useMemo(() => {
    const missing: string[] = [];
    if (!form.diagnosis.trim()) missing.push("Diagnosis");
    if (validMedicationRows.length === 0) missing.push("Discharge medications");
    if (!form.hospitalCourse.trim()) missing.push("Hospital course / stay summary");
    if (!form.conditionOnDischarge.trim()) missing.push("Condition on discharge");
    if (!form.dischargeAdvice.trim()) missing.push("Discharge advice");
    if (!form.followUpInstructions.trim()) missing.push("Follow-up instructions");
    if (context?.hasProcedure && !form.procedureDetails.trim()) missing.push("Procedure details");
    return missing;
  }, [context?.hasProcedure, form.conditionOnDischarge, form.diagnosis, form.dischargeAdvice, form.followUpInstructions, form.hospitalCourse, form.procedureDetails, validMedicationRows.length]);

  const canGenerate = Boolean(context);

  const updateMedication = (id: string, field: keyof MedicationRow, value: string) => {
    setForm((current) => ({
      ...current,
      medications: current.medications.map((med) =>
        med.id === id
          ? {
              ...med,
              [field]: value,
              ...(field === "dosageEn" && !med.dosageHi.trim() ? { dosageHi: inferHindiDosage(value) } : {}),
            }
          : med,
      ),
    }));
  };

  const saveDraft = async (summaryOverride?: string | null) => {
    if (!context?.patientId) return;
    setSaving(true);
    try {
      const summaryToSave =
        summaryOverride !== undefined ? summaryOverride : generatedSummary.trim() ? generatedSummary : null;
      const payload = serializeFormToSummaryRecord(form, summaryToSave, context, existingAdditionalData);
      if (summaryRowId) {
        const { error } = await supabase.from("ipd_discharge_summary").update(payload).eq("id", summaryRowId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("ipd_discharge_summary").insert(payload).select("id").single();
        if (error) throw error;
        setSummaryRowId((data as any)?.id || null);
      }
      toast({ title: "Saved", description: "Discharge summary draft saved." });
    } catch (error) {
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async () => {
    if (!context) return;
    setGenerating(true);
    try {
      const record = {
        visit: {
          visit_id: context.visitId,
          treating_consultant: context.consultant || "Not recorded",
          admission_date: context.admissionDate || "Not recorded",
          discharge_date: context.dischargeDate || "Not recorded",
          treatment_type: context.treatmentType || "Not recorded",
        },
        diagnosis: form.diagnosis.trim() || "Not recorded",
        chief_complaints: form.chiefComplaints.trim() || "Not recorded",
        history_of_present_illness: form.historyOfPresentIllness.trim() || "Not recorded",
        examination: form.examination.trim() || "Not recorded",
        investigations: form.investigations.trim() || "Not recorded",
        hospital_course: form.hospitalCourse.trim() || "Not recorded",
        procedures_performed: context.hasProcedure ? form.procedureDetails.trim() || "Not recorded" : "No procedure recorded",
        operation_notes: context.hasProcedure ? form.operationNotes.trim() || "Not recorded" : "No procedure recorded",
        condition_on_discharge: form.conditionOnDischarge.trim() || "Not recorded",
        discharge_advice: form.dischargeAdvice.trim() || "Not recorded",
        follow_up_instructions: form.followUpInstructions.trim() || "Not recorded",
        warning_signs: form.warningSigns.trim() || "Not recorded",
        discharge_medications: form.medications
          .filter((med) => med.name.trim())
          .map((med) => ({
            name: med.name.trim(),
            strength: med.strength.trim() || "Not recorded",
            route: med.route.trim() || "Not recorded",
            dosage_en: med.dosageEn.trim() || "Not recorded",
            dosage_hi: (med.dosageHi.trim() || inferHindiDosage(med.dosageEn)).trim() || "Not recorded",
            days: med.days.trim() || "Not recorded",
          })),
      };

      const summary = await generateDischargeSummary(record);
      setGeneratedSummary(summary);
      await saveDraft(summary);
      toast({ title: "Generated", description: "Discharge summary generated and saved." });
    } catch (error) {
      toast({
        title: "Generation failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  const handlePrint = () => {
    if (!generatedSummary.trim()) {
      toast({ title: "Nothing to print", description: "Generate the discharge summary first.", variant: "destructive" });
      return;
    }

    const printWindow = window.open("", "_blank", "noopener,noreferrer,width=900,height=1000");
    if (!printWindow) {
      toast({ title: "Print blocked", description: "Allow popups to print the summary.", variant: "destructive" });
      return;
    }

    printWindow.document.write(`
      <html>
        <head>
          <title>Discharge Summary - ${escapeHtml(context?.visitId || "")}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
            pre { white-space: pre-wrap; word-break: break-word; font-family: Arial, sans-serif; line-height: 1.5; }
          </style>
        </head>
        <body>
          <pre>${escapeHtml(generatedSummary)}</pre>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const handleDownloadPdf = async () => {
    if (!generatedSummary.trim()) {
      toast({ title: "Nothing to download", description: "Generate the discharge summary first.", variant: "destructive" });
      return;
    }

    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const lines = pdf.splitTextToSize(generatedSummary.replace(/\*\*/g, ""), 180);
    let y = 18;
    lines.forEach((line: string) => {
      if (y > 280) {
        pdf.addPage();
        y = 18;
      }
      pdf.text(line, 15, y);
      y += 6;
    });
    pdf.save(`Discharge_Summary_${context?.visitId || visitId}.pdf`);
  };

  if (loading) {
    return (
      <main className="container mx-auto max-w-6xl p-6">
        <div className="flex min-h-[400px] items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span>Loading discharge summary module…</span>
        </div>
      </main>
    );
  }

  return (
    <main className="container mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Discharge Summary</h1>
          <p className="text-sm text-muted-foreground">
            Independent module for drafting, generating, saving, and printing the discharge summary.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
      </div>

      {context && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Visit Context</CardTitle>
            <CardDescription>
              This module owns the discharge-summary workflow but fetches shared visit and clinical data for prefilling.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            <div><span className="font-medium">Visit ID:</span> {context.visitId}</div>
            <div><span className="font-medium">Patient:</span> {context.patientName || "Not recorded"}</div>
            <div><span className="font-medium">Registration:</span> {context.regId || "Not recorded"}</div>
            <div><span className="font-medium">Consultant:</span> {context.consultant || "Not recorded"}</div>
            <div><span className="font-medium">Admission:</span> {formatDate(context.admissionDate) || "Not recorded"}</div>
            <div><span className="font-medium">Discharge:</span> {formatDate(context.dischargeDate) || "Not recorded"}</div>
          </CardContent>
        </Card>
      )}

      {missingFields.length > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg text-amber-900">
              <AlertTriangle className="h-5 w-5" />
              Sections not yet filled
            </CardTitle>
            <CardDescription className="text-amber-900/80">
              Generation now continues with blanks skipped or marked as not recorded.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="list-disc pl-5 text-sm text-amber-950">
              {missingFields.map((field) => (
                <li key={field}>{field}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Clinical content</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="diagnosis">Diagnosis</Label>
                <Textarea id="diagnosis" rows={3} value={form.diagnosis} onChange={(e) => setForm((s) => ({ ...s, diagnosis: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="complaints">Chief complaints</Label>
                <Textarea id="complaints" rows={3} value={form.chiefComplaints} onChange={(e) => setForm((s) => ({ ...s, chiefComplaints: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="hpi">History of present illness</Label>
                <Textarea id="hpi" rows={4} value={form.historyOfPresentIllness} onChange={(e) => setForm((s) => ({ ...s, historyOfPresentIllness: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="exam">Examination / vitals</Label>
                <Textarea id="exam" rows={5} value={form.examination} onChange={(e) => setForm((s) => ({ ...s, examination: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="investigations">Investigations</Label>
                <Textarea id="investigations" rows={7} value={form.investigations} onChange={(e) => setForm((s) => ({ ...s, investigations: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="course">Hospital course / stay summary</Label>
                <Textarea id="course" rows={6} value={form.hospitalCourse} onChange={(e) => setForm((s) => ({ ...s, hospitalCourse: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="procedure">Procedure details</Label>
                <Textarea id="procedure" rows={5} value={form.procedureDetails} onChange={(e) => setForm((s) => ({ ...s, procedureDetails: e.target.value }))} placeholder={context?.hasProcedure ? "" : "No procedure recorded for this visit."} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="opnotes">Operation notes</Label>
                <Textarea id="opnotes" rows={6} value={form.operationNotes} onChange={(e) => setForm((s) => ({ ...s, operationNotes: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="condition">Condition on discharge</Label>
                <Textarea id="condition" rows={3} value={form.conditionOnDischarge} onChange={(e) => setForm((s) => ({ ...s, conditionOnDischarge: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="advice">Discharge advice</Label>
                <Textarea id="advice" rows={5} value={form.dischargeAdvice} onChange={(e) => setForm((s) => ({ ...s, dischargeAdvice: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="followup">Follow-up instructions</Label>
                <Textarea id="followup" rows={4} value={form.followUpInstructions} onChange={(e) => setForm((s) => ({ ...s, followUpInstructions: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="warnings">Warning signs / return precautions</Label>
                <Textarea id="warnings" rows={4} value={form.warningSigns} onChange={(e) => setForm((s) => ({ ...s, warningSigns: e.target.value }))} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-lg">Discharge medications</CardTitle>
                  <CardDescription>
                    This table is part of the independent module and is used directly for save and generation.
                  </CardDescription>
                </div>
                <Button type="button" variant="outline" onClick={() => setForm((s) => ({ ...s, medications: [...s.medications, EMPTY_MEDICATION()] }))}>
                  <Plus className="h-4 w-4" /> Add row
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Strength</TableHead>
                    <TableHead>Route</TableHead>
                    <TableHead>Dosage (EN)</TableHead>
                    <TableHead>Dosage (HI)</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead className="w-14" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {form.medications.map((med) => (
                    <TableRow key={med.id}>
                      <TableCell><Input value={med.name} onChange={(e) => updateMedication(med.id, "name", e.target.value)} /></TableCell>
                      <TableCell><Input value={med.strength} onChange={(e) => updateMedication(med.id, "strength", e.target.value)} /></TableCell>
                      <TableCell><Input value={med.route} onChange={(e) => updateMedication(med.id, "route", e.target.value)} /></TableCell>
                      <TableCell><Input value={med.dosageEn} onChange={(e) => updateMedication(med.id, "dosageEn", e.target.value)} /></TableCell>
                      <TableCell><Input value={med.dosageHi} onChange={(e) => updateMedication(med.id, "dosageHi", e.target.value)} /></TableCell>
                      <TableCell><Input value={med.days} onChange={(e) => updateMedication(med.id, "days", e.target.value)} /></TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            setForm((s) => ({
                              ...s,
                              medications: s.medications.length === 1
                                ? [EMPTY_MEDICATION()]
                                : s.medications.filter((row) => row.id !== med.id),
                            }))
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Actions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Button type="button" variant="outline" onClick={() => void saveDraft()} disabled={saving || generating || !context?.patientId}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save draft
              </Button>
              <Button type="button" onClick={() => void handleGenerate()} disabled={generating || saving || !canGenerate}>
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Generate summary
              </Button>
              <Button type="button" variant="outline" onClick={handlePrint} disabled={!generatedSummary.trim()}>
                <Printer className="h-4 w-4" /> Print
              </Button>
              <Button type="button" variant="outline" onClick={() => void handleDownloadPdf()} disabled={!generatedSummary.trim()}>
                <Download className="h-4 w-4" /> Download PDF
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="h-5 w-5" />
                Generated summary preview
              </CardTitle>
              <CardDescription>
                The saved generated content is the source of truth for print/download.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {generatedSummary.trim() ? (
                <article className="max-h-[900px] overflow-auto whitespace-pre-wrap rounded-md border bg-slate-50 p-4 text-sm leading-7">
                  {generatedSummary}
                </article>
              ) : (
                <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                  No generated summary yet.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
