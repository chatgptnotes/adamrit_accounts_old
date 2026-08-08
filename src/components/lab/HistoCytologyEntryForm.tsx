// Histo/Cytology Entry Form with Rich Text Editor - Dynamic Tabs from Sub-Test Config
import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { CKEditor } from '@ckeditor/ckeditor5-react';
import ClassicEditor from '@ckeditor/ckeditor5-build-classic';

interface HistoCytologyEntryFormProps {
  selectedTests: any[];
  patientInfo: any;
  onClose: () => void;
  onSaved?: () => void;
}

interface TabConfig {
  id: string;
  label: string;
  field: string;
}

// Define preferred tab order for histopathology/cytology reports
const HISTO_TAB_ORDER = [
  'BIOPSY NO',
  'SPECIMEN',
  'CLINICAL HISTORY',
  'CLINICAL DETAILS',
  'GROSS',
  'GROSS DESCRIPTION',
  'MICROSCOPY',
  'MICROSCOPIC DESCRIPTION',
  'IMPRESSION/DIAGNOSIS',
  'IMPRESSION',
  'ADVICE/COMMENT',
  'ADVICE',
  'COMMENT'
];

// Sort tabs according to preferred order
const sortTabs = (tabs: TabConfig[]): TabConfig[] => {
  return [...tabs].sort((a, b) => {
    const aLabel = a.label.toUpperCase();
    const bLabel = b.label.toUpperCase();

    const aIndex = HISTO_TAB_ORDER.findIndex(name =>
      aLabel.includes(name) || name.includes(aLabel)
    );
    const bIndex = HISTO_TAB_ORDER.findIndex(name =>
      bLabel.includes(name) || name.includes(bLabel)
    );

    // If not found in order array, put at end
    const aOrder = aIndex === -1 ? 999 : aIndex;
    const bOrder = bIndex === -1 ? 999 : bIndex;

    return aOrder - bOrder;
  });
};

const HistoCytologyEntryForm: React.FC<HistoCytologyEntryFormProps> = ({
  selectedTests,
  patientInfo,
  onClose,
  onSaved
}) => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('');
  const [authenticatedResult, setAuthenticatedResult] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [savedFileUrls, setSavedFileUrls] = useState<string[]>([]);
  const [dynamicTabs, setDynamicTabs] = useState<TabConfig[]>([]);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [sampleCollectedDate, setSampleCollectedDate] = useState<string | null>(null);

  // Fetch dynamic tabs from lab_test_config
  useEffect(() => {
    const fetchDynamicTabs = async () => {
      if (!selectedTests[0]?.test_name) {
        setIsLoading(false);
        return;
      }

      try {

        const { data, error } = await supabase
          .from('lab_test_config')
          .select('nested_sub_tests, sub_test_name')
          .eq('test_name', selectedTests[0].test_name);

        if (error) {
          console.error('Error fetching config:', error);
          setIsLoading(false);
          return;
        }


        // Check if any row has nested_sub_tests
        let allNestedSubTests: any[] = [];

        if (data && data.length > 0) {
          data.forEach((row: any) => {
            if (row.nested_sub_tests && Array.isArray(row.nested_sub_tests)) {
              allNestedSubTests = [...allNestedSubTests, ...row.nested_sub_tests];
            }
          });
        }

        if (allNestedSubTests.length > 0) {
          // Use nested_sub_tests as tabs
          const tabs = allNestedSubTests.map((subTest: any, idx: number) => ({
            id: `tab_${idx}`,
            label: subTest.name || `Sub Test ${idx + 1}`,
            field: `subtest_${idx}`
          }));

          // Sort tabs according to preferred order
          const sortedTabs = sortTabs(tabs);
          setDynamicTabs(sortedTabs);
          setActiveTab(sortedTabs[0]?.id || '');

          // Initialize form data for each tab
          const initialData: Record<string, string> = {};
          sortedTabs.forEach((tab) => {
            initialData[tab.field] = '';
          });
          setFormData(initialData);
        } else if (data && data.length > 0) {
          // Use sub_test_name from each row as tabs
          const tabs = data.map((row: any, idx: number) => ({
            id: `tab_${idx}`,
            label: row.sub_test_name || `Sub Test ${idx + 1}`,
            field: `subtest_${idx}`
          }));

          // Sort tabs according to preferred order
          const sortedTabs = sortTabs(tabs);
          setDynamicTabs(sortedTabs);
          setActiveTab(sortedTabs[0]?.id || '');

          const initialData: Record<string, string> = {};
          sortedTabs.forEach((tab) => {
            initialData[tab.field] = '';
          });
          setFormData(initialData);
        } else {
          // Fallback to default tabs if no config found
          const defaultTabs = [
            { id: 'specimen', label: 'Specimen', field: 'specimen' },
            { id: 'clinical', label: 'Clinical Details', field: 'clinicalDetails' },
            { id: 'gross', label: 'Gross Description', field: 'grossDescription' },
            { id: 'microscopic', label: 'Microscopic Description', field: 'microscopicDescription' },
            { id: 'impression', label: 'Impression', field: 'impression' }
          ];
          setDynamicTabs(defaultTabs);
          setActiveTab('specimen');
          setFormData({
            specimen: '',
            clinicalDetails: '',
            grossDescription: '',
            microscopicDescription: '',
            impression: ''
          });
        }
      } catch (error) {
        console.error('Error in fetchDynamicTabs:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchDynamicTabs();
  }, [selectedTests]);

  // Fetch sample collected date from visit_labs
  useEffect(() => {
    const fetchSampleCollectedDate = async () => {
      if (!selectedTests[0]?.id) return;

      try {
        const { data, error } = await supabase
          .from('visit_labs')
          .select('collected_date')
          .eq('id', selectedTests[0].id)
          .single();

        if (!error && data?.collected_date) {
          setSampleCollectedDate(data.collected_date);
        }
      } catch (err) {
        console.error('Error fetching collected_date:', err);
      }
    };

    fetchSampleCollectedDate();
  }, [selectedTests]);

  // Load existing data if available
  useEffect(() => {
    const loadExistingData = async () => {
      if (!patientInfo?.visit_uuid && !patientInfo?.order_id) return;
      if (dynamicTabs.length === 0) return;

      const visitId = patientInfo.visit_uuid || patientInfo.order_id;

      try {
        const { data, error } = await supabase
          .from('lab_results')
          .select('*')
          .eq('visit_id', visitId)
          .eq('test_name', selectedTests[0]?.test_name)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (data && data.result_value) {
          try {
            const savedData = JSON.parse(data.result_value);
            if (savedData.histoCytologyData) {
              setFormData(prev => ({
                ...prev,
                ...savedData.histoCytologyData
              }));
            }
            if (savedData.files && Array.isArray(savedData.files)) {
              setSavedFileUrls(savedData.files);
            }
            if (data.authenticated_result) {
              setAuthenticatedResult(true);
            }
          } catch (e) {
          }
        }
      } catch (error) {
        console.error('Error loading existing data:', error);
      }
    };

    loadExistingData();
  }, [patientInfo, selectedTests, dynamicTabs]);

  const handleEditorChange = (field: string, data: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: data
    }));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      setUploadedFiles(prev => [...prev, ...files]);
    }
  };

  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const removeSavedFile = (index: number) => {
    setSavedFileUrls(prev => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setIsUploading(uploadedFiles.length > 0);

    try {
      const visitId = patientInfo.visit_uuid || patientInfo.order_id;
      const labId = patientInfo.lab_uuid || patientInfo.test_id;

      // Upload files to Supabase storage
      const uploadedFileUrls: string[] = [];

      if (uploadedFiles.length > 0) {

        for (const file of uploadedFiles) {
          const fileName = `${Date.now()}_${file.name}`;
          const filePath = `lab-reports/${visitId}/${fileName}`;

          const { data: uploadData, error: uploadError } = await supabase.storage
            .from('patient-documents')
            .upload(filePath, file, {
              cacheControl: '3600',
              upsert: false
            });

          if (uploadError) {
            console.error('Error uploading file:', uploadError);
            toast({
              title: "Upload Error",
              description: `Failed to upload ${file.name}: ${uploadError.message}`,
              variant: "destructive"
            });
          } else if (uploadData) {
            // Get public URL
            const { data: urlData } = supabase.storage
              .from('patient-documents')
              .getPublicUrl(filePath);

            if (urlData?.publicUrl) {
              uploadedFileUrls.push(urlData.publicUrl);
            }
          }
        }
      }

      // Merge with existing saved URLs
      const allFileUrls = [...savedFileUrls, ...uploadedFileUrls];

      // Prepare the result data with tab labels for reference
      const resultData = {
        histoCytologyData: formData,
        tabConfig: dynamicTabs,
        files: allFileUrls,
        savedAt: new Date().toISOString()
      };

      const labResultsData = {
        main_test_name: selectedTests[0]?.test_name || 'Histo/Cytology Test',
        test_name: selectedTests[0]?.test_name || 'Histo/Cytology Test',
        test_category: selectedTests[0]?.test_category || 'HISTO/CYTOLOGY',
        result_value: JSON.stringify(resultData),
        result_unit: '',
        reference_range: '',
        comments: `Histo/Cytology Report - ${new Date().toLocaleString()}`,
        is_abnormal: false,
        result_status: authenticatedResult ? 'Final' : 'Preliminary',
        technician_name: '',
        pathologist_name: '',
        authenticated_result: authenticatedResult,
        patient_name: patientInfo.patient_name || 'Unknown Patient',
        patient_age: patientInfo.patient_age || null,
        patient_gender: patientInfo.patient_gender || 'Unknown',
        visit_id: visitId || null,
        lab_id: labId || null
      };

      // Check if record exists
      const { data: existingData } = await supabase
        .from('lab_results')
        .select('id')
        .eq('visit_id', visitId)
        .eq('test_name', selectedTests[0]?.test_name)
        .maybeSingle();

      if (existingData) {
        // Update existing record
        const { error } = await supabase
          .from('lab_results')
          .update(labResultsData)
          .eq('id', existingData.id);

        if (error) throw error;
      } else {
        // Insert new record
        const { error } = await supabase
          .from('lab_results')
          .insert(labResultsData);

        if (error) throw error;
      }

      // Update state with new file URLs and clear uploaded files
      setSavedFileUrls(allFileUrls);
      setUploadedFiles([]);

      toast({
        title: "Success",
        description: "Histo/Cytology report saved successfully"
      });

      onSaved?.();
    } catch (error) {
      console.error('Error saving:', error);
      toast({
        title: "Error",
        description: "Failed to save report",
        variant: "destructive"
      });
    } finally {
      setIsSaving(false);
      setIsUploading(false);
    }
  };

  const handlePreviewAndPrint = async () => {
    // Save first
    await handleSave();

    // Check if there's a PDF file to print
    const pdfUrl = savedFileUrls.find(url => url.toLowerCase().endsWith('.pdf'));

    if (pdfUrl) {
      // Open PDF in new window for printing
      const printWindow = window.open(pdfUrl, '_blank');
      if (printWindow) {
        // Wait for PDF to load then print
        setTimeout(() => {
          printWindow.print();
        }, 1000);
      }
      return;
    }

    // Generate dynamic sections for print (if no PDF)
    const sectionsHtml = dynamicTabs.map(tab => {
      const content = formData[tab.field];
      if (!content) return '';
      return `
        <div class="section">
          <div class="section-title">${tab.label.toUpperCase()}</div>
          <div class="section-content">${content}</div>
        </div>
      `;
    }).join('');

    // Generate print content
    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Histo/Cytology Report - ${patientInfo.patient_name}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          .header { text-align: center; padding: 10px 0; margin-bottom: 15px; }
          .header h2 { font-size: 16px; font-weight: bold; text-decoration: underline; margin: 0; }
          .patient-info { background: #f5f5f5; padding: 15px; margin-bottom: 20px; border: 1px solid #ddd; }
          .patient-info-grid { display: flex; justify-content: space-between; }
          .patient-info-col { width: 48%; }
          .patient-info-row { margin-bottom: 5px; font-size: 13px; }
          .patient-info-row strong { display: inline-block; min-width: 120px; }
          .section { margin-bottom: 20px; }
          .section-title { font-weight: bold; color: #000; margin-bottom: 8px; font-size: 12px; }
          .section-content { padding-left: 10px; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="patient-info">
          <div class="patient-info-grid">
            <div class="patient-info-col">
              <div class="patient-info-row"><strong>Patient Name :</strong> ${patientInfo.patient_name || 'N/A'}</div>
              <div class="patient-info-row"><strong>Patient ID :</strong> ${patientInfo.patient_id || patientInfo.order_number || 'N/A'}</div>
              <div class="patient-info-row"><strong>Ref By :</strong> ${patientInfo.ordering_doctor || 'N/A'}</div>
              <div class="patient-info-row"><strong>Sample Received :</strong> ${sampleCollectedDate ? new Date(sampleCollectedDate).toLocaleString() : new Date().toLocaleString()}</div>
              <div class="patient-info-row"><strong>Request No. :</strong> ${patientInfo.id || 'N/A'}</div>
            </div>
            <div class="patient-info-col">
              <div class="patient-info-row"><strong>Age/Sex :</strong> ${patientInfo.patient_age || 'N/A'} / ${patientInfo.patient_gender || 'N/A'}</div>
              <div class="patient-info-row"><strong>Visit ID :</strong> ${patientInfo.visit_id || 'N/A'}</div>
              <div class="patient-info-row"><strong>Report Date :</strong> ${new Date().toLocaleString()}</div>
              <div class="patient-info-row"><strong>Consultant Name :</strong> ${patientInfo.ordering_doctor || 'N/A'}</div>
              <div class="patient-info-row"><strong>Provisional</strong></div>
              <div class="patient-info-row"><strong>Diagnosis :</strong> ${patientInfo.clinical_history || 'N/A'}</div>
            </div>
          </div>
        </div>

        <div class="header">
          <h2>REPORT ON ${(selectedTests[0]?.test_category || 'CYTOLOGY').toUpperCase()}</h2>
        </div>

        ${sectionsHtml}

        <div style="margin-top: 50px; text-align: center;">
          <p>................... END OF REPORT ...................</p>
        </div>
      </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.print();
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-gray-500">Loading form configuration...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Patient Info Header */}
      <div className="bg-pink-50 p-4 rounded-lg border">
        <div className="grid grid-cols-6 gap-4 text-sm">
          <div>
            <span className="font-semibold">Patient Name:</span> {patientInfo.patient_name}
          </div>
          <div>
            <span className="font-semibold">Age/Sex:</span> {patientInfo.patient_age || 'N/A'} / {patientInfo.patient_gender || 'N/A'}
          </div>
          <div>
            <span className="font-semibold">Type:</span> {patientInfo.corporate || 'OPD'}
          </div>
          <div>
            <span className="font-semibold">Ref By:</span> {patientInfo.ordering_doctor || 'N/A'}
          </div>
          <div>
            <span className="font-semibold">Visit ID:</span> {patientInfo.visit_id || 'N/A'}
          </div>
          <div>
            <span className="font-semibold">Date:</span> {new Date().toLocaleDateString()}
          </div>
        </div>
      </div>

      {/* Test Name Header */}
      <div className="text-red-600 font-semibold text-lg border-b-2 border-red-400 pb-2">
        {selectedTests[0]?.test_name || 'HISTO/CYTOLOGY TEST'}
      </div>

      {/* Date and Authenticated Checkbox */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">
          {new Date().toLocaleString()}
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="authenticated"
            checked={authenticatedResult}
            onCheckedChange={(checked) => setAuthenticatedResult(checked as boolean)}
          />
          <Label htmlFor="authenticated">Authenticated Result</Label>
        </div>
      </div>

      {/* Tabs with CKEditor */}
      {dynamicTabs.length > 0 && (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
            {dynamicTabs.map(tab => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="text-xs px-2 py-1 data-[state=active]:bg-blue-600 data-[state=active]:text-white"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {dynamicTabs.map(tab => (
            <TabsContent key={tab.id} value={tab.id} className="mt-4">
              <div className="border rounded-lg overflow-hidden bg-blue-50 [&_.ck-editor__editable]:min-h-[150px]">
                <CKEditor
                  editor={ClassicEditor}
                  data={formData[tab.field] || ''}
                  onChange={(event, editor) => {
                    const data = editor.getData();
                    handleEditorChange(tab.field, data);
                  }}
                  config={{
                    toolbar: [
                      'heading', '|',
                      'bold', 'italic', 'underline', 'strikethrough', '|',
                      'bulletedList', 'numberedList', '|',
                      'alignment', '|',
                      'indent', 'outdent', '|',
                      'link', 'blockQuote', 'insertTable', '|',
                      'undo', 'redo'
                    ]
                  }}
                />
              </div>
            </TabsContent>
          ))}
        </Tabs>
      )}

      {/* File Upload Section */}
      <div className="border-t pt-4">
        <div className="flex items-center gap-4">
          <Input
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={handleFileUpload}
            className="max-w-xs"
          />
          <span className="text-sm text-gray-500">
            {uploadedFiles.length > 0
              ? `${uploadedFiles.length} file(s) selected`
              : 'No file chosen'}
          </span>
        </div>

        {/* Show uploaded files (pending upload) */}
        {uploadedFiles.length > 0 && (
          <div className="mt-2 space-y-1">
            <span className="text-sm font-medium text-orange-600">Files to upload:</span>
            {uploadedFiles.map((file, index) => (
              <div key={index} className="flex items-center gap-2 text-sm">
                <span className="text-orange-600">{file.name}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-500 h-6 px-2"
                  onClick={() => removeFile(index)}
                >
                  ✕
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Show saved files */}
        {savedFileUrls.length > 0 && (
          <div className="mt-2 space-y-1">
            <span className="text-sm font-medium text-green-600">Saved files:</span>
            {savedFileUrls.map((url, index) => (
              <div key={index} className="flex items-center gap-2 text-sm">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  {decodeURIComponent(url.split('/').pop() || 'File')}
                </a>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-500 h-6 px-2"
                  onClick={() => removeSavedFile(index)}
                >
                  ✕
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex justify-center gap-4 pt-4 border-t">
        <Button
          onClick={handleSave}
          disabled={isSaving}
          className="bg-blue-600 hover:bg-blue-700 text-white px-8"
        >
          {isUploading ? 'Uploading...' : isSaving ? 'Saving...' : 'Save'}
        </Button>
        <Button
          variant="outline"
          onClick={onClose}
          className="px-8"
        >
          Back
        </Button>
        <Button
          variant="outline"
          onClick={handlePreviewAndPrint}
          disabled={isSaving}
          className="px-8"
        >
          Preview & Print
        </Button>
        <Button
          variant="outline"
          disabled
          className="px-8"
        >
          Download Files
        </Button>
      </div>
    </div>
  );
};

export default HistoCytologyEntryForm;
