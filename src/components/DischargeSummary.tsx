import React from "react";

/**
 * DischargeSummary
 * - Print‑ready A4 layout that mirrors the provided screenshot.
 * - TailwindCSS utility classes only. No external CSS needed.
 * - Pass your data via the `data` prop (see DemoData at bottom for shape).
 * - Click a "Print" button (optional) or call window.print() to export as PDF.
 */

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mb-4 break-inside-avoid">
    <h3 className="text-xs font-semibold tracking-wide text-gray-700 border-b border-gray-300 pb-1 mb-2">
      {title}
    </h3>
    {children}
  </section>
);

const KV = ({ label, value }: { label: string; value: string }) => (
  <div className="grid grid-cols-12 text-[10px]">
    <div className="col-span-4 text-gray-600">{label}</div>
    <div className="col-span-8 font-medium">{value || "—"}</div>
  </div>
);

const Table = ({ headers, rows, dense = false }: { headers: string[]; rows: string[][]; dense?: boolean }) => (
  <div className="overflow-hidden border border-gray-300 rounded">
    <table className={`w-full ${dense ? "text-[9.5px]" : "text-[10px]"}`}>
      <thead>
        <tr className="bg-gray-100">
          {headers.map((h, i) => (
            <th key={i} className="text-left font-semibold px-2 py-1 border-b border-gray-300">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td className="px-2 py-1" colSpan={headers.length}>
              No data
            </td>
          </tr>
        ) : (
          rows.map((r, i) => (
            <tr key={i} className="odd:bg-white even:bg-gray-50">
              {r.map((c, j) => (
                <td key={j} className="align-top px-2 py-1 border-t border-gray-200">
                  {c}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  </div>
);

interface DischargeSummaryData {
  header: { left: string; right: string };
  patient: {
    name: string;
    age: string;
    gender: string;
    address: string;
    visitId: string;
    registrationNo: string;
    relation: string;
    serviceNo: string;
    admission: string;
    discharge: string;
  };
  diagnoses: {
    primary: string[];
    secondary: string[];
  };
  medications: Array<{
    name: string;
    strength: string;
    route: string;
    dosageEn: string;
    dosageHi: string;
    duration: string;
  }>;
  complaints: string[];
  clinicalSummary: string;
  vitals: string[];
  investigations: string[];
  abnormalInvestigations: string[];
  surgical: {
    date: string;
    procedures: string[];
    surgeon: string;
  };
  intraOp: string;
  treatmentCourse: string[];
  condition: string[];
  followUp: {
    visit: string;
    medicationCompliance: string[];
  };
  woundCare: string[];
  activityDiet: string[];
  warnings: string[];
  contacts: string[];
  footer: {
    signName: string;
    signDesignation: string;
    hospital: string;
  };
}

export default function DischargeSummary({
  data,
  visitId,
  allPatientData,
  patientDataSummary
}: {
  data?: DischargeSummaryData;
  visitId?: string;
  allPatientData?: string;
  patientDataSummary?: string;
}) {
  console.log('🎯 DischargeSummary rendered with:', {
    hasData: !!data,
    visitId,
    hasAllPatientData: !!allPatientData,
    allPatientDataPreview: allPatientData?.substring(0, 200),
    hasPatientDataSummary: !!patientDataSummary
  });
  // Function to extract data from allPatientData text
  const extractDataFromText = (text: string) => {
    const extractedData: any = {};
    
    // Extract patient information - handle multiple formats
    const nameMatch = text.match(/Name:\s*([^\n\r]+)/i);
    const ageMatch = text.match(/Age:\s*([^\n\r]+)/i);
    const genderMatch = text.match(/Gender:\s*([^\n\r]+)/i);
    const addressMatch = text.match(/Address:\s*([^\n\r]+)/i);
    const visitIdMatch = text.match(/Visit ID:\s*([^\n\r]+)/i);
    const registrationMatch = text.match(/Registration No:\s*([^\n\r]+)/i);
    const relationMatch = text.match(/Relation:\s*([^\n\r]+)/i);
    const serviceMatch = text.match(/Service No:\s*([^\n\r]+)/i);
    const admissionMatch = text.match(/Admission:\s*([^\n\r]+)/i) || text.match(/Admission Date:\s*([^\n\r]+)/i);
    const dischargeMatch = text.match(/Discharge Date:\s*([^\n\r]*?)(?=\n|Primary|Secondary|Medications|$)/i);
    
    // Extract diagnoses - handle multiple formats (improved patterns)
    const diagnosisMatch = text.match(/(?:^|\n)Diagnosis:\s*([^\n\r]+)/i);
    const primaryDiagnosisMatch = text.match(/(?:^|\n)Primary Diagnosis:\s*([^\n\r]+)/i);
    const secondaryDiagnosisMatch = text.match(/(?:^|\n)Secondary Diagnosis:\s*([^\n\r]+)/i);

    // Additional fallback patterns for diagnosis extraction
    const generalDiagnosisMatch = text.match(/(?:^|\n)(?:Final\s+)?Diagnosis.*?:\s*([^\n\r]+)/i);
    const clinicalDiagnosisMatch = text.match(/(?:^|\n)Clinical Diagnosis:\s*([^\n\r]+)/i);
    
    // Extract medications - handle Treatment On Discharge format
    const medicationsMatch = text.match(/Medications:\s*([^\n\r]+)/i);
    const treatmentOnDischargeMatch = text.match(/Treatment On Discharge:\s*([^]*?)(?=\n\n|\n[A-Z]|$)/i);
    
    // Extract complaints - handle multiple formats
    const complaintsMatch = text.match(/Presenting Complaints:\s*([^]*?)(?=\n\n|\n[A-Z]|$)/i);
    const caseSummaryMatch = text.match(/Case Summary:Presenting Complaints:\s*([^]*?)(?=\n\n|\n[A-Z]|$)/i);
    
    // Extract vitals - handle Examination format
    const vitalsMatch = text.match(/Vital Signs:\s*([^]*?)(?=\n\n|\n[A-Z]|$)/i);
    const examinationMatch = text.match(/Examination:\s*([^]*?)(?=\n\n|\n[A-Z]|$)/i);
    
    // Extract investigations
    const investigationsMatch = text.match(/Investigations:\s*([^]*?)(?=\n\n|\n[A-Z]|$)/i);
    
    // Extract surgical details
    const surgicalMatch = text.match(/Surgical Details:\s*([^]*?)(?=\n\n|\n[A-Z]|$)/i);
    const procedureMatch = text.match(/Procedure:\s*([^]*?)(?=\n\n|\n[A-Z]|$)/i);
    
    // Extract treatment course
    const treatmentMatch = text.match(/Treatment Course:\s*([^]*?)(?=\n\n|\n[A-Z]|$)/i);
    
    // Extract discharge condition
    const conditionMatch = text.match(/Discharge Condition:\s*([^]*?)(?=\n\n|\n[A-Z]|$)/i);
    
    // Extract age and gender from case summary if not found directly
    let extractedAge = ageMatch ? ageMatch[1].trim() : 'N/A';
    let extractedGender = genderMatch ? genderMatch[1].trim() : 'N/A';
    let extractedName = nameMatch ? nameMatch[1].trim() : 'N/A';
    
    if (caseSummaryMatch) {
      const ageGenderMatch = caseSummaryMatch[1].match(/A\s*(\d+)\s*yrs?\s*(Male|Female)/i);
      if (ageGenderMatch) {
        extractedAge = ageGenderMatch[1];
        extractedGender = ageGenderMatch[2];
      }
      
      // Try to extract patient name from the case summary
      const patientNameMatch = caseSummaryMatch[1].match(/patient\s+([A-Za-z\s]+)\s+was\s+admitted/i);
      if (patientNameMatch && extractedName === 'N/A') {
        extractedName = patientNameMatch[1].trim();
      }
    }
    
    // Process vitals from examination
    const processedVitals: string[] = [];
    if (examinationMatch) {
      const examText = examinationMatch[1];
      const tempMatch = examText.match(/Temperature:\s*([^\s,]+)/i);
      const pulseMatch = examText.match(/Pulse Rate:\s*([^\s,]+)/i);
      const respMatch = examText.match(/Respiration Rate:\s*([^\s,]+)/i);
      const bpMatch = examText.match(/Blood Pressure:\s*([^\s,]+)/i);
      const spo2Match = examText.match(/SpO2:\s*([^\s,]+)/i);
      
      if (tempMatch) processedVitals.push(`Temperature: ${tempMatch[1]}`);
      if (pulseMatch) processedVitals.push(`Pulse Rate: ${pulseMatch[1]}`);
      if (respMatch) processedVitals.push(`Respiration Rate: ${respMatch[1]}`);
      if (bpMatch) processedVitals.push(`Blood Pressure: ${bpMatch[1]}`);
      if (spo2Match) processedVitals.push(`SpO2: ${spo2Match[1]}`);
    }
    
    // Process complaints from case summary
    const processedComplaints: string[] = [];
    if (caseSummaryMatch) {
      const complaintText = caseSummaryMatch[1];
      // Extract age and gender
      const ageGenderMatch = complaintText.match(/A\s*(\d+)\s*yrs?\s*(Male|Female)/i);
      if (ageGenderMatch) {
        processedComplaints.push(`${ageGenderMatch[1]} years old ${ageGenderMatch[2]} patient`);
      }
      
      // Extract main complaints
      const mainComplaintsMatch = complaintText.match(/Complaints of\s*([^.]*)/i);
      if (mainComplaintsMatch) {
        processedComplaints.push(mainComplaintsMatch[1].trim());
      }
      
      // Extract history
      const historyMatch = complaintText.match(/History of\s*([^.]*)/i);
      if (historyMatch) {
        processedComplaints.push(`History: ${historyMatch[1].trim()}`);
      }
    }
    
    // Process medications from Treatment On Discharge
    let processedMedications: string[] = [];
    if (treatmentOnDischargeMatch) {
      const treatmentText = treatmentOnDischargeMatch[1];
      const medicationMatches = treatmentText.match(/TAB\.[^,]+/g);
      if (medicationMatches) {
        processedMedications = medicationMatches.map(med => med.trim());
      }
    }
    
    return {
      name: extractedName,
      age: extractedAge,
      gender: extractedGender,
      address: addressMatch ? addressMatch[1].trim() : 'N/A',
      visitId: visitIdMatch ? visitIdMatch[1].trim() : visitId || 'H25C17002JJHH025001905F',
      registrationNo: registrationMatch ? registrationMatch[1].trim() : 'N/A',
      relation: relationMatch ? relationMatch[1].trim() : 'N/A',
      serviceNo: serviceMatch ? serviceMatch[1].trim() : 'N/A',
      admission: admissionMatch ? admissionMatch[1].trim() : 'N/A',
      discharge: dischargeMatch ? dischargeMatch[1].trim() : 'N/A',
      diagnosis: diagnosisMatch ? diagnosisMatch[1].trim() :
                 primaryDiagnosisMatch ? primaryDiagnosisMatch[1].trim() :
                 generalDiagnosisMatch ? generalDiagnosisMatch[1].trim() :
                 clinicalDiagnosisMatch ? clinicalDiagnosisMatch[1].trim() : 'N/A',
      secondaryDiagnosis: secondaryDiagnosisMatch ? secondaryDiagnosisMatch[1].trim() : 'N/A',
      medications: medicationsMatch ? medicationsMatch[1].trim() : treatmentOnDischargeMatch ? treatmentOnDischargeMatch[1].trim() : 'N/A',
      complaints: processedComplaints.length > 0 ? processedComplaints : (complaintsMatch ? complaintsMatch[1].trim().split('\n').filter(line => line.trim()) : []),
      vitals: processedVitals.length > 0 ? processedVitals : (vitalsMatch ? vitalsMatch[1].trim().split('\n').filter(line => line.trim()) : []),
      investigations: investigationsMatch ? investigationsMatch[1].trim().split('\n').filter(line => line.trim()) : [],
      surgical: surgicalMatch ? surgicalMatch[1].trim() : procedureMatch ? procedureMatch[1].trim() : 'N/A',
      treatment: treatmentMatch ? treatmentMatch[1].trim().split('\n').filter(line => line.trim()) : [],
      condition: conditionMatch ? conditionMatch[1].trim().split('\n').filter(line => line.trim()) : []
    };
  };

  // Use dynamic data if available, otherwise fall back to provided data
  const dynamicData = allPatientData ? extractDataFromText(allPatientData) : null;

  // Debug: Log the data to see what's being extracted
  console.log('🔍 allPatientData:', allPatientData);
  console.log('🔍 dynamicData:', dynamicData);

  // Extract additional data from patientDataSummary if available
  const summaryData = patientDataSummary ? extractDataFromText(patientDataSummary) : null;
  
  // Only use provided data - no fallback to demo data.
  //
  // Every list defaults to empty. The printable page at
  // /discharge-summary-print passes only `allPatientData` and never `data`, so
  // all of these were undefined; the guard below does not fire, because
  // allPatientData IS present; and the render then reached `medications.map`
  // on undefined and took the whole page down with "Cannot read properties of
  // undefined (reading 'map')". These lists are fallbacks for when the text
  // extraction finds nothing, so empty is exactly the right default.
  const {
    header,
    patient,
    diagnoses,
    medications = [],
    complaints = [],
    vitals = [],
    investigations = [],
    abnormalInvestigations = [],
    surgical,
    intraOp,
    treatmentCourse = [],
    condition = [],
    followUp,
    woundCare = [],
    activityDiet = [],
    warnings = [],
    contacts = [],
    footer
  } = data || {};

  // If no data is provided and no dynamic data available, show error
  if (!data && !allPatientData && !patientDataSummary) {
    return (
      <div className="w-full min-h-screen bg-white flex items-center justify-center">
        <div className="text-center p-8">
          <div className="text-red-500 mb-4">
            <svg className="h-16 w-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.728-.833-2.498 0L4.316 15.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-red-600 mb-4">No OPD Summary Data</h2>
          <p className="text-gray-600">No patient data available to generate discharge summary.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="discharge-summary w-full min-h-screen bg-neutral-200 print:bg-white py-6 print:py-0">
      {/* Page */}
      <div
        className="discharge-summary-content mx-auto bg-white shadow-sm print:shadow-none border border-gray-300 max-w-[830px] print:max-w-none print:border-0"
        style={{ width: "210mm" }}
      >
        {/* Top Bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-300">
          <div className="text-[10px] text-gray-500">{header?.left || new Date().toLocaleDateString()}</div>
          <div className="text-center">
            <h1 className="text-sm font-bold tracking-wide">**DISCHARGE SUMMARY**</h1>
          </div>
          <div className="text-[10px] text-gray-500">{header?.right || 'OPD Summary'}</div>
        </div>

        {/* Patient Card */}
        <div className="px-4 pt-3">
          <div className="border border-gray-300 rounded p-3">
            <h2 className="text-[11px] font-semibold mb-2">PATIENT DETAILS</h2>
            <div className="space-y-1">
              <KV label="Name" value={(dynamicData?.name && dynamicData.name !== 'N/A') ? dynamicData.name : patient?.name || 'Not available'} />
              <KV label="Age" value={(dynamicData?.age && dynamicData.age !== 'N/A') ? dynamicData.age : patient?.age || 'Not available'} />
              <KV label="Gender" value={(dynamicData?.gender && dynamicData.gender !== 'N/A') ? dynamicData.gender : patient?.gender || 'Not available'} />
              <KV label="Visit ID" value={(dynamicData?.visitId && dynamicData.visitId !== 'N/A') ? dynamicData.visitId : patient?.visitId || visitId || 'Not available'} />
              <KV label="Admission Date" value={(dynamicData?.admission && dynamicData.admission !== 'N/A') ? dynamicData.admission : patient?.admission || 'Not available'} />
              <KV label="Discharge Date" value={(dynamicData?.discharge && dynamicData.discharge !== 'N/A') ? dynamicData.discharge : patient?.discharge || 'Not available'} />
            </div>
          </div>
        </div>

        {/* Body Sections */}
        <div className="px-4 pb-4">
          {/* Diagnosis */}
          <Section title="FINAL DIAGNOSIS">
            <ul className="list-disc pl-5 text-[10px] space-y-0.5">
              <li>Primary Diagnosis: {dynamicData?.diagnosis || diagnoses?.primary?.[0] || 'Not recorded'}</li>
              <li>Secondary Diagnosis: {dynamicData?.secondaryDiagnosis || (diagnoses?.secondary && diagnoses.secondary.length > 0 ? diagnoses.secondary[0] : 'None recorded')}</li>
            </ul>
            {/* Debug info */}
            <div className="text-[8px] text-gray-400 mt-2 print:hidden">
              Debug: Using {dynamicData?.diagnosis ? 'database data' : diagnoses?.primary?.[0] ? 'structured data' : 'no data'}
            </div>
          </Section>

          {/* Meds */}
          <Section title="DISCHARGE MEDICATIONS">
            {allPatientData && allPatientData.includes('MEDICATIONS:') ? (
              <div className="text-[10px] p-3 bg-gray-50 rounded border">
                <p><strong>Prescribed Medications:</strong></p>
                <div className="mt-2 space-y-1">
                  {allPatientData.split('\n')
                    .filter(line => line.startsWith('Medication:'))
                    .map((med, index) => (
                      <div key={index} className="pl-2 border-l-2 border-green-200 bg-green-50 p-1 rounded">
                        {med.replace('Medication: ', '')}
                      </div>
                    ))}
                  {allPatientData.split('\n').filter(line => line.startsWith('Medication:')).length === 0 && (
                    <div className="text-gray-500 italic">No medications found</div>
                  )}
                </div>
              </div>
            ) : dynamicData?.medications && dynamicData.medications !== 'N/A' ? (
              <div className="text-[10px] p-3 bg-gray-50 rounded border">
                <p><strong>Treatment On Discharge:</strong></p>
                <div className="mt-2 space-y-1">
                  {dynamicData.medications.split(',').map((med, index) => (
                    <div key={index} className="pl-2 border-l-2 border-blue-200">
                      {med.trim()}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <Table
                headers={["Medication Name", "Strength", "Route", "Dosage (English)", "Dosage (Hindi)", "Duration"]}
                rows={medications.map((m) => [m.name, m.strength, m.route, m.dosageEn, m.dosageHi, m.duration])}
                dense
              />
            )}
          </Section>

          {/* Presenting Complaints */}
          <Section title="PRESENTING COMPLAINTS">
            <ul className="list-disc pl-5 text-[10px] space-y-0.5">
              {dynamicData?.complaints && dynamicData.complaints.length > 0 ? 
                dynamicData.complaints.map((c, i) => <li key={i}>{c}</li>) : 
                complaints.length ? complaints.map((c, i) => <li key={i}>{c}</li>) : <li>—</li>
              }
            </ul>
          </Section>

          {/* Clinical Summary */}
          <Section title="CLINICAL SUMMARY">
            {/* `data` is undefined whenever the summary is built from text
                rather than passed in, which is the case on the printable page. */}
            <p className="text-[10px] leading-snug text-gray-800 mb-2">{data?.clinicalSummary}</p>
            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-12 md:col-span-6">
                <h4 className="text-[10px] font-semibold mb-1">Vital Signs at Admission:</h4>
                <ul className="list-disc pl-5 text-[10px] space-y-0.5">
                  {dynamicData?.vitals && dynamicData.vitals.length > 0 ? 
                    dynamicData.vitals.map((v, i) => <li key={i}>{v}</li>) :
                    vitals.map((v, i) => <li key={i}>{v}</li>)
                  }
                </ul>
              </div>
              <div className="col-span-12 md:col-span-6">
                <h4 className="text-[10px] font-semibold mb-1">Laboratory Investigations:</h4>
                {allPatientData && allPatientData.includes('LABORATORY INVESTIGATIONS:') ? (
                  <div className="text-[9px] space-y-1 max-h-32 overflow-y-auto">
                    {allPatientData.split('\n')
                      .filter(line => line.startsWith('Lab:'))
                      .map((lab, i) => (
                        <div key={i} className="p-1 bg-blue-50 rounded border-l-2 border-blue-200">
                          {lab.replace('Lab: ', '')}
                        </div>
                      ))}
                    {allPatientData.split('\n').filter(line => line.startsWith('Lab:')).length === 0 && (
                      <div className="text-gray-500 italic">No lab investigations found</div>
                    )}
                  </div>
                ) : (
                  <ul className="list-disc pl-5 text-[10px] space-y-0.5">
                    {investigations.map((v, i) => <li key={i}>{v}</li>)}
                  </ul>
                )}

                <h4 className="text-[10px] font-semibold mb-1 mt-3">Radiology Investigations:</h4>
                {allPatientData && allPatientData.includes('RADIOLOGY INVESTIGATIONS:') ? (
                  <div className="text-[9px] space-y-1 max-h-32 overflow-y-auto">
                    {allPatientData.split('\n')
                      .filter(line => line.startsWith('Radiology:'))
                      .map((rad, i) => (
                        <div key={i} className="p-1 bg-purple-50 rounded border-l-2 border-purple-200">
                          {rad.replace('Radiology: ', '')}
                        </div>
                      ))}
                    {allPatientData.split('\n').filter(line => line.startsWith('Radiology:')).length === 0 && (
                      <div className="text-gray-500 italic">No radiology investigations found</div>
                    )}
                  </div>
                ) : (
                  <div className="text-gray-500 italic text-[9px]">Click "Fetch Data" to load radiology data</div>
                )}
              </div>
            </div>



            {/* Show normal investigations from patientDataSummary if available */}
            {(patientDataSummary && patientDataSummary.includes('**Normal Investigations:**')) && (
              <div className="mt-2">
                <h4 className="text-[10px] font-semibold mb-1">Normal Investigations:</h4>
                <div className="text-[9px] space-y-1 bg-green-50 p-2 rounded">
                  {patientDataSummary.split('**Normal Investigations:**')[1]
                    ?.split('**')[0]
                    ?.split('\n')
                    .filter(line => line.trim() && line.includes('-'))
                    .map((line, i) => (
                      <div key={i} className="text-green-700">
                        {line.trim()}
                      </div>
                    ))}
                </div>
              </div>
            )}


          </Section>



          {/* Intra‑op */}
          <Section title="INTRAOPERATIVE FINDINGS">
            <p className="text-[10px] leading-snug">{intraOp}</p>
          </Section>

          {/* Treatment Course / Hospital Course */}
          <Section title="TREATMENT COURSE IN HOSPITAL">
            {/* Show hospital course from patientDataSummary if available */}
            {(patientDataSummary && patientDataSummary.includes('**4. HOSPITAL COURSE**')) ? (
              <div className="text-[10px] leading-snug space-y-2">
                {patientDataSummary.split('**4. HOSPITAL COURSE**')[1]
                  ?.split('**')[0]
                  ?.split('\n')
                  .filter(line => line.trim())
                  .map((line, i) => (
                    <p key={i} className="text-gray-800">
                      {line.trim()}
                    </p>
                  ))}
              </div>
            ) : (
              <ul className="list-disc pl-5 text-[10px] space-y-0.5">
                {dynamicData?.treatment && dynamicData.treatment.length > 0 ?
                  dynamicData.treatment.map((t, i) => <li key={i}>{t}</li>) :
                  treatmentCourse.map((t, i) => <li key={i}>{t}</li>)
                }
              </ul>
            )}
          </Section>

          {/* Condition at Discharge */}
          <Section title="DISCHARGE CONDITION">
            <ul className="list-disc pl-5 text-[10px] space-y-0.5">
              {dynamicData?.condition && dynamicData.condition.length > 0 ? 
                dynamicData.condition.map((t, i) => <li key={i}>{t}</li>) :
                condition.map((t, i) => <li key={i}>{t}</li>)
              }
            </ul>
          </Section>

          {/* Follow‑Up */}
          <Section title="FOLLOW‑UP INSTRUCTIONS">
            <KV label="Visit" value={followUp.visit} />
            <div className="mt-2">
              <h4 className="text-[10px] font-semibold mb-1">Medication Compliance:</h4>
              <ul className="list-disc pl-5 text-[10px] space-y-0.5">
                {followUp.medicationCompliance.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          </Section>

          {/* Wound care */}
          <Section title="WOUND CARE">
            <ul className="list-disc pl-5 text-[10px] space-y-0.5">
              {woundCare.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </Section>

          {/* Activity & Diet */}
          <Section title="ACTIVITY & DIET">
            <ul className="list-disc pl-5 text-[10px] space-y-0.5">
              {activityDiet.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </Section>

          {/* Warning Signs */}
          <Section title="WARNING SIGNS – SEEK IMMEDIATE CARE IF:">
            <ul className="list-disc pl-5 text-[10px] space-y-0.5">
              {warnings.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </Section>

          {/* Contacts */}
          <Section title="EMERGENCY & URGENT CARE AVAILABLE 24×7">
            <div className="text-[10px]">
              <div className="flex items-center gap-2">
                <span className="font-semibold">Contact:</span>
                <span>{contacts.join(" / ")}</span>
              </div>
            </div>
          </Section>
        </div>

        {/* Footer */}
        <div className="px-4 pb-4">
          <div className="border border-gray-300 rounded p-3">
            <div className="text-[10px] space-y-1">
              <p className="font-semibold">{footer.signName}</p>
              <p>{footer.signDesignation}</p>
              <p>{footer.hospital}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Print button (hidden on print) */}
      <div className="max-w-[830px] mx-auto mt-4 flex gap-2 print:hidden">
        <button
          onClick={() => window.print()}
          className="px-3 py-2 text-sm rounded-xl border bg-white hover:bg-gray-50"
        >
          Print / Save as PDF
        </button>
      </div>
    </div>
  );
}

// ------------------------ DEMO DATA (replace with real data) ------------------------
export const DemoData: DischargeSummaryData = {
  header: { left: "8/20/25, 11:48 AM", right: "OPD Summary" },
  patient: {
    name: "NIYATI BAWANKAR",
    age: "3",
    gender: "Female",
    address: "KALMEGH HINGNA ROAD, NAGPUR",
    visitId: "IH24L12038",
    registrationNo: "UHHO25G01005",
    relation: "SELF",
    serviceNo: "N/A",
    admission: "2024-12-12",
    discharge: "2024-12-20"
  },
  diagnoses: {
    primary: ["Syncope with BPPV"],
    secondary: ["—"]
  },
  medications: [
    { name: "Cefixime", strength: "500 mg", route: "Oral", dosageEn: "Twice daily", dosageHi: "दिन में दो बार", duration: "10 days" }
  ],
  complaints: [
    "Severe pain in the right testis",
    "Scrotal swelling and edema",
    "Fever (98–102°F) lasting over 15–16 days",
    "History of Type 2 Diabetes Mellitus and Hypertension"
  ],
  clinicalSummary:
    "Patient had no history of trauma or prior surgery. On examination, significant swelling, tenderness, and redness were observed in the right scrotal area without discharge or foul odor. Systemically stable at presentation except for mild dehydration.",
  vitals: [
    "Temperature: 98°F",
    "Pulse: 88/min",
    "Respiratory Rate: 21/min",
    "BP: 140/86 mmHg",
    "SpO₂: 98% on room air"
  ],
  investigations: [
    "Complete Blood Count (CBC): Normal",
    "Blood Sugar (Random): 140 mg/dL",
    "Serum Creatinine: 1.2 mg/dL",
    "Blood Urea: 36 mg/dL",
    "Urine Routine: Within normal limits",
    "Chest X-Ray: Clear lung fields",
    "ECG: Normal sinus rhythm"
  ],
  abnormalInvestigations: [
    "White Blood Cell Count: 12,500/µL (Elevated)",
    "C-Reactive Protein (CRP): 45 mg/L (Raised)",
    "Erythrocyte Sedimentation Rate (ESR): 48 mm/hr (Raised)",
    "Ultrasound Scrotum: Heterogeneous echogenicity with fluid collection",
    "Blood Culture: Positive for Staphylococcus aureus"
  ],
  surgical: {
    date: "15/08/2025",
    procedures: [
      "Inguinal Herniotomy",
      "High Inguinal Orchidopexy",
      "Scrotal Exploration"
    ],
    surgeon: "Dr. Vishal Nandgawali"
  },
  intraOp:
    "Under spinal anesthesia, right inguinal exploration was performed for a painful right testicular mass with scrotal cellulitis. Intraoperatively, the right testis was found to be grossly infected and necrotic. A high inguinal orchiectomy was performed. Scrotal exploration revealed inflamed tissues with cellulitis; necrotic tissue was debrided, inguinal hernia sac was identified and hemorraphy was done. Hemostasis was achieved, and the scrotal cavity was thoroughly irrigated with antiseptic solution. A closed suction drain was placed. Wound was closed in layers. Patient tolerated the procedure well and was shifted to recovery in stable condition. Post‑operative antibiotics and monitoring initiated.",
  treatmentCourse: [
    "Initiated IV broad‑spectrum antibiotics (based on suspected infection)",
    "Anti‑inflammatory and analgesic therapy",
    "Intravenous fluid resuscitation",
    "Glycemic control achieved with insulin",
    "Antihypertensive therapy continued",
    "Close monitoring of renal function and vitals"
  ],
  condition: [
    "Afebrile, vitals stable",
    "Wound clean and healing well",
    "Ambulating and tolerating oral intake",
    "Diabetes and blood pressure under control",
    "No urinary complaints"
  ],
  followUp: {
    visit: "OPD follow‑up after 7 days from discharge or earlier if needed",
    medicationCompliance: [
      "Strict adherence to medication schedule",
      "Do not skip or alter dosage without medical advice"
    ]
  },
  woundCare: [
    "Keep surgical site dry and clean",
    "Change dressings as advised",
    "Report any pain, discharge, redness, or swelling",
    "Alternate day dressing as needed"
  ],
  activityDiet: [
    "No heavy lifting or strenuous activity for 6 weeks",
    "Adequate hydration and high‑protein diabetic‑friendly diet"
  ],
  warnings: [
    "Fever >100.5°F or chills",
    "Pain, redness, or discharge from surgical site",
    "Swelling, heaviness or tenderness in scrotum or groin",
    "Offensive odor or pus‑draining wound",
    "Chest pain or shortness of breath",
    "Persistent vomiting or dizziness"
  ],
  contacts: ["7030974619", "9373111709"],
  footer: {
    signName: "Dr. B.K. Murali",
    signDesignation: "MS (Orthopaedics)",
    hospital: "Director of Hope Group Of Hospital"
  }
};
