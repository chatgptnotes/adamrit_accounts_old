import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, FileText, Check, X, AlertCircle, Printer, Eye, Download, Image, GripVertical, Plus, Edit2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { captureGeolocation, geoToDbFields } from '@/lib/geotag';
import { stampGeotagOnImage } from '@/lib/geotagImage';

interface DocumentUploadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  patientName: string;
  visitId: string;
}

interface DocumentStatus {
  id: number;
  name: string;
  isUploaded: boolean;
  fileName?: string;
  fileUrl?: string;
  uploadedAt?: string;
  remarkReason?: string;
  fileType?: string;
  filePreview?: string; // Base64 preview for images
  remarkOnly?: boolean; // For items that only have remark, no upload
  remarkStatus?: 'Yes' | 'No' | '' | 'Select'; // For remark-only items yes/no status
  isEditingName?: boolean; // Whether the name field is in edit mode
}

interface PatientDocument {
  id?: number;
  visit_id: string;
  patient_id: string;
  document_type_id: number;
  document_name: string;
  file_name: string | null;
  file_path: string | null;
  file_size: number | null;
  file_type: string | null;
  is_uploaded: boolean;
  uploaded_at: string | null;
  remarks: string | null;
  remark_reason: string | null;
  created_at?: string;
  updated_at?: string;
}

const MEDICAL_DOCUMENTS: DocumentStatus[] = [
  { id: 1, name: "Referral Letter from ESIC (Original Copy) with signature of IP", isUploaded: false },
  { id: 2, name: "ESIC e-Pehchan Card", isUploaded: false },
  { id: 3, name: "HITLABH or Entitlement Form (Two Pages)", isUploaded: false },
  { id: 4, name: "Aadhar Card or Other ID Proof (PAN / Driving License)", isUploaded: false },
  { id: 5, name: "Patient Satisfaction Certificate (P-VI) signed by patient or IP", isUploaded: false },
  { id: 6, name: "Approved Extension of Stay", isUploaded: false },
  { id: 7, name: "Approval for Listed / Unlisted Procedures", isUploaded: false },
  { id: 8, name: "Condonation or Delay Waiver for Intimation / Bill Submission", isUploaded: false },
  { id: 9, name: "P2 form / Individual Bill Format with Photo & Signature of Patient", isUploaded: false },
  { id: 10, name: "Original Final Bill / Invoice with stamp & signature. This is to be Signed by Patient or IP", isUploaded: false },
  { id: 11, name: "O.T. Notes and Surgeon Notes with sign and stamp", isUploaded: false },
  { id: 12, name: "Discharge Summary / DAMA / Death Summary with Stamp & Sign", isUploaded: false },
  { id: 13, name: "Pathology Break-up & Pathology Reports", isUploaded: false },
  { id: 14, name: "CT / X Ray & Radiology Reports", isUploaded: false },
  { id: 15, name: "ECG / USG Reports / 2D Echo / EEG-NCV & Diagnostic Reports", isUploaded: false },
  { id: 16, name: "Blood Components with MICR Code Sticker", isUploaded: false },
  { id: 17, name: "Pharmacy Bill Sticker / Empty Cartons / Packing Etc.", isUploaded: false },
  { id: 18, name: "Pharmacy Breakup Summary, Prescriptions & Bills (must be duly signed & stamped)", isUploaded: false },
  { id: 19, name: "Nursing Chart, Vitals, Rappers / Caution / Packing etc. of Medicines having MRP > Rs.100/-", isUploaded: false },
  { id: 20, name: "Treatment Sheets duly filled, signed and stamped", isUploaded: false },
  { id: 21, name: "RBS Chart signed and stamped", isUploaded: false },
  { id: 22, name: "Insurance Policy documents", isUploaded: false },
  { id: 23, name: "Photographs of Patient", isUploaded: false },
  { id: 24, name: "Stamp & Sign", isUploaded: false, remarkOnly: true },
  { id: 25, name: "PDF", isUploaded: false, remarkOnly: true },
  { id: 26, name: "Portal Submission", isUploaded: false, remarkOnly: true },
  { id: 27, name: "Admission Notes", isUploaded: false, remarkOnly: true }
];
// ─── SortableDocumentRow ────────────────────────────────────────────────────

interface SortableDocumentRowProps {
  doc: DocumentStatus;
  index: number;
  uploadingId: number | null;
  visitId: string;
  onNameChange: (id: number, name: string) => void;
  onNameEditToggle: (id: number, editing: boolean) => void;
  onFileUpload: (id: number, e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveFile: (id: number) => void;
  onRemarkReasonChange: (id: number, reason: string) => void;
  onRemarkStatusChange: (id: number, status: 'Yes' | 'No') => void;
  onPreviewClick: (doc: DocumentStatus) => void;
  onDownloadClick: (doc: DocumentStatus) => void;
}

const SortableDocumentRow: React.FC<SortableDocumentRowProps> = ({
  doc,
  index,
  uploadingId,
  visitId,
  onNameChange,
  onNameEditToggle,
  onFileUpload,
  onRemoveFile,
  onRemarkReasonChange,
  onRemarkStatusChange,
  onPreviewClick,
  onDownloadClick,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: doc.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (doc.isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [doc.isEditingName]);

  return (
    <TableRow ref={setNodeRef} style={style} className="group">
      {/* Drag handle */}
      <TableCell className="w-8 p-1">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 flex items-center justify-center w-full"
          title="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </TableCell>

      {/* Sr. No */}
      <TableCell className="font-medium">{index + 1}</TableCell>

      {/* Document Name — editable */}
      <TableCell>
        <div className="space-y-2">
          {doc.isEditingName ? (
            <Input
              ref={nameInputRef}
              value={doc.name}
              onChange={(e) => onNameChange(doc.id, e.target.value)}
              onBlur={() => onNameEditToggle(doc.id, false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onNameEditToggle(doc.id, false);
                if (e.key === 'Escape') onNameEditToggle(doc.id, false);
              }}
              className="h-7 text-sm font-medium"
            />
          ) : (
            <div className="flex items-start gap-1 group/name">
              <p className="text-sm font-medium flex-1">{doc.name || <em className="text-gray-400">Unnamed document</em>}</p>
              <button
                onClick={() => onNameEditToggle(doc.id, true)}
                className="opacity-0 group-hover/name:opacity-100 transition-opacity text-gray-400 hover:text-blue-600 flex-shrink-0 mt-0.5"
                title="Edit document name"
              >
                <Edit2 className="h-3 w-3" />
              </button>
            </div>
          )}
          {doc.fileName && (
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground">📎 {doc.fileName}</p>
              <Badge variant="outline" className="text-xs">
                {doc.fileType?.split('/')[1]?.toUpperCase() || 'FILE'}
              </Badge>
            </div>
          )}
          {doc.uploadedAt && (
            <p className="text-xs text-green-600">
              ✓ Uploaded on {new Date(doc.uploadedAt).toLocaleDateString()}
            </p>
          )}
        </div>
      </TableCell>

      {/* Remark Reason */}
      <TableCell>
        <Input
          type="text"
          placeholder="Enter reason..."
          value={doc.remarkReason || ''}
          onChange={(e) => onRemarkReasonChange(doc.id, e.target.value)}
          className="h-8 text-sm"
        />
      </TableCell>

      {/* Upload */}
      <TableCell>
        <div className="flex items-center gap-2">
          {doc.remarkOnly ? (
            <span className="text-sm text-muted-foreground px-3 py-2">Remark only</span>
          ) : !doc.isUploaded ? (
            <>
              <Input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                onChange={(e) => onFileUpload(doc.id, e)}
                disabled={uploadingId === doc.id}
                className="hidden"
                id={`file-${doc.id}`}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => document.getElementById(`file-${doc.id}`)?.click()}
                disabled={uploadingId === doc.id}
                className="h-8"
              >
                <Upload className="h-3 w-3 mr-1" />
                {uploadingId === doc.id ? 'Uploading...' : 'Upload'}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onRemoveFile(doc.id)}
              className="h-8 text-red-600 hover:text-red-700"
            >
              <X className="h-3 w-3 mr-1" />
              Remove
            </Button>
          )}
        </div>
      </TableCell>

      {/* Remark status */}
      <TableCell>
        <div className="flex items-center justify-center">
          {doc.remarkOnly ? (
            <Select
              value={doc.remarkStatus || 'Select'}
              onValueChange={(value: 'Yes' | 'No' | 'Select') => {
                if (value !== 'Select') onRemarkStatusChange(doc.id, value as 'Yes' | 'No');
              }}
            >
              <SelectTrigger className="w-20 h-8">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent
                className="bg-white border shadow-lg z-50"
                onPointerDownOutside={(e) => e.preventDefault()}
                onInteractOutside={(e) => e.preventDefault()}
              >
                <SelectItem value="Yes">Yes</SelectItem>
                <SelectItem value="No">No</SelectItem>
              </SelectContent>
            </Select>
          ) : doc.isUploaded ? (
            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
              <Check className="h-3 w-3 mr-1" />
              Yes
            </Badge>
          ) : (
            <Badge variant="secondary" className="bg-red-100 text-red-800">
              <X className="h-3 w-3 mr-1" />
              No
            </Badge>
          )}
        </div>
      </TableCell>

      {/* Preview */}
      <TableCell>
        <div className="flex items-center justify-center">
          {doc.isUploaded ? (
            <div className="relative group/preview">
              {doc.filePreview && doc.fileType?.includes('image') ? (
                <div className="relative">
                  <img
                    src={doc.filePreview}
                    alt={doc.fileName}
                    className="w-12 h-12 rounded border object-cover cursor-pointer hover:scale-105 transition-transform"
                    onClick={() => onPreviewClick(doc)}
                  />
                  <div className="absolute inset-0 bg-black bg-opacity-0 group-hover/preview:bg-opacity-30 rounded flex items-center justify-center transition-all duration-200">
                    <Eye className="h-4 w-4 text-white opacity-0 group-hover/preview:opacity-100 transition-opacity" />
                  </div>
                </div>
              ) : (
                <div
                  className="w-12 h-12 rounded border flex items-center justify-center bg-gray-100 cursor-pointer hover:bg-gray-200 transition-colors"
                  onClick={() => onPreviewClick(doc)}
                >
                  {doc.fileType?.includes('pdf') ? (
                    <FileText className="h-6 w-6 text-red-500" />
                  ) : doc.fileType?.includes('image') ? (
                    <Image className="h-6 w-6 text-green-500" />
                  ) : (
                    <FileText className="h-6 w-6 text-blue-500" />
                  )}
                </div>
              )}
              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover/preview:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                {doc.fileType?.includes('pdf') ? 'Click to preview PDF' : 'Click to view full size'}
              </div>
            </div>
          ) : (
            <div className="w-12 h-12 rounded border-2 border-dashed border-gray-300 flex items-center justify-center bg-gray-50">
              <Upload className="h-4 w-4 text-gray-400" />
            </div>
          )}
        </div>
      </TableCell>

      {/* Download */}
      <TableCell>
        <div className="flex items-center justify-center">
          {doc.remarkOnly ? (
            <span className="text-sm text-muted-foreground">-</span>
          ) : doc.isUploaded && doc.fileUrl ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 flex items-center gap-1"
              title={`Download ${doc.fileName}`}
              onClick={() => onDownloadClick(doc)}
            >
              <Download className="h-4 w-4" />
              Download
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-8 opacity-50 cursor-not-allowed"
              disabled
            >
              <Download className="h-4 w-4" />
              Download
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
};

// ─── Main Component ──────────────────────────────────────────────────────────

export const DocumentUploadDialog: React.FC<DocumentUploadDialogProps> = ({
  isOpen,
  onClose,
  patientName,
  visitId
}) => {
  const [documents, setDocuments] = useState<DocumentStatus[]>(MEDICAL_DOCUMENTS);
  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const [alertMessage, setAlertMessage] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [srNo, setSrNo] = useState<string>('');
  const [bunchNo] = useState<string>(''); // Placeholder for bunch number

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setDocuments((prev) => {
        const oldIndex = prev.findIndex((d) => d.id === active.id);
        const newIndex = prev.findIndex((d) => d.id === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  };

  // Name editing handlers
  const handleNameChange = (id: number, name: string) => {
    setDocuments((prev) => prev.map((d) => (d.id === id ? { ...d, name } : d)));
  };

  const handleNameEditToggle = (id: number, editing: boolean) => {
    setDocuments((prev) => prev.map((d) => (d.id === id ? { ...d, isEditingName: editing } : d)));
  };

  // Add new document row
  const handleAddDocument = () => {
    const maxId = documents.reduce((max, d) => Math.max(max, d.id), 0);
    const newDoc: DocumentStatus = {
      id: maxId + 1,
      name: '',
      isUploaded: false,
      isEditingName: true,
    };
    setDocuments((prev) => [...prev, newDoc]);
  };

  const fetchVisitDetails = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('visits')
        .select('sr_no')
        .eq('visit_id', visitId)
        .maybeSingle();

      if (error) {
        console.warn('Could not fetch visit details:', error);
        return;
      }

      if (data) {
        setSrNo(data.sr_no || '');
      }
    } catch (error) {
      console.warn('Error fetching visit details:', error);
    }
  }, [visitId]);

  const loadDocumentsFromDB = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('patient_documents')
        .select('*')
        .eq('visit_id', visitId);

      if (error) {
        console.warn('Could not load documents from database:', error);
        return;
      }

      if (data && data.length > 0) {
        setDocuments(prev =>
          prev.map(doc => {
            // @ts-expect-error - Temporary fix for Supabase type issues
            const existingDoc = (data as any[]).find(d => d.document_type_id === doc.id);
            if (existingDoc) {
              // Try to get preview from localStorage first
              // @ts-expect-error - Temporary fix for Supabase type issues
              const previewKey = `doc_preview_${visitId}_${existingDoc.document_type_id}`;
              let filePreview = localStorage.getItem(previewKey) || '';

              // If no preview in localStorage and it's an image, create a placeholder
              // @ts-expect-error - Temporary fix for Supabase type issues
              if (!filePreview && existingDoc.file_type && existingDoc.file_type.startsWith('image/')) {
                filePreview = 'data:image/svg+xml;base64,' + btoa(`
                  <svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
                    <rect width="100" height="100" fill="#e1f5fe"/>
                    <circle cx="35" cy="35" r="8" fill="#4fc3f7"/>
                    <path d="M20 65 L35 50 L50 65 L65 45 L80 65 Z" fill="#29b6f6"/>
                    <rect x="15" y="15" width="70" height="55" fill="none" stroke="#4fc3f7" stroke-width="2" rx="5"/>
                    <text x="50" y="85" text-anchor="middle" font-family="Arial" font-size="10" fill="#0277bd">Image Preview</text>
                  </svg>
                `);
              }

              // Get public URL for the file if it exists in storage
              let publicUrl = '';
              // @ts-expect-error - Temporary fix for Supabase type issues
              if (existingDoc.file_path && existingDoc.is_uploaded) {
                // @ts-expect-error - Temporary fix for Supabase type issues
                const { data: { publicUrl: url } } = supabase.storage
                  .from('patient-documents')
                  // @ts-expect-error - Temporary fix for Supabase type issues
                  .getPublicUrl(existingDoc.file_path);
                publicUrl = url;
              }

              return {
                ...doc,
                // @ts-expect-error - Temporary fix for Supabase type issues
                isUploaded: existingDoc.is_uploaded || false,
                // @ts-expect-error - Temporary fix for Supabase type issues
                fileName: existingDoc.file_name || undefined,
                fileUrl: publicUrl || undefined,
                // @ts-expect-error - Temporary fix for Supabase type issues
                uploadedAt: existingDoc.uploaded_at || undefined,
                // @ts-expect-error - Temporary fix for Supabase type issues
                fileType: existingDoc.file_type || undefined,
                filePreview: filePreview || undefined,
                // @ts-expect-error - Temporary fix for Supabase type issues
                remarkReason: existingDoc.remark_reason || '',
                // @ts-expect-error - Load remark status for remark-only items
                remarkStatus: doc.remarkOnly ? (existingDoc.remarks || 'Select') : undefined
              };
            } else {
              // For remark-only documents that don't exist in DB, set default remarkStatus
              return {
                ...doc,
                remarkStatus: doc.remarkOnly ? 'Select' : undefined
              };
            }
          })
        );
      } else {
        // If no data exists, initialize remark-only documents with default status
        setDocuments(prev =>
          prev.map(doc => ({
            ...doc,
            remarkStatus: doc.remarkOnly ? 'Select' : undefined
          }))
        );
      }
    } catch (error) {
      console.warn('Error loading documents:', error);
    }
  }, [visitId]);

  // Load existing documents from database when dialog opens
  useEffect(() => {
    if (isOpen && visitId !== 'Not assigned') {
      loadDocumentsFromDB();
      fetchVisitDetails();
    }
  }, [isOpen, visitId, loadDocumentsFromDB, fetchVisitDetails]);

  const handleFileUpload = async (documentId: number, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setAlertMessage({
        type: 'error',
        message: 'File size must be less than 10MB'
      });
      return;
    }

    setUploadingId(documentId);
    setAlertMessage(null);

    try {
      let uploadFile: File | Blob = file;
      let uploadFileName = file.name;
      let uploadFileType = file.type;
      let uploadGeo = null;

      if (file.type.startsWith('image/')) {
        uploadGeo = await captureGeolocation();
        const stamped = await stampGeotagOnImage(file, uploadGeo, {
          fileName: file.name,
          fileType: file.type,
        });
        uploadFile = stamped.blob;
        uploadFileName = stamped.fileName;
        uploadFileType = stamped.fileType;
      }

      // Create preview for images
      let filePreview = '';
      if (uploadFileType.startsWith('image/')) {
        filePreview = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string || '');
          reader.readAsDataURL(uploadFile);
        });
      }

      // Get document name from current state (supports renamed/custom docs)
      const documentName = documents.find(d => d.id === documentId)?.name || `Document ${documentId}`;

      // Create file path for Supabase Storage
      const fileExtension = uploadFileName.split('.').pop();
      const timestamp = Date.now();
      // Sanitize visitId to remove spaces and special characters for valid file path
      const sanitizedVisitId = visitId.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
      const fileName = `${sanitizedVisitId}_doc${documentId}_${timestamp}.${fileExtension}`;
      const filePath = `patient-documents/${sanitizedVisitId}/${fileName}`;

      // Upload file to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('patient-documents')
        .upload(filePath, uploadFile, {
          cacheControl: '3600',
          upsert: false,
          contentType: uploadFileType
        });

      if (uploadError) {
        throw uploadError;
      }

      // Get public URL for the uploaded file
      const { data: { publicUrl } } = supabase.storage
        .from('patient-documents')
        .getPublicUrl(filePath);

      // Save to database
      const { data, error } = await supabase
        .from('patient_documents')
        .upsert({
          visit_id: visitId,
          patient_id: visitId.split('-')[0] || visitId, // Extract patient ID from visit ID
          document_type_id: documentId,
          document_name: documentName,
          file_name: uploadFileName,
          file_path: filePath, // Store the storage path
          file_size: uploadFile.size,
          file_type: uploadFileType,
          is_uploaded: true,
          uploaded_at: new Date().toISOString(),
          remarks: 'Yes',
          remark_reason: documents.find(d => d.id === documentId)?.remarkReason || '',
          ...geoToDbFields(uploadGeo, file.type.startsWith('image/') ? 'file_picker' : null)
        }, {
          onConflict: 'visit_id,document_type_id'
        });

      if (error) {
        throw error;
      }

      // Save preview to localStorage for persistence
      if (filePreview) {
        const previewKey = `doc_preview_${visitId}_${documentId}`;
        localStorage.setItem(previewKey, filePreview);
      }

      // Update local state
      setDocuments(prev =>
        prev.map(doc =>
          doc.id === documentId
            ? {
                ...doc,
                isUploaded: true,
                fileName: uploadFileName,
                fileUrl: publicUrl,
                uploadedAt: new Date().toISOString(),
                fileType: uploadFileType,
                filePreview: filePreview
              }
            : doc
        )
      );

      setAlertMessage({
        type: 'success',
        message: `${uploadFileName} has been uploaded to storage successfully.`
      });
    } catch (error) {
      console.error('Upload failed:', error);
      setAlertMessage({
        type: 'error',
        message: 'Upload failed. Please try again.'
      });
    } finally {
      setUploadingId(null);
      // Reset the input
      event.target.value = '';
    }
  };

  const handleRemoveFile = async (documentId: number) => {
    try {
      // First get the file path from database
      const { data: docData, error: fetchError } = await supabase
        .from('patient_documents')
        .select('file_path')
        .eq('visit_id', visitId)
        .eq('document_type_id', documentId)
        .single();

      if (fetchError) {
        throw fetchError;
      }

      // Delete file from Supabase Storage if it exists
      if (docData?.file_path) {
        const { error: storageError } = await supabase.storage
          .from('patient-documents')
          .remove([docData.file_path]);

        if (storageError) {
          console.warn('Could not delete file from storage:', storageError);
        }
      }

      // Delete from database
      const { error } = await supabase
        .from('patient_documents')
        .delete()
        .eq('visit_id', visitId)
        .eq('document_type_id', documentId);

      if (error) {
        throw error;
      }

      // Remove preview from localStorage
      const previewKey = `doc_preview_${visitId}_${documentId}`;
      localStorage.removeItem(previewKey);

      // Update local state
      setDocuments(prev =>
        prev.map(doc =>
          doc.id === documentId
            ? { ...doc, isUploaded: false, fileName: undefined, fileUrl: undefined, uploadedAt: undefined, fileType: undefined, filePreview: undefined }
            : doc
        )
      );

      setAlertMessage({
        type: 'success',
        message: 'Document has been removed from storage and database successfully.'
      });
    } catch (error) {
      console.error('Remove failed:', error);
      setAlertMessage({
        type: 'error',
        message: 'Failed to remove document. Please try again.'
      });
    }
  };

  const handleRemarkReasonChange = async (documentId: number, reason: string) => {
    // Update local state
    setDocuments(prev =>
      prev.map(doc =>
        doc.id === documentId
          ? { ...doc, remarkReason: reason }
          : doc
      )
    );

    // Save to database immediately for all remark changes
    try {
      const documentName = documents.find(d => d.id === documentId)?.name || `Document ${documentId}`;

      await supabase
        .from('patient_documents')
        .upsert({
          visit_id: visitId,
          patient_id: visitId.split('-')[0] || visitId,
          document_type_id: documentId,
          document_name: documentName,
          file_name: null,
          file_path: null,
          file_size: null,
          file_type: null,
          is_uploaded: false,
          uploaded_at: null,
          remarks: 'No', // Default to 'No' for remark status
          remark_reason: reason
        }, {
          onConflict: 'visit_id,document_type_id'
        });
    } catch (error) {
      console.error('Failed to save remark reason:', error);
    }
  };

  const handleRemarkStatusChange = async (documentId: number, status: 'Yes' | 'No' | '') => {
    console.log('🔸 handleRemarkStatusChange called:', { documentId, status, visitId });

    // Update local state
    setDocuments(prev =>
      prev.map(doc =>
        doc.id === documentId
          ? { ...doc, remarkStatus: status }
          : doc
      )
    );

    // Save to database immediately for all remark status changes
    try {
      console.log('🔸 Saving remark status:', { documentId, status, visitId });

      const documentName = documents.find(d => d.id === documentId)?.name || `Document ${documentId}`;

      // Get current remark reason from state
      const currentDoc = documents.find(d => d.id === documentId);
      const remarkReason = currentDoc?.remarkReason || '';

      console.log('🔸 Document data before save:', { documentName, remarkReason, status });

      // First check if record exists - using maybeSingle() instead of single()
      const { data: existingRecord, error: fetchError } = await supabase
        .from('patient_documents')
        .select('id')
        .eq('visit_id', visitId)
        .eq('document_type_id', documentId)
        .maybeSingle();

      console.log('🔸 Existing record check:', { existingRecord, fetchError });

      let result;
      if (existingRecord) {
        // Update existing record
        console.log('🔸 Updating existing record');
        result = await supabase
          .from('patient_documents')
          .update({
            remarks: status,
            remark_reason: remarkReason,
            updated_at: new Date().toISOString()
          })
          .eq('visit_id', visitId)
          .eq('document_type_id', documentId)
          .select();
      } else {
        // Insert new record for remark-only documents
        console.log('🔸 Inserting new record');
        result = await supabase
          .from('patient_documents')
          .insert({
            visit_id: visitId,
            patient_id: visitId.split('-')[0] || visitId,
            document_type_id: documentId,
            document_name: documentName,
            file_name: null,
            file_path: null,
            file_size: null,
            file_type: null,
            is_uploaded: false,
            uploaded_at: null,
            remarks: status,
            remark_reason: remarkReason
          })
          .select();
      }

      const { data, error } = result;

      if (error) {
        console.error('🔸 Supabase save error:', error);
        setAlertMessage({
          type: 'error',
          message: `Failed to save remark: ${error.message}`
        });
      } else {
        console.log('🔸 Successfully saved remark status:', data);
        setAlertMessage({
          type: 'success',
          message: 'Remark status saved successfully!'
        });
      }
    } catch (error) {
      console.error('🔸 Failed to save remark status:', error);
      setAlertMessage({
        type: 'error',
        message: `Failed to save remark: ${error.message}`
      });
    }
  };
  const handlePreviewClick = (doc: DocumentStatus) => {
    if (!doc.fileUrl && !doc.filePreview) return;
    if (doc.filePreview && doc.fileType?.includes('image')) {
      const newWindow = window.open();
      if (newWindow) {
        newWindow.document.write(`
          <html>
            <head><title>${doc.fileName}</title></head>
            <body style="margin:0; display:flex; justify-content:center; align-items:center; min-height:100vh; background:#f0f0f0;">
              <img src="${doc.filePreview}" style="max-width:100%; max-height:100%; object-fit:contain;" alt="${doc.fileName}" />
            </body>
          </html>`);
      }
    } else if (doc.fileUrl) {
      if (doc.fileType?.includes('pdf')) {
        const newWindow = window.open();
        if (newWindow) {
          newWindow.document.write(`
            <html>
              <head>
                <title>Preview: ${doc.fileName}</title>
                <style>
                  body { margin: 0; padding: 20px; background: #f5f5f5; font-family: Arial, sans-serif; }
                  .header { background: white; padding: 15px; margin-bottom: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                  .pdf-container { background: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow: hidden; }
                  iframe { width: 100%; height: 80vh; border: none; }
                  .download-btn { background: #3b82f6; color: white; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; margin-left: 10px; }
                  .download-btn:hover { background: #2563eb; }
                </style>
              </head>
              <body>
                <div class="header">
                  <h2>📄 ${doc.fileName}</h2>
                  <p>Document Preview - Visit ID: ${visitId}</p>
                  <button class="download-btn" onclick="window.open('${doc.fileUrl}', '_blank')">Download Original</button>
                </div>
                <div class="pdf-container">
                  <iframe src="${doc.fileUrl}" type="application/pdf"></iframe>
                </div>
              </body>
            </html>`);
        }
      } else {
        window.open(doc.fileUrl, '_blank');
      }
    }
  };

  const handleDownloadClick = async (doc: DocumentStatus) => {
    if (!doc.fileUrl) return;
    try {
      const response = await fetch(doc.fileUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = doc.fileName || 'document';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
      setAlertMessage({ type: 'error', message: 'Download failed. Please try again.' });
    }
  };

  const uploadedCount = documents.filter(doc => doc.isUploaded).length;
  const totalCount = documents.length;

  const handleSaveAndContinue = async () => {
    try {
      // Save any pending remark reasons to database for uploaded docs
      const uploadedDocs = documents.filter(doc => doc.isUploaded && doc.remarkReason);

      for (const doc of uploadedDocs) {
        await supabase
          .from('patient_documents')
          .update({
            remark_reason: doc.remarkReason,
            remarks: 'Yes'
          })
          .eq('visit_id', visitId)
          .eq('document_type_id', doc.id);
      }

      // Save remark-only items with their status and reason
      const remarkOnlyDocs = documents.filter(doc => doc.remarkOnly && (doc.remarkStatus || doc.remarkReason));

      for (const doc of remarkOnlyDocs) {
        const documentName = doc.name || `Document ${doc.id}`;

        await supabase
          .from('patient_documents')
          .upsert({
            visit_id: visitId,
            patient_id: visitId.split('-')[0] || visitId,
            document_type_id: doc.id,
            document_name: documentName,
            file_name: null,
            file_path: null,
            file_size: null,
            file_type: null,
            is_uploaded: false,
            uploaded_at: null,
            remarks: doc.remarkStatus || 'No',
            remark_reason: doc.remarkReason || ''
          }, {
            onConflict: 'visit_id,document_type_id'
          });
      }

      // Show success message and keep dialog open
      setAlertMessage({
        type: 'success',
        message: `Documents saved successfully! You can continue uploading more documents.`
      });

      // Clear the success message after 3 seconds but keep dialog open
      setTimeout(() => {
        setAlertMessage(null);
      }, 3000);

    } catch (error) {
      console.error('Save failed:', error);
      setAlertMessage({
        type: 'error',
        message: 'Failed to save document data. Please try again.'
      });
    }
  };

  const handlePrintDocuments = () => {
    // NEW: Print ALL documents (uploaded + not uploaded) with their Yes/No status
    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Document Upload Checklist - ${patientName}</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 15px;
            color: #333;
            line-height: 1.4;
            font-size: 12px;
            min-height: 100vh;
          }
          .header {
            text-align: center;
            margin-bottom: 25px;
            border-bottom: 3px solid #2563eb;
            padding-bottom: 15px;
          }
          .report-title {
            font-size: 22px;
            font-weight: bold;
            color: #2563eb;
            margin-bottom: 10px;
          }
          .patient-info {
            background-color: #f8fafc;
            padding: 15px;
            margin-bottom: 25px;
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 15px;
            font-size: 12px;
            border-radius: 5px;
          }

          .document-list {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
            font-size: 11px;
          }
          .document-list th {
            background-color: #2563eb;
            color: white;
            padding: 12px 8px;
            text-align: left;
            border: 1px solid #333;
            font-weight: bold;
            font-size: 11px;
          }
          .document-list td {
            padding: 10px 8px;
            border: 1px solid #666;
            vertical-align: middle;
            font-size: 10px;
          }
          .document-list tr:nth-child(even) {
            background-color: #f8fafc;
          }
          .document-list tr {
            height: 35px;
          }
          .status-yes {
            background-color: #dcfce7;
            color: #166534;
            padding: 4px 8px;
            border-radius: 3px;
            font-weight: bold;
            text-align: center;
            font-size: 9px;
          }
          .status-no {
            background-color: #fecaca;
            color: #dc2626;
            padding: 4px 8px;
            border-radius: 3px;
            font-weight: bold;
            text-align: center;
            font-size: 9px;
          }
          .file-name {
            font-style: italic;
            color: #6b7280;
            font-size: 9px;
            margin-top: 3px;
          }
          .reason-text {
            background-color: #fffbeb;
            padding: 4px;
            border-radius: 3px;
            border-left: 2px solid #f59e0b;
            font-size: 9px;
            color: #92400e;
          }

          .upload-details {
            font-size: 9px;
            color: #6b7280;
            line-height: 1.3;
          }
          @media print {
            body {
              margin: 0.4in;
              font-size: 11px;
              line-height: 1.2;
            }
            .no-print { display: none; }
            .header {
              margin-bottom: 10px;
              padding-bottom: 6px;
            }
            .report-title {
              font-size: 18px;
              margin-bottom: 5px;
              font-weight: bold;
            }
            .patient-info {
              margin-bottom: 10px;
              padding: 8px;
              font-size: 12px;
              gap: 10px;
            }
            .document-list {
              font-size: 11px;
              margin-bottom: 0;
            }
            .document-list th {
              font-size: 11px;
              padding: 4px 5px;
              line-height: 1.2;
              font-weight: bold;
            }
            .document-list td {
              padding: 3px 5px;
              font-size: 10px;
              line-height: 1.2;
              vertical-align: middle;
            }
            .document-list tr {
              height: 24px;
            }
            .status-yes, .status-no {
              font-size: 9px;
              padding: 2px 4px;
              line-height: 1.2;
              font-weight: bold;
            }
            .reason-text {
              font-size: 9px;
              padding: 2px 3px;
              line-height: 1.2;
            }
            .upload-details {
              font-size: 9px;
              line-height: 1.2;
            }
            .file-name {
              font-size: 9px;
              margin-top: 2px;
              line-height: 1.2;
            }
            @page {
              margin: 0.35in;
              size: A4;
            }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="report-title">Check list of ESIC patient</div>
        </div>

        <div class="patient-info">
          <div><strong>Patient Name:</strong> ${patientName}</div>
          <div><strong>Visit ID:</strong> ${visitId}</div>
          <div><strong>Generated:</strong> ${new Date().toLocaleDateString('en-IN')} ${new Date().toLocaleTimeString('en-IN')}</div>
        </div>



        <table class="document-list">
          <thead>
            <tr>
              <th style="width: 40px;">Sr. No</th>
              <th style="width: 45%;">Must Have Check List for ESIC Patient</th>
              <th style="width: 25%;">Remark Reason</th>
              <th style="width: 15%;">Upload</th>
              <th style="width: 15%;">Remark</th>
            </tr>
          </thead>
          <tbody>
            ${documents.map(doc => `
              <tr>
                <td style="text-align: center; font-weight: bold;">${doc.id}</td>
                <td>
                  <strong>${doc.name}</strong>
                  ${doc.fileName ? `<div class="file-name">📎 ${doc.fileName}</div>` : ''}
                </td>
                <td>
                  ${doc.remarkReason ? `<div class="reason-text">${doc.remarkReason}</div>` : '<em style="color: #9ca3af; font-size: 10px;">Enter reason...</em>'}
                </td>
                <td style="text-align: center;">
                  ${doc.remarkOnly ?
                    '<span style="color: #9ca3af; font-size: 10px;">Remark only</span>' :
                    doc.isUploaded ?
                      `<div class="upload-details">
                        ✓ Uploaded<br>
                        ${doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleDateString('en-IN') : 'N/A'}
                      </div>` :
                      '<span style="color: #9ca3af; font-size: 10px;">Not Uploaded</span>'
                  }
                </td>
                <td style="text-align: center;">
                  ${doc.remarkOnly ?
                    (doc.remarkStatus === 'Yes' ? '<span class="status-yes">✓ Yes</span>' :
                     doc.remarkStatus === 'No' ? '<span class="status-no">✗ No</span>' :
                     '<span style="color: #9ca3af; font-size: 10px;">Not Set</span>') :
                    doc.isUploaded ?
                      '<span class="status-yes">✓ Yes</span>' :
                      '<span class="status-no">✗ No</span>'
                  }
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>


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
      }, 500);
    } else {
      setAlertMessage({
        type: 'error',
        message: 'Unable to open print window. Please check popup blocker settings.'
      });
    }
  };



  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-600" />
              Document Upload Checklist
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrintDocuments}
              className="flex items-center gap-2"
              title="Print Complete Document Checklist (All documents with Yes/No status)"
            >
              <Printer className="h-4 w-4" />
              Print Summary
            </Button>
          </DialogTitle>
          <div className="text-sm text-muted-foreground">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p><strong>Patient:</strong> {patientName}</p>
                <p><strong>Visit ID:</strong> {visitId}</p>
              </div>
              <div>
                <p><strong>Bunch no:</strong> {bunchNo}</p>
                <p><strong>Sr no:</strong> {srNo}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Badge variant="outline">
                {uploadedCount}/{totalCount} Documents Uploaded
              </Badge>
            </div>
          </div>
        </DialogHeader>

        {/* Alert Message */}
        {alertMessage && (
          <div className={`flex-shrink-0 mt-4 p-3 rounded-lg flex items-center gap-2 ${
            alertMessage.type === 'success'
              ? 'bg-green-100 text-green-800 border border-green-200'
              : 'bg-red-100 text-red-800 border border-red-200'
          }`}>
            {alertMessage.type === 'success' ? (
              <Check className="h-4 w-4" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}
            <span className="text-sm">{alertMessage.message}</span>
            <button
              onClick={() => setAlertMessage(null)}
              className="ml-auto text-lg font-semibold cursor-pointer hover:opacity-70"
            >
              ×
            </button>
          </div>
        )}

                {/* Main Content: Document Upload Table with Inline Preview */}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="flex-1 mt-4 overflow-y-auto min-h-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead className="w-12">Sr. No</TableHead>
                <TableHead>Document Name</TableHead>
                <TableHead className="w-48">Remark Reason</TableHead>
                <TableHead className="w-32">Upload</TableHead>
                <TableHead className="w-24">Remark</TableHead>
                <TableHead className="w-24">Preview</TableHead>
                <TableHead className="w-24">Download</TableHead>
              </TableRow>
            </TableHeader>
            <SortableContext items={documents.map(d => d.id)} strategy={verticalListSortingStrategy}>
            <TableBody>
              {documents.map((doc, index) => (
                <SortableDocumentRow
                  key={doc.id}
                  doc={doc}
                  index={index}
                  uploadingId={uploadingId}
                  visitId={visitId}
                  onNameChange={handleNameChange}
                  onNameEditToggle={handleNameEditToggle}
                  onFileUpload={handleFileUpload}
                  onRemoveFile={handleRemoveFile}
                  onRemarkReasonChange={handleRemarkReasonChange}
                  onRemarkStatusChange={handleRemarkStatusChange}
                  onPreviewClick={handlePreviewClick}
                  onDownloadClick={handleDownloadClick}
                />
              ))}
            </TableBody>
            </SortableContext>
          </Table>
        </div>
        </DndContext>
        {/* Footer with buttons - always visible */}
        <div className="flex-shrink-0 flex justify-between items-center mt-4 pt-4 border-t bg-white">
          <div className="flex items-center gap-4">
            <div className="text-sm text-muted-foreground">
              Upload progress: {uploadedCount} of {totalCount} documents completed
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddDocument}
              className="flex items-center gap-1 text-blue-600 border-blue-300 hover:bg-blue-50"
            >
              <Plus className="h-4 w-4" />
              Add Document
            </Button>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onClose}
              className="px-6 py-2"
            >
              Close
            </Button>
            <Button
              onClick={handleSaveAndContinue}
              disabled={uploadedCount === 0}
              className="bg-green-600 hover:bg-green-700 text-white px-6 py-2"
            >
              Save Documents
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
