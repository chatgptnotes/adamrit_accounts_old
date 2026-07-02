
// @ts-nocheck

import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { User, Stethoscope, Scissors, Pill, TestTube, Activity, Edit, Trash2, Heart, Users, Microscope, Calendar, Printer, CreditCard, FileText, Upload } from 'lucide-react';
import { EditPatientDialog } from './EditPatientDialog';
import { DocumentUploadDialog } from './DocumentUploadDialog';
import { format } from 'date-fns';
import { Patient } from '@/types/patient';
import { getSanctionStatusColor } from '@/types/surgery';

interface PatientCardProps {
  patient: Patient;
  onEdit?: (updatedPatient: Patient) => void;
  onDelete?: () => void;
}

export const PatientCard: React.FC<PatientCardProps> = ({ patient, onEdit, onDelete }) => {
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDocumentUploadOpen, setIsDocumentUploadOpen] = useState(false);

  // Surgeries for this visit are preloaded by the patients list query
  // (usePatients embeds visit_surgeries) — no per-card DB query needed.
  const visitSurgeries = patient.visitSurgeries || [];

  // Visit ID is now included in the patient data
  const getVisitID = () => {
    return patient.visitIdDisplay || 'Not assigned';
  };

  const handleSave = (updatedPatient: Patient) => {
    if (onEdit) {
      onEdit(updatedPatient);
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Not set';
    try {
      return format(new Date(dateString), 'MMM dd, yyyy');
    } catch {
      return 'Not set';
    }
  };

  const formatDateShort = (dateString?: string) => {
    if (!dateString) return 'Not set';
    try {
      return format(new Date(dateString), 'dd/MM/yy');
    } catch {
      return 'Not set';
    }
  };

  const calculateDatePeriods = () => {
    const admissionDate = patient.admissionDate ? new Date(patient.admissionDate) : null;
    const surgeryDate = patient.surgeryDate ? new Date(patient.surgeryDate) : null;
    const dischargeDate = patient.dischargeDate ? new Date(patient.dischargeDate) : null;

    // Pre-Surgical: admission date to day before surgery
    const preSurgicalStart = admissionDate;
    const preSurgicalEnd = surgeryDate ? new Date(surgeryDate.getTime() - 24 * 60 * 60 * 1000) : null;

    // Surgical Package: surgery date to surgery date + 6 days (7 day package)
    const surgicalStart = surgeryDate;
    const surgicalEnd = surgeryDate ? new Date(surgeryDate.getTime() + 6 * 24 * 60 * 60 * 1000) : null;

    // Post-Surgical: day after surgical package ends to discharge date
    const postSurgicalStart = surgicalEnd ? new Date(surgicalEnd.getTime() + 24 * 60 * 60 * 1000) : null;
    const postSurgicalEnd = dischargeDate;

    return {
      preSurgical: preSurgicalStart && preSurgicalEnd ? 
        `${formatDateShort(preSurgicalStart.toISOString())} - ${formatDateShort(preSurgicalEnd.toISOString())}` : 
        'Not available',
      surgical: surgicalStart && surgicalEnd ? 
        `${formatDateShort(surgicalStart.toISOString())} - ${formatDateShort(surgicalEnd.toISOString())}` : 
        'Not available',
      postSurgical: postSurgicalStart && postSurgicalEnd ? 
        `${formatDateShort(postSurgicalStart.toISOString())} - ${formatDateShort(postSurgicalEnd.toISOString())}` : 
        'Not available'
    };
  };

  const datePeriods = calculateDatePeriods();

  const getPatientUID = () => {
    // Return the patients_id directly from the database
    return patient.patients_id || '';
  };

  const handlePrint = () => {
    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Patient Record: ${patient.name}</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            margin: 20px; 
            color: #333;
          }
          .header { 
            text-align: center; 
            margin-bottom: 30px; 
            border-bottom: 2px solid #2563eb; 
            padding-bottom: 20px;
          }
          .patient-name { 
            font-size: 24px; 
            font-weight: bold; 
            color: #2563eb; 
            margin-bottom: 10px;
          }
          .sr-bunch-numbers {
            font-size: 28px;
            font-weight: bold;
            color: #000;
            margin-bottom: 15px;
          }
          .patient-ids {
            font-size: 14px;
            color: #6b7280;
            margin-bottom: 10px;
          }
          .section { 
            margin-bottom: 25px; 
            padding: 15px;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
          }
          .section-title { 
            font-size: 16px; 
            font-weight: bold; 
            color: #1e40af; 
            margin-bottom: 15px;
            border-bottom: 1px solid #d1d5db;
            padding-bottom: 5px;
          }
          .field { 
            margin-bottom: 10px; 
            display: flex;
            justify-content: space-between;
          }
          .field-label { 
            font-weight: bold; 
            color: #6b7280;
            flex: 1;
          }
          .field-value { 
            flex: 2;
            text-align: left;
          }
          .complications-badge {
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: bold;
          }
          .complications-none {
            background-color: #f3f4f6;
            color: #6b7280;
          }
          .complications-present {
            background-color: #fee2e2;
            color: #dc2626;
          }
          .dates-grid {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 15px;
            margin-bottom: 20px;
          }
          .date-item {
            text-align: center;
            padding: 10px;
            border: 1px solid #e5e7eb;
            border-radius: 6px;
          }
          .date-label {
            font-size: 12px;
            color: #6b7280;
            margin-bottom: 5px;
          }
          .date-value {
            font-weight: bold;
          }
          @media print {
            body { margin: 0; }
            .section { break-inside: avoid; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="sr-bunch-numbers">
            <strong>Sr No:</strong> ${patient.srNo || ''} | <strong>Bunch No:</strong> ${patient.bunchNo || ''}
          </div>
          <div class="patient-name">${patient.name}</div>
          <div class="patient-ids">
            <strong>Patient UID:</strong> ${getPatientUID()} | <strong>Visit ID:</strong> ${getVisitID()}
          </div>
          <p>ESIC IPD Patient Record</p>
          <p><strong>Generated:</strong> ${new Date().toLocaleDateString()}</p>
        </div>

        <div class="dates-grid">
          <div class="date-item">
            <div class="date-label">Admission Date</div>
            <div class="date-value">${formatDate(patient.admissionDate)}</div>
          </div>
          <div class="date-item">
            <div class="date-label">Surgery Date</div>
            <div class="date-value">${formatDate(patient.surgeryDate)}</div>
          </div>
          <div class="date-item">
            <div class="date-label">Discharge Date</div>
            <div class="date-value">${formatDate(patient.dischargeDate)}</div>
          </div>
        </div>

        <div class="section">
          <div class="section-title">Treatment Periods</div>
          <div class="field">
            <span class="field-label">Pre-Surgical Period:</span>
            <span class="field-value">${datePeriods.preSurgical}</span>
          </div>
          <div class="field">
            <span class="field-label">Surgical Package Period:</span>
            <span class="field-value">${datePeriods.surgical}</span>
          </div>
          <div class="field">
            <span class="field-label">Post-Surgical Period:</span>
            <span class="field-value">${datePeriods.postSurgical}</span>
          </div>
        </div>

        <div class="section">
          <div class="section-title">Medical Information</div>
          <div class="field">
            <span class="field-label">Primary Diagnosis:</span>
            <span class="field-value">${patient.primaryDiagnosis}</span>
          </div>
          <div class="field">
            <span class="field-label">Complications:</span>
            <span class="field-value">
              <span class="complications-badge ${patient.complications === 'None' ? 'complications-none' : 'complications-present'}">
                ${patient.complications}
              </span>
            </span>
          </div>
          <div class="field">
            <span class="field-label">Surgery/Procedure:</span>
            <span class="field-value">${patient.surgery}</span>
          </div>
          ${visitSurgeries && visitSurgeries.length > 0 ? `
          <div class="field">
            <span class="field-label">Detailed Surgeries:</span>
            <span class="field-value">
              ${visitSurgeries.map(surgery => `• ${surgery.surgeryName || 'Unknown Surgery'} (${surgery.sanction_status})`).join('<br>')}
            </span>
          </div>` : ''}
        </div>

        <!-- Medical Information Note and Medical Team sections hidden as requested -->

        ${(patient.sstTreatment || patient.intimationDone || patient.cghsCode || patient.packageAmount || 
          patient.billingExecutive || patient.extensionTaken || patient.delayWaiverIntimation || 
          patient.surgicalApproval || patient.remark1 || patient.remark2) ? `
        <div class="section">
          <div class="section-title">Billing Information</div>
          ${patient.sstTreatment ? `
          <div class="field">
            <span class="field-label">SST/Secondary Treatment:</span>
            <span class="field-value">${patient.sstTreatment}</span>
          </div>` : ''}
          ${patient.intimationDone ? `
          <div class="field">
            <span class="field-label">Intimation Status:</span>
            <span class="field-value">${patient.intimationDone}</span>
          </div>` : ''}
          ${patient.cghsCode ? `
          <div class="field">
            <span class="field-label">CGHS Code/Approval:</span>
            <span class="field-value">${patient.cghsCode}</span>
          </div>` : ''}
          ${patient.packageAmount ? `
          <div class="field">
            <span class="field-label">Package Amount:</span>
            <span class="field-value">₹${patient.packageAmount}</span>
          </div>` : ''}
          ${patient.billingExecutive ? `
          <div class="field">
            <span class="field-label">Billing Executive:</span>
            <span class="field-value">${patient.billingExecutive}</span>
          </div>` : ''}
          ${patient.extensionTaken ? `
          <div class="field">
            <span class="field-label">Extension Status:</span>
            <span class="field-value">${patient.extensionTaken}</span>
          </div>` : ''}
          ${patient.delayWaiverIntimation ? `
          <div class="field">
            <span class="field-label">Delay Waiver:</span>
            <span class="field-value">${patient.delayWaiverIntimation}</span>
          </div>` : ''}
          ${patient.surgicalApproval ? `
          <div class="field">
            <span class="field-label">Surgical Approval:</span>
            <span class="field-value">${patient.surgicalApproval}</span>
          </div>` : ''}
          ${patient.remark1 ? `
          <div class="field">
            <span class="field-label">Remark 1:</span>
            <span class="field-value">${patient.remark1}</span>
          </div>` : ''}
          ${patient.remark2 ? `
          <div class="field">
            <span class="field-label">Remark 2:</span>
            <span class="field-value">${patient.remark2}</span>
          </div>` : ''}
        </div>` : ''}
      </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
      }, 250);
    }
  };


  return (
    <>
      <Card className="border-l-4 border-l-blue-500 hover:shadow-md transition-shadow">
        <CardContent className="p-6">
          <div className="flex justify-between items-start mb-4">
            <div className="flex items-center gap-2">
              <User className="h-5 w-5 text-blue-600" />
              <div>
                {/* Sr No and Bunch No moved above patient name */}
                <div className="flex items-center gap-6 mb-2">
                  <div className="bg-gray-100 px-4 py-2 rounded">
                    <span className="text-2xl font-bold text-black">Sr No:</span>
                    <span className="ml-2 text-2xl font-semibold text-black">{patient.srNo || ''}</span>
                  </div>
                  <div className="bg-gray-100 px-4 py-2 rounded">
                    <span className="text-2xl font-bold text-black">Bunch No:</span>
                    <span className="ml-2 text-2xl font-semibold text-black">{patient.bunchNo || ''}</span>
                  </div>
                </div>
                <h3 className="text-xl font-bold text-primary">
                  {patient.name}
                  {/* Show sample model for all matching patients */}
                  {(patient.name === '(ROSHANI BHISIKAR)' ||
                    patient.name === '(MS.ASHWINI) SHANKAR WAGHADE' ||
                    patient.name === '(Deepak Paripagar)' ||
                    patient.name === '(Pawan Kurvekar)' ||
                    patient.name === '(Meet Bais)' ||
                    patient.name === '(Pratik Rakhunde)' ||
                    patient.name === '(Yugansh Masram)') && (
                    <span className="text-red-500 ml-2 text-sm font-normal">sample model</span>
                  )}
                </h3>
                <div className="flex items-center gap-4 mt-1">
                  {getPatientUID() && (
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <CreditCard className="h-3 w-3" />
                      <span className="font-medium">UID:</span>
                      <span className="font-mono text-blue-600">{getPatientUID()}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <FileText className="h-3 w-3" />
                    <span className="font-medium">Visit ID:</span>
                    <span className="font-mono text-green-600">{getVisitID()}</span>
                  </div>
                </div>
                {/* Surgeries & Procedures moved to top */}
                <div className="mt-3">
                  <div className="flex items-start gap-2">
                    <Scissors className="h-4 w-4 text-blue-600 mt-1 flex-shrink-0" />
                    <div className="w-full">
                      <p className="text-sm font-medium text-muted-foreground mb-2">Surgeries & Procedures</p>
                      {visitSurgeries && visitSurgeries.length > 0 ? (
                        <div className="space-y-2">
                          {visitSurgeries.map((surgery, index) => (
                            <div key={surgery.id || index} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                              <span className="text-sm font-semibold flex-1">• {surgery.surgeryName || 'Unknown Surgery'}</span>
                              <Badge 
                                variant={surgery.sanction_status === 'Sanctioned' ? 'default' : 'secondary'} 
                                className="text-xs ml-2"
                              >
                                {surgery.sanction_status || 'Not Sanctioned'}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex items-center justify-between p-2 bg-gray-50 rounded">
                          <span className="text-sm font-semibold">No Surgery Assigned</span>
                          <Badge variant="secondary" className="text-xs">
                            Not Sanctioned
                          </Badge>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrint}
                className="h-8 w-8 p-0"
                title="Print patient record"
              >
                <Printer className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsDocumentUploadOpen(true)}
                className="h-8 w-8 p-0"
                title="Upload Documents"
              >
                <Upload className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEditDialogOpen(true)}
                className="h-8 w-8 p-0"
              >
                <Edit className="h-4 w-4" />
              </Button>
              {onDelete && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onDelete}
                  className="h-8 w-8 p-0 text-red-600 hover:text-red-700"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Date Information */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-blue-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Admission</p>
                <p className="text-sm">{formatDate(patient.admissionDate)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-green-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Surgery</p>
                <p className="text-sm">{formatDate(patient.surgeryDate)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-orange-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Discharge</p>
                <p className="text-sm">{formatDate(patient.dischargeDate)}</p>
              </div>
            </div>
          </div>

          {/* Treatment Period Information */}
          <div className="bg-blue-50 p-4 rounded-lg mb-4">
            <h4 className="text-sm font-semibold text-primary mb-3 flex items-center gap-2">
              📅 Treatment Periods
            </h4>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between p-2 bg-white rounded border">
                <span className="font-medium text-muted-foreground">Pre-Surgical Period:</span>
                <span className="font-semibold text-blue-600">{datePeriods.preSurgical}</span>
              </div>
              <div className="flex items-center justify-between p-2 bg-white rounded border">
                <span className="font-medium text-muted-foreground">Surgical Package Period:</span>
                <span className="font-semibold text-green-600">{datePeriods.surgical}</span>
              </div>
              <div className="flex items-center justify-between p-2 bg-white rounded border">
                <span className="font-medium text-muted-foreground">Post-Surgical Period:</span>
                <span className="font-semibold text-orange-600">{datePeriods.postSurgical}</span>
              </div>
            </div>
          </div>

          <Separator className="my-4" />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left Column - Patient Info */}
            <div className="space-y-4">
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Primary Diagnosis</p>
                  <p className="text-sm">{patient.primaryDiagnosis}</p>
                </div>
                
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Complications</p>
                  <Badge variant={patient.complications === 'None' ? 'secondary' : 'destructive'} className="text-xs">
                    {patient.complications}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Right Column - Visit Dates */}
            <div className="space-y-4">
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Admission Date</p>
                  <p className="text-sm">{formatDate(patient.admissionDate)}</p>
                </div>

                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Surgery Date</p>
                  <p className="text-sm">{formatDate(patient.surgeryDate)}</p>
                </div>

                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Discharge Date</p>
                  <p className="text-sm">{formatDate(patient.dischargeDate)}</p>
                </div>
              </div>
            </div>
          </div>
          
          {/* Medical Team and Medical Information sections hidden as requested */}
          <Separator className="my-4" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <Heart className="h-4 w-4 text-pink-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Hope Surgeon</p>
                <p className="text-sm font-semibold">{patient.hopeSurgeon || 'Not assigned'}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-purple-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Hope Consultants for IPD visits</p>
                <p className="text-sm font-semibold">{patient.hopeConsultants || 'Not assigned'}</p>
              </div>
            </div>
          </div>

          {/* Patient Data Table Information - Show all fields if source is patient_data_table */}
          {patient.source === 'patient_data_table' && (
            <>
              <Separator className="my-4" />
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-primary flex items-center gap-2">
                  📋 Patient Data Information
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  {patient.srNo && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">Sr. No:</span>
                      <span>{patient.srNo}</span>
                    </div>
                  )}
                  {patient.mrn && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">MRN:</span>
                      <span className="font-mono text-blue-600">{patient.mrn}</span>
                    </div>
                  )}
                  {patient.patientType && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">Patient Type:</span>
                      <Badge variant="outline" className="text-xs">{patient.patientType}</Badge>
                    </div>
                  )}
                  {patient.referralOriginalYesNo && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">Referral Original:</span>
                      <Badge variant={patient.referralOriginalYesNo === 'Yes' ? 'default' : 'secondary'} className="text-xs">{patient.referralOriginalYesNo}</Badge>
                    </div>
                  )}
                  {patient.ePahachanCardYesNo && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">E-Pahachan Card:</span>
                      <Badge variant={patient.ePahachanCardYesNo === 'Yes' ? 'default' : 'secondary'} className="text-xs">{patient.ePahachanCardYesNo}</Badge>
                    </div>
                  )}
                  {patient.hitlabhOrEntitelmentBenefitsYesNo && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">Entitlement Benefits:</span>
                      <Badge variant={patient.hitlabhOrEntitelmentBenefitsYesNo === 'Yes' ? 'default' : 'secondary'} className="text-xs">{patient.hitlabhOrEntitelmentBenefitsYesNo}</Badge>
                    </div>
                  )}
                  {patient.adharCardYesNo && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">Aadhar Card:</span>
                      <Badge variant={patient.adharCardYesNo === 'Yes' ? 'default' : 'secondary'} className="text-xs">{patient.adharCardYesNo}</Badge>
                    </div>
                  )}
                  {patient.claimId && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">Claim ID:</span>
                      <span className="font-mono text-green-600">{patient.claimId}</span>
                    </div>
                  )}
                  {patient.intimationDoneNotDone && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">Intimation Status:</span>
                      <Badge variant={patient.intimationDoneNotDone === 'Done' ? 'default' : 'secondary'} className="text-xs">{patient.intimationDoneNotDone}</Badge>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Surgery Information Section for Patient Data */}
          {patient.source === 'patient_data_table' && (patient.diagnosisAndSurgeryPerformed || patient.surgeryNameWithCghsAmountWithCghsCode ||
            patient.surgery1InReferralLetter || patient.surgery2 || patient.surgery3 || patient.surgery4 ||
            patient.dateOfSurgery || patient.cghsCodeUnlistedWithApprovalFromEsic) && (
            <>
              <Separator className="my-4" />
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-primary flex items-center gap-2">
                  🏥 Surgery Details
                </h4>
                <div className="grid grid-cols-1 gap-4 text-sm">
                  {patient.diagnosisAndSurgeryPerformed && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">Diagnosis & Surgery:</span>
                      <span className="flex-1">{patient.diagnosisAndSurgeryPerformed}</span>
                    </div>
                  )}
                  {patient.surgeryNameWithCghsAmountWithCghsCode && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">Surgery with CGHS Code:</span>
                      <span className="flex-1">{patient.surgeryNameWithCghsAmountWithCghsCode}</span>
                    </div>
                  )}
                  {patient.dateOfSurgery && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">Surgery Date:</span>
                      <span className="flex-1 font-semibold text-blue-600">{patient.dateOfSurgery}</span>
                    </div>
                  )}
                  {patient.surgery1InReferralLetter && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">Surgery 1 (Referral):</span>
                      <span className="flex-1">{patient.surgery1InReferralLetter}</span>
                    </div>
                  )}
                  {patient.surgery2 && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">Surgery 2:</span>
                      <span className="flex-1">{patient.surgery2}</span>
                    </div>
                  )}
                  {patient.surgery3 && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">Surgery 3:</span>
                      <span className="flex-1">{patient.surgery3}</span>
                    </div>
                  )}
                  {patient.surgery4 && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">Surgery 4:</span>
                      <span className="flex-1">{patient.surgery4}</span>
                    </div>
                  )}
                  {patient.cghsCodeUnlistedWithApprovalFromEsic && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">CGHS Unlisted Code:</span>
                      <span className="flex-1">{patient.cghsCodeUnlistedWithApprovalFromEsic}</span>
                    </div>
                  )}
                  {patient.cghsPackageAmountApprovedUnlistedAmount && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">CGHS Package Amount:</span>
                      <span className="flex-1 font-semibold text-green-600">₹{patient.cghsPackageAmountApprovedUnlistedAmount}</span>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Administrative Information Section for Patient Data */}
          {patient.source === 'patient_data_table' && (patient.extensionTakenNotTakenNotRequired ||
            patient.delayWaiverForIntimationBillSubmissionTakenNotRequired ||
            patient.surgicalAdditionalApprovalTakenNotTakenNotRequiredBoth) && (
            <>
              <Separator className="my-4" />
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-primary flex items-center gap-2">
                  📋 Administrative Status
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  {patient.extensionTakenNotTakenNotRequired && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">Extension Status:</span>
                      <Badge variant="outline" className="text-xs">{patient.extensionTakenNotTakenNotRequired}</Badge>
                    </div>
                  )}
                  {patient.delayWaiverForIntimationBillSubmissionTakenNotRequired && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">Delay Waiver:</span>
                      <Badge variant="outline" className="text-xs">{patient.delayWaiverForIntimationBillSubmissionTakenNotRequired}</Badge>
                    </div>
                  )}
                  {patient.surgicalAdditionalApprovalTakenNotTakenNotRequiredBoth && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">Surgical Approval:</span>
                      <Badge variant="outline" className="text-xs">{patient.surgicalAdditionalApprovalTakenNotTakenNotRequiredBoth}</Badge>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Billing Information Section */}
          {(patient.intimationDone || patient.cghsCode || patient.packageAmount ||
            patient.billingExecutive || patient.extensionTaken || patient.delayWaiverIntimation ||
            patient.surgicalApproval || patient.remark1 || patient.remark2 ||
            patient.totalPackageAmount || patient.billAmount || patient.paymentStatus) && (
            <>
              <Separator className="my-4" />
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-primary flex items-center gap-2">
                  💰 Billing Information
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  {patient.intimationDone && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">Intimation Status:</span>
                      <Badge variant={patient.intimationDone === 'Done' ? 'default' : 'secondary'} className="text-xs">
                        {patient.intimationDone}
                      </Badge>
                    </div>
                  )}
                  {patient.cghsCode && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">CGHS Code/Approval:</span>
                      <span className="flex-1">{patient.cghsCode}</span>
                    </div>
                  )}
                  {patient.packageAmount && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">Package Amount:</span>
                      <span className="flex-1 font-semibold text-green-600">₹{patient.packageAmount}</span>
                    </div>
                  )}
                  {patient.billingExecutive && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">Billing Executive:</span>
                      <span className="flex-1">{patient.billingExecutive}</span>
                    </div>
                  )}
                  {patient.extensionTaken && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">Extension Status:</span>
                      <Badge variant={patient.extensionTaken === 'Taken' ? 'default' : 'secondary'} className="text-xs">
                        {patient.extensionTaken}
                      </Badge>
                    </div>
                  )}
                  {patient.delayWaiverIntimation && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">Delay Waiver:</span>
                      <Badge variant={patient.delayWaiverIntimation === 'Taken' ? 'default' : 'secondary'} className="text-xs">
                        {patient.delayWaiverIntimation}
                      </Badge>
                    </div>
                  )}
                  {patient.surgicalApproval && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">Surgical Approval:</span>
                      <Badge variant={patient.surgicalApproval === 'Taken' ? 'default' : 'secondary'} className="text-xs">
                        {patient.surgicalApproval}
                      </Badge>
                    </div>
                  )}

                  {/* Patient Data specific billing fields */}
                  {patient.totalPackageAmount && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">Total Package Amount:</span>
                      <span className="flex-1 font-semibold text-green-600">₹{patient.totalPackageAmount}</span>
                    </div>
                  )}
                  {patient.billAmount && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">Bill Amount:</span>
                      <span className="flex-1 font-semibold text-blue-600">₹{patient.billAmount}</span>
                    </div>
                  )}
                  {patient.paymentStatus && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">Payment Status:</span>
                      <Badge variant={patient.paymentStatus === 'Paid' ? 'default' : 'destructive'} className="text-xs">{patient.paymentStatus}</Badge>
                    </div>
                  )}
                  {patient.billMadeByNameOfBillingExecutive && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">Billing Executive:</span>
                      <span className="flex-1">{patient.billMadeByNameOfBillingExecutive}</span>
                    </div>
                  )}
                  {patient.onPortalSubmissionDate && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">Portal Submission Date:</span>
                      <span className="flex-1">{patient.onPortalSubmissionDate}</span>
                    </div>
                  )}
                  {patient.remark1 && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">Remark 1:</span>
                      <span className="flex-1">{patient.remark1}</span>
                    </div>
                  )}
                  {patient.remark2 && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-muted-foreground min-w-[140px]">Remark 2:</span>
                      <span className="flex-1">{patient.remark2}</span>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <EditPatientDialog
        isOpen={isEditDialogOpen}
        onClose={() => setIsEditDialogOpen(false)}
        patient={patient}
        onSave={handleSave}
      />

      <DocumentUploadDialog
        isOpen={isDocumentUploadOpen}
        onClose={() => setIsDocumentUploadOpen(false)}
        patientName={patient.name}
        visitId={getVisitID()}
      />
    </>
  );
};
