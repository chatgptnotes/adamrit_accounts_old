import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  SimilarPatientsPrompt,
  similarPatientsBlockSubmit,
  contactChanges,
  EMPTY_SIMILAR_STATE,
  type SimilarPatientsState,
} from "@/components/PatientRegistrationForm/SimilarPatientsPrompt";
import { useAuth } from "@/contexts/AuthContext";
import { useCorporateData } from "@/hooks/useCorporateData";
import { generatePatientId } from "@/utils/patientIdGenerator";
import { generateVisitId } from "@/utils/visitIdGenerator";
import { normalizeAadhaar, isValidAadhaar } from "@/utils/aadhaar";
import { cn } from "@/lib/utils";
import { isYojanaPanel } from "@/lib/yojanaPanel";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletConfirm } from "@/tablet/components/TabletConfirm";
import { DictationTextarea } from "@/tablet/components/DictationTextarea";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";

type PatientType = "OPD" | "IPD" | "Emergency";
type Step = "patient" | "visit" | "ward" | "review";

const PATIENT_TYPES: PatientType[] = ["OPD", "IPD", "Emergency"];
const VISIT_TYPES = [
  "consultation",
  "follow-up",
  "surgery",
  "emergency",
  "routine-checkup",
  "patient-admission",
];
const TREATMENT_TYPES = ["Conservative", "Surgical"];
const GENDERS = ["Male", "Female", "Other"];
const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"];
const IDENTITY_TYPES = [
  "Aadhar Card",
  "PAN Card",
  "Passport",
  "Driving License",
  "Voter ID",
  "Ration Card",
  "Other",
];

interface PatientForm {
  name: string;
  age: string;
  gender: string;
  dob: string;
  phone: string;
  address: string;
  bloodGroup: string;
  email: string;
  identityType: string;
  aadharPassport: string;
  aadhaarNumber: string;
  corporate: string;
  insuranceNo: string;
  quarterPlotNo: string;
  ward: string;
  panchayat: string;
  pinCode: string;
  state: string;
  cityTown: string;
  emgName: string;
  emgMobile: string;
  emg2Name: string;
  emg2Mobile: string;
  relativePhone: string;
  spouseName: string;
  relationshipManager: string;
  allergies: string;
  privilegeCardNumber: string;
  billingLink: string;
  instructions: string;
}
interface VisitForm {
  patientType: PatientType | "";
  visitType: string;
  doctor: string;
  reason: string;
  treatmentType: string;
  thumbReg: string;
  yojanaRegId: string;
  claimId: string;
}

const EMPTY_PATIENT: PatientForm = {
  name: "",
  age: "",
  gender: "",
  dob: "",
  phone: "",
  address: "",
  bloodGroup: "",
  email: "",
  identityType: "",
  aadharPassport: "",
  aadhaarNumber: "",
  corporate: "",
  insuranceNo: "",
  quarterPlotNo: "",
  ward: "",
  panchayat: "",
  pinCode: "",
  state: "",
  cityTown: "",
  emgName: "",
  emgMobile: "",
  emg2Name: "",
  emg2Mobile: "",
  relativePhone: "",
  spouseName: "",
  relationshipManager: "",
  allergies: "",
  privilegeCardNumber: "",
  billingLink: "",
  instructions: "",
};
const EMPTY_VISIT: VisitForm = {
  patientType: "",
  visitType: "",
  doctor: "",
  reason: "",
  treatmentType: "",
  thumbReg: "",
  yojanaRegId: "",
  claimId: "",
};

const selectClass =
  "h-14 w-full rounded-xl border border-input bg-background px-3 text-lg";
/**
 * Adaptive field grid: 1 field per row on phones, 2 on tablets, 3 on desktop.
 * Gaps widen on larger viewports for the spacious "table view" registration UI.
 */
const gridClass =
  "grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3";
/**
 * Centring guard rail — caps width and centres the flow so it keeps tablet
 * line rhythm on large desktop / 4K monitors instead of stretching edge to
 * edge. No extra horizontal padding here: FlowScaffold already supplies it,
 * so this avoids double padding on phones.
 */
const envelopeClass = "mx-auto w-full max-w-7xl";

const isEsic = (corporate: string) => corporate.toLowerCase().includes("esic");

/** One labelled cell in the registration grid. Module-level so inputs keep focus. */
function Field({
  label,
  children,
  span,
}: {
  label: string;
  children: ReactNode;
  span?: 2 | 3;
}) {
  return (
    <div
      className={span === 3 ? "lg:col-span-3" : span === 2 ? "lg:col-span-2" : ""}
    >
      <TabletLabel>{label}</TabletLabel>
      {children}
    </div>
  );
}

/** Module 1 — register a new patient AND their visit (full website field set). */
export default function RegisterPatientFlow() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { hospitalConfig, hospitalType } = useAuth();
  const { corporateOptions } = useCorporateData();

  const [patient, setPatient] = useState<PatientForm>(EMPTY_PATIENT);
  // Duplicate-name guard: the same prompt the website registration uses.
  const [similar, setSimilar] = useState<SimilarPatientsState>(EMPTY_SIMILAR_STATE);
  const [visit, setVisit] = useState<VisitForm>(EMPTY_VISIT);
  const [wardId, setWardId] = useState("");
  const [room, setRoom] = useState("");
  const [step, setStep] = useState<Step>("patient");

  const setP = (k: keyof PatientForm, v: string) =>
    setPatient((f) => ({ ...f, [k]: v }));
  const setV = (k: keyof VisitForm, v: string) =>
    setVisit((f) => ({ ...f, [k]: v }));

  const isAdmit = visit.patientType === "IPD" || visit.patientType === "Emergency";
  const steps: Step[] = useMemo(
    () => ["patient", "visit", ...(isAdmit ? (["ward"] as Step[]) : []), "review"],
    [isAdmit],
  );
  const stepIndex = steps.indexOf(step);

  // --- reference data -------------------------------------------------------
  const doctors = useQuery({
    queryKey: ["tablet-consultants", hospitalType],
    queryFn: async () => {
      const table =
        hospitalType === "ayushman" ? "ayushman_consultants" : "hope_consultants";
      const { data, error } = await supabase
        .from(table)
        .select("id, name, specialty")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as { id: string; name: string; specialty: string | null }[];
    },
  });

  const wards = useQuery({
    queryKey: ["tablet-register-wards", hospitalConfig.name],
    enabled: isAdmit,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("room_management")
        .select("id, ward_id, ward_type, maximum_rooms")
        .eq("hospital_name", hospitalConfig.name);
      if (error) throw error;
      return (data || []) as {
        id: string;
        ward_id: string;
        ward_type: string;
        maximum_rooms: number;
      }[];
    },
  });

  const selectedWard = (wards.data || []).find((w) => w.ward_id === wardId);

  const occupied = useQuery({
    queryKey: ["tablet-ward-occupancy", wardId],
    enabled: !!wardId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("visits")
        .select("room_allotted")
        .eq("ward_allotted", wardId)
        .is("discharge_date", null);
      if (error) throw error;
      return new Set(
        (data || []).map((v: any) => String(v.room_allotted)).filter(Boolean),
      );
    },
  });

  const availableRooms = useMemo(() => {
    if (!selectedWard) return [];
    const max = Number(selectedWard.maximum_rooms) || 0;
    const occ = occupied.data || new Set<string>();
    const rooms: string[] = [];
    for (let i = 1; i <= max; i++) {
      if (!occ.has(String(i))) rooms.push(String(i));
    }
    return rooms;
  }, [selectedWard, occupied.data]);

  // --- submit ---------------------------------------------------------------
  const register = useMutation({
    mutationFn: async () => {
      const hType = hospitalType || "hope";
      const now = new Date();
      const orNull = (s: string) => (s.trim() ? s.trim() : null);
      const aadhaarNumber = normalizeAadhaar(patient.aadhaarNumber);

      // The user picked a patient already on file: the visit is registered
      // against that record and no second patient is created.
      const reuse = similar.chosen
        ? (
            await supabase
              .from("patients")
              .select("id, patients_id, name")
              .eq("id", similar.chosen.id)
              .maybeSingle()
          ).data
        : null;
      if (similar.chosen && !reuse) {
        throw new Error("That patient could not be opened — pick again.");
      }
      // Their file keeps what it has unless the user asked to refresh it.
      if (reuse && similar.updateContact) {
        const changes = contactChanges(similar.chosen, patient.phone, patient.address);
        if (Object.keys(changes).length > 0) {
          await supabase.from("patients").update(changes).eq("id", (reuse as any).id);
        }
      }

      // Dedup pre-check: block a second record for the same Aadhaar in this
      // hospital. The DB partial unique index is the hard backstop. Skipped
      // when reusing, because that record is the one being kept.
      const { data: existing } = reuse ? { data: null } : await supabase
        .from("patients")
        .select("patients_id, name")
        .eq("hospital_name", hospitalConfig.name)
        .eq("aadhaar_number", aadhaarNumber)
        .maybeSingle();
      if (existing) {
        throw new Error(
          `A patient with this Aadhaar is already registered: ${existing.name} (ID: ${existing.patients_id}).`,
        );
      }

      // 1) INSERT new patient — full website field set. Not when reusing.
      const patientsId = reuse ? (reuse as any).patients_id : await generatePatientId(hType, now);
      const { data: insertedRow, error: pErr } = reuse
        ? { data: null, error: null }
        : await supabase
        .from("patients")
        .insert({
          name: patient.name.trim(),
          age: patient.age ? Number(patient.age) : null,
          gender: patient.gender,
          date_of_birth: orNull(patient.dob),
          phone: orNull(patient.phone),
          address: orNull(patient.address),
          blood_group: orNull(patient.bloodGroup),
          email: orNull(patient.email),
          identity_type: orNull(patient.identityType),
          aadhar_passport: orNull(patient.aadharPassport),
          aadhaar_number: aadhaarNumber,
          corporate: patient.corporate || null,
          insurance_person_no: orNull(patient.insuranceNo),
          quarter_plot_no: orNull(patient.quarterPlotNo),
          ward: orNull(patient.ward),
          panchayat: orNull(patient.panchayat),
          pin_code: orNull(patient.pinCode),
          state: orNull(patient.state),
          city_town: orNull(patient.cityTown),
          emergency_contact_name: orNull(patient.emgName),
          emergency_contact_mobile: orNull(patient.emgMobile),
          second_emergency_contact_name: orNull(patient.emg2Name),
          second_emergency_contact_mobile: orNull(patient.emg2Mobile),
          relative_phone_no: orNull(patient.relativePhone),
          spouse_name: orNull(patient.spouseName),
          relationship_manager: orNull(patient.relationshipManager),
          allergies: orNull(patient.allergies),
          privilege_card_number: orNull(patient.privilegeCardNumber),
          billing_link: orNull(patient.billingLink),
          instructions: orNull(patient.instructions),
          patients_id: patientsId,
          hospital_name: hospitalConfig.name,
        })
        .select("id, patients_id")
        .single();
      if (pErr) {
        if (pErr.message.includes("patients_hospital_aadhaar_unique")) {
          throw new Error("A patient with this Aadhaar number is already registered.");
        }
        throw new Error(`Patient could not be saved: ${pErr.message}`);
      }
      // Whether it was reused or created, everything below works off this row.
      const patientRow = (reuse ?? insertedRow) as {
        id: string;
        patients_id: string;
        name?: string;
      };

      // 2) INSERT new visit
      const visitId = await generateVisitId(now);
      const claimId = visit.claimId.trim() || visitId;
      const { data: visitRow, error: vErr } = await supabase
        .from("visits")
        .insert({
          visit_id: visitId,
          patient_id: patientRow.id,
          visit_date: format(now, "yyyy-MM-dd"),
          visit_type: visit.visitType,
          appointment_with: visit.doctor,
          reason_for_visit: visit.reason.trim(),
          status: "scheduled",
          patient_type: visit.patientType,
          claim_id: claimId,
          thumb_registration_no: visit.thumbReg.trim() || visitId,
          // The key that matches this patient to the government portal.
          yojana_registration_id: visit.yojanaRegId.trim() || null,
          treatment_type: visit.treatmentType,
          ward_allotted: isAdmit ? wardId : null,
          room_allotted: isAdmit ? room || null : null,
          admission_date: isAdmit ? now.toISOString() : null,
        })
        .select("id, visit_id")
        .single();
      if (vErr) throw new Error(`Visit could not be saved: ${vErr.message}`);

      // 3) INSERT legacy patient_data mirror — best effort (desktop also does
      //    not fail registration if this errors).
      try {
        await supabase.from("patient_data").insert({
          patient_name: patientRow.name?.trim() || patient.name.trim(),
          patient_id: patientRow.patients_id,
          mrn: visitRow.visit_id,
          age: patient.age || "",
          sex: patient.gender || "",
          patient_type: patient.corporate || "",
          date_of_admission: format(now, "yyyy-MM-dd"),
          diagnosis_and_surgery_performed: "",
          surgery_performed_by: visit.doctor,
          claim_id: claimId,
          intimation_done_not_done: "Done",
          payment_status: "Pending",
          sst_or_secondary_treatment: isEsic(patient.corporate) ? "ESIC" : "Private",
          referral_original_yes_no: "No",
          e_pahachan_card_yes_no: "No",
          hitlabh_or_entitelment_benefits_yes_no: "No",
          adhar_card_yes_no: patient.aadharPassport.trim() ? "Yes" : "No",
          remark_1: `Visit ID: ${visitRow.visit_id}`,
          remark_2: `Patient ID: ${patientRow.patients_id}`,
        });
      } catch (e) {
        console.warn("patient_data mirror insert skipped:", e);
      }

      return { patientsId: patientRow.patients_id, visitId: visitRow.visit_id };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tablet-admitted-visits"] });
      qc.invalidateQueries({ queryKey: ["tablet-occupancy"] });
    },
  });

  // --- validation -----------------------------------------------------------
  const patientValid =
    !similarPatientsBlockSubmit(similar) &&
    patient.name.trim().length > 1 &&
    !!patient.gender &&
    !!patient.age &&
    !!patient.phone.trim() &&
    !!patient.address.trim() &&
    isValidAadhaar(patient.aadhaarNumber) &&
    !!patient.corporate &&
    !!patient.emgName.trim() &&
    !!patient.emgMobile.trim() &&
    (!isEsic(patient.corporate) || !!patient.insuranceNo.trim());
  const visitValid =
    !!visit.patientType &&
    !!visit.visitType &&
    !!visit.doctor &&
    !!visit.reason.trim() &&
    !!visit.treatmentType &&
    // A Yojana ADMISSION needs the ID printed on their card — portal claims
    // and extension alerts match on it. OPD visits have no portal case yet,
    // so requiring it there would block registration.
    (!isAdmit || !isYojanaPanel(patient.corporate) || !!visit.yojanaRegId.trim());
  const wardValid = !isAdmit || (!!wardId && !!room);

  // --- success --------------------------------------------------------------
  if (register.isSuccess) {
    return (
      <TabletConfirm
        status="success"
        title="Patient registered"
        message={`${patient.name} — ${register.data?.patientsId} · visit ${register.data?.visitId} (${visit.patientType}).`}
        primaryAction={{
          label: "Register another",
          onClick: () => {
            setPatient(EMPTY_PATIENT);
            setVisit(EMPTY_VISIT);
            setWardId("");
            setRoom("");
            setStep("patient");
            register.reset();
          },
        }}
        secondaryAction={{ label: "Back to Home", onClick: () => navigate("/") }}
      />
    );
  }

  // --- step navigation ------------------------------------------------------
  const goNext = () => setStep(steps[Math.min(stepIndex + 1, steps.length - 1)]);
  const goBack = () => setStep(steps[Math.max(stepIndex - 1, 0)]);

  const headings: Record<Step, [string, string]> = {
    patient: ["Patient details", "Who is being registered?"],
    visit: ["Visit details", "Type of visit and doctor"],
    ward: ["Ward & bed", "Assign an admission bed"],
    review: ["Confirm registration", "Check before saving"],
  };

  const footer = (
    <div className={cn(envelopeClass, "flex gap-3")}>
      {stepIndex > 0 ? (
        <TabletButton
          variant="outline"
          className="flex-1"
          onClick={goBack}
          disabled={register.isPending}
        >
          Back
        </TabletButton>
      ) : null}
      {step === "review" ? (
        <TabletButton
          className="flex-1"
          onClick={() => register.mutate()}
          disabled={register.isPending}
        >
          {register.isPending ? "Saving…" : "Confirm & Register"}
        </TabletButton>
      ) : (
        <TabletButton
          className="flex-1"
          onClick={goNext}
          disabled={
            (step === "patient" && !patientValid) ||
            (step === "visit" && !visitValid) ||
            (step === "ward" && !wardValid)
          }
        >
          Continue
        </TabletButton>
      )}
    </div>
  );

  const reviewRows: [string, string][] = [
    ["Name", patient.name],
    ["Age / Gender", `${patient.age || "—"} / ${patient.gender}`],
    ["Date of birth", patient.dob],
    ["Phone", patient.phone],
    ["Address", patient.address],
    ["Blood group", patient.bloodGroup],
    ["Email", patient.email],
    ["Aadhaar", patient.aadhaarNumber],
    ["ID", [patient.identityType, patient.aadharPassport].filter(Boolean).join(" · ")],
    ["Billing category", patient.corporate],
    ...(isEsic(patient.corporate)
      ? ([["Insurance no.", patient.insuranceNo]] as [string, string][])
      : []),
    [
      "City / State / PIN",
      [patient.cityTown, patient.state, patient.pinCode].filter(Boolean).join(", "),
    ],
    ["Emergency contact", `${patient.emgName} · ${patient.emgMobile}`],
    [
      "2nd emergency",
      [patient.emg2Name, patient.emg2Mobile].filter(Boolean).join(" · "),
    ],
    ["Relationship mgr", patient.relationshipManager],
    ["Allergies", patient.allergies],
    ["Patient type", visit.patientType],
    ["Visit type", visit.visitType],
    ["Doctor", visit.doctor],
    ["Treatment", visit.treatmentType],
    ["Reason", visit.reason],
    ...(isAdmit
      ? ([
          ["Ward / bed", `${selectedWard?.ward_type || wardId} · bed ${room}`],
        ] as [string, string][])
      : []),
    ["Hospital", hospitalConfig.fullName],
  ];

  return (
    <FlowScaffold
      step={stepIndex + 1}
      totalSteps={steps.length}
      heading={headings[step][0]}
      subheading={headings[step][1]}
      actions={footer}
    >
      {step === "patient" && (
        <div className={cn(envelopeClass, "space-y-6")}>
          {/* Patient information */}
          <section>
            <h3 className="mb-3 text-sm font-bold uppercase text-muted-foreground">
              Patient information
            </h3>
            <div className={gridClass}>
              <Field label="Full name *" span={2}>
                <TabletInput
                  value={patient.name}
                  onChange={(e) => setP("name", e.target.value)}
                  placeholder="Patient name"
                />
                <SimilarPatientsPrompt
                  typedName={patient.name}
                  typedPhone={patient.phone}
                  typedAddress={patient.address}
                  hospitalName={hospitalConfig.name}
                  value={similar}
                  onChange={setSimilar}
                />
              </Field>
              <Field label="Age *">
                <TabletInput
                  value={patient.age}
                  onChange={(e) => setP("age", e.target.value.replace(/\D/g, ""))}
                  inputMode="numeric"
                  placeholder="Years"
                />
              </Field>
              <Field label="Date of birth">
                <TabletInput
                  type="date"
                  value={patient.dob}
                  onChange={(e) => setP("dob", e.target.value)}
                />
              </Field>
              <Field label="Gender *">
                <select
                  className={selectClass}
                  value={patient.gender}
                  onChange={(e) => setP("gender", e.target.value)}
                >
                  <option value="">Select…</option>
                  {GENDERS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Phone *">
                <TabletInput
                  value={patient.phone}
                  onChange={(e) => setP("phone", e.target.value)}
                  inputMode="tel"
                  placeholder="Mobile number"
                />
              </Field>
              <Field label="Blood group">
                <select
                  className={selectClass}
                  value={patient.bloodGroup}
                  onChange={(e) => setP("bloodGroup", e.target.value)}
                >
                  <option value="">Select…</option>
                  {BLOOD_GROUPS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Email">
                <TabletInput
                  type="email"
                  value={patient.email}
                  onChange={(e) => setP("email", e.target.value)}
                  placeholder="Email address"
                />
              </Field>
              <Field label="Identity type">
                <select
                  className={selectClass}
                  value={patient.identityType}
                  onChange={(e) => setP("identityType", e.target.value)}
                >
                  <option value="">Select…</option>
                  {IDENTITY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Aadhaar number *">
                <TabletInput
                  inputMode="numeric"
                  value={patient.aadhaarNumber}
                  onChange={(e) =>
                    setP("aadhaarNumber", e.target.value.replace(/\D/g, "").slice(0, 12))
                  }
                  placeholder="12-digit Aadhaar number"
                  maxLength={12}
                />
              </Field>
              <Field label="ID number (Aadhar / Passport)">
                <TabletInput
                  value={patient.aadharPassport}
                  onChange={(e) => setP("aadharPassport", e.target.value)}
                  placeholder="ID number"
                />
              </Field>
              <Field label="Billing category (corporate) *">
                <select
                  className={selectClass}
                  value={patient.corporate}
                  onChange={(e) => setP("corporate", e.target.value)}
                >
                  <option value="">Select category…</option>
                  {corporateOptions.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Field>
              {isEsic(patient.corporate) ? (
                <Field label="Insurance person no. * (ESIC)">
                  <TabletInput
                    value={patient.insuranceNo}
                    onChange={(e) => setP("insuranceNo", e.target.value)}
                    placeholder="ESIC insurance number"
                  />
                </Field>
              ) : null}
            </div>
          </section>

          {/* Address */}
          <section>
            <h3 className="mb-3 text-sm font-bold uppercase text-muted-foreground">
              Address
            </h3>
            <div className={gridClass}>
              <Field label="Address *" span={3}>
                <TabletInput
                  value={patient.address}
                  onChange={(e) => setP("address", e.target.value)}
                  placeholder="Address"
                />
              </Field>
              <Field label="Quarter / plot no.">
                <TabletInput
                  value={patient.quarterPlotNo}
                  onChange={(e) => setP("quarterPlotNo", e.target.value)}
                  placeholder="Quarter / plot"
                />
              </Field>
              <Field label="Ward">
                <TabletInput
                  value={patient.ward}
                  onChange={(e) => setP("ward", e.target.value)}
                  placeholder="Ward"
                />
              </Field>
              <Field label="Panchayat">
                <TabletInput
                  value={patient.panchayat}
                  onChange={(e) => setP("panchayat", e.target.value)}
                  placeholder="Panchayat"
                />
              </Field>
              <Field label="City / Town">
                <TabletInput
                  value={patient.cityTown}
                  onChange={(e) => setP("cityTown", e.target.value)}
                  placeholder="City / town"
                />
              </Field>
              <Field label="State">
                <TabletInput
                  value={patient.state}
                  onChange={(e) => setP("state", e.target.value)}
                  placeholder="State"
                />
              </Field>
              <Field label="PIN code">
                <TabletInput
                  value={patient.pinCode}
                  onChange={(e) => setP("pinCode", e.target.value.replace(/\D/g, ""))}
                  inputMode="numeric"
                  placeholder="PIN code"
                />
              </Field>
            </div>
          </section>

          {/* Emergency contacts */}
          <section>
            <h3 className="mb-3 text-sm font-bold uppercase text-muted-foreground">
              Emergency contacts
            </h3>
            <div className={gridClass}>
              <Field label="Emergency contact *">
                <TabletInput
                  value={patient.emgName}
                  onChange={(e) => setP("emgName", e.target.value)}
                  placeholder="Name"
                />
              </Field>
              <Field label="Emergency mobile *">
                <TabletInput
                  value={patient.emgMobile}
                  onChange={(e) => setP("emgMobile", e.target.value)}
                  inputMode="tel"
                  placeholder="Mobile"
                />
              </Field>
              <Field label="Relative phone no.">
                <TabletInput
                  value={patient.relativePhone}
                  onChange={(e) => setP("relativePhone", e.target.value)}
                  inputMode="tel"
                  placeholder="Relative phone"
                />
              </Field>
              <Field label="2nd emergency contact">
                <TabletInput
                  value={patient.emg2Name}
                  onChange={(e) => setP("emg2Name", e.target.value)}
                  placeholder="Name"
                />
              </Field>
              <Field label="2nd emergency mobile">
                <TabletInput
                  value={patient.emg2Mobile}
                  onChange={(e) => setP("emg2Mobile", e.target.value)}
                  inputMode="tel"
                  placeholder="Mobile"
                />
              </Field>
              <Field label="Spouse name">
                <TabletInput
                  value={patient.spouseName}
                  onChange={(e) => setP("spouseName", e.target.value)}
                  placeholder="Spouse name"
                />
              </Field>
            </div>
          </section>

          {/* Additional information */}
          <section>
            <h3 className="mb-3 text-sm font-bold uppercase text-muted-foreground">
              Additional information
            </h3>
            <div className={gridClass}>
              <Field label="Relationship manager">
                <TabletInput
                  value={patient.relationshipManager}
                  onChange={(e) => setP("relationshipManager", e.target.value)}
                  placeholder="Relationship manager"
                />
              </Field>
              <Field label="Privilege card number">
                <TabletInput
                  value={patient.privilegeCardNumber}
                  onChange={(e) => setP("privilegeCardNumber", e.target.value)}
                  placeholder="Privilege card"
                />
              </Field>
              <Field label="Billing link">
                <TabletInput
                  value={patient.billingLink}
                  onChange={(e) => setP("billingLink", e.target.value)}
                  placeholder="Billing link"
                />
              </Field>
              <Field label="Allergies" span={3}>
                <TabletInput
                  value={patient.allergies}
                  onChange={(e) => setP("allergies", e.target.value)}
                  placeholder="Known allergies"
                />
              </Field>
              <Field label="Instructions / notes" span={3}>
                <DictationTextarea
                  value={patient.instructions}
                  onChange={(v) => setP("instructions", v)}
                  rows={3}
                  placeholder="Any special instructions"
                />
              </Field>
            </div>
          </section>
        </div>
      )}

      {step === "visit" && (
        <div className={cn(envelopeClass, "space-y-4")}>
          <div>
            <TabletLabel>Patient type *</TabletLabel>
            <div className="grid grid-cols-3 gap-2">
              {PATIENT_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setV("patientType", t)}
                  className={cn(
                    "h-14 rounded-xl text-base font-semibold",
                    visit.patientType === t
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
            {isAdmit ? (
              <p className="mt-1.5 text-sm text-muted-foreground">
                {visit.patientType} patients are admitted — a ward &amp; bed step
                follows.
              </p>
            ) : null}
          </div>
          <div className={gridClass}>
            <Field label="Visit type *">
              <select
                className={selectClass}
                value={visit.visitType}
                onChange={(e) => setV("visitType", e.target.value)}
              >
                <option value="">Select visit type…</option>
                {VISIT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Doctor *" span={2}>
              <select
                className={selectClass}
                value={visit.doctor}
                onChange={(e) => setV("doctor", e.target.value)}
              >
                <option value="">
                  {doctors.isLoading ? "Loading doctors…" : "Select doctor…"}
                </option>
                {(doctors.data || []).map((d) => (
                  <option key={d.id} value={d.name}>
                    {d.name}
                    {d.specialty ? ` — ${d.specialty}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Treatment type *">
              <select
                className={selectClass}
                value={visit.treatmentType}
                onChange={(e) => setV("treatmentType", e.target.value)}
              >
                <option value="">Select…</option>
                {TREATMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Claim ID">
              <TabletInput
                value={visit.claimId}
                onChange={(e) => setV("claimId", e.target.value)}
                placeholder="Optional"
              />
            </Field>
            <Field label="Thumb reg. no.">
              <TabletInput
                value={visit.thumbReg}
                onChange={(e) => setV("thumbReg", e.target.value)}
                placeholder="Optional"
              />
            </Field>
            {isYojanaPanel(patient.corporate) && (
              <Field label={isAdmit ? "Yojana registration ID *" : "Yojana registration ID"}>
                <TabletInput
                  value={visit.yojanaRegId}
                  onChange={(e) => setV("yojanaRegId", e.target.value)}
                  placeholder="As printed on the Yojana card"
                />
              </Field>
            )}
            <Field label="Reason for visit *" span={3}>
              <TabletInput
                value={visit.reason}
                onChange={(e) => setV("reason", e.target.value)}
                placeholder="Reason / chief complaint"
              />
            </Field>
          </div>
        </div>
      )}

      {step === "ward" && (
        <div className={cn(envelopeClass, "space-y-4")}>
          <div>
            <TabletLabel>Ward *</TabletLabel>
            {wards.isLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-7 w-7 animate-spin text-primary" />
              </div>
            ) : (wards.data || []).length === 0 ? (
              <p className="text-muted-foreground">
                No wards configured for this hospital.
              </p>
            ) : (
              <select
                className={selectClass}
                value={wardId}
                onChange={(e) => {
                  setWardId(e.target.value);
                  setRoom("");
                }}
              >
                <option value="">Select ward…</option>
                {(wards.data || []).map((w) => (
                  <option key={w.id} value={w.ward_id}>
                    {w.ward_type} ({w.ward_id})
                  </option>
                ))}
              </select>
            )}
          </div>
          {wardId ? (
            <div>
              <TabletLabel>Available bed / room *</TabletLabel>
              {occupied.isLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-7 w-7 animate-spin text-primary" />
                </div>
              ) : availableRooms.length === 0 ? (
                <p className="text-destructive">
                  No free beds in this ward — choose another ward.
                </p>
              ) : (
                <div className="grid grid-cols-5 gap-2 sm:grid-cols-8">
                  {availableRooms.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRoom(r)}
                      className={cn(
                        "h-14 rounded-xl text-lg font-semibold",
                        room === r
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted",
                      )}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      {step === "review" && (
        <div
          className={cn(
            envelopeClass,
            "grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2",
          )}
        >
          {reviewRows
            .filter(([, v]) => v && v.trim() && v.trim() !== "/" && v.trim() !== "—")
            .map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b pb-2">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="text-right font-medium">{v}</dd>
              </div>
            ))}
          {register.isError ? (
            <p className="pt-2 text-destructive sm:col-span-2">
              {(register.error as Error)?.message || "Could not register."}
            </p>
          ) : null}
        </div>
      )}
    </FlowScaffold>
  );
}
