// Radiology Reporting Component
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Stethoscope, 
  Search, 
  Plus, 
  Clock,
  AlertTriangle,
  CheckCircle,
  FileText,
  Mic,
  Save,
  Send,
  Edit,
  Eye,
  Copy,
  Printer,
  User
} from 'lucide-react';

const RadiologyReporting: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('worklist');
  const [selectedReport, setSelectedReport] = useState<number | null>(null);

  const reportingStats = {
    pendingReports: 23,
    preliminaryReports: 8,
    finalReports: 156,
    avgTurnaroundTime: 4.2 // hours
  };

  const reports = [
    {
      id: 1,
      reportNumber: 'RPT2025001',
      patientName: 'Rajesh Kumar',
      patientId: 'P001',
      age: 45,
      gender: 'Male',
      studyDate: '2025-06-13',
      modality: 'CT',
      bodyPart: 'Brain',
      studyDescription: 'CT Brain without contrast',
      accessionNumber: 'ACC2025001',
      status: 'pending',
      priority: 'urgent',
      radiologist: null,
      clinicalIndication: 'Headache with sudden onset, rule out stroke',
      orderingPhysician: 'Dr. Priya Sharma',
      department: 'Emergency',
      timeAgo: '2 hours ago'
    },
    {
      id: 2,
      reportNumber: 'RPT2025002',
      patientName: 'Sunita Reddy',
      patientId: 'P002',
      age: 38,
      gender: 'Female',
      studyDate: '2025-06-13',
      modality: 'MRI',
      bodyPart: 'Brain',
      studyDescription: 'MRI Brain with contrast',
      accessionNumber: 'ACC2025002',
      status: 'preliminary',
      priority: 'urgent',
      radiologist: 'Dr. Rajesh Kumar',
      clinicalIndication: 'Seizures, rule out brain tumor',
      orderingPhysician: 'Dr. Neha Sharma',
      department: 'Neurology',
      timeAgo: '30 minutes ago',
      preliminaryTime: '2025-06-13T10:30:00Z',
      findings: 'No acute intracranial abnormality detected. Normal brain parenchyma...',
      impression: 'Normal MRI brain study.'
    },
    {
      id: 3,
      reportNumber: 'RPT2025003',
      patientName: 'Mohammed Ali',
      patientId: 'P003',
      age: 65,
      gender: 'Male',
      studyDate: '2025-06-13',
      modality: 'XR',
      bodyPart: 'Chest',
      studyDescription: 'Chest X-ray PA view',
      accessionNumber: 'ACC2025003',
      status: 'final',
      priority: 'stat',
      radiologist: 'Dr. Amit Patel',
      clinicalIndication: 'Post-operative chest evaluation',
      orderingPhysician: 'Dr. Kavita Joshi',
      department: 'ICU',
      timeAgo: '1 hour ago',
      finalTime: '2025-06-13T11:45:00Z',
      findings: 'Normal heart size and contour. Clear lung fields bilaterally...',
      impression: 'Normal chest radiograph.',
      criticalFindings: null
    },
    {
      id: 4,
      reportNumber: 'RPT2025004',
      patientName: 'Priya Gupta',
      patientId: 'P004',
      age: 28,
      gender: 'Female',
      studyDate: '2025-06-13',
      modality: 'US',
      bodyPart: 'Abdomen',
      studyDescription: 'Abdominal Ultrasound',
      accessionNumber: 'ACC2025004',
      status: 'final',
      priority: 'routine',
      radiologist: 'Dr. Sunita Reddy',
      clinicalIndication: 'Abdominal pain, rule out gallstones',
      orderingPhysician: 'Dr. Rajesh Kumar',
      department: 'OPD',
      timeAgo: '3 hours ago',
      finalTime: '2025-06-13T09:15:00Z',
      findings: 'Normal liver, gallbladder, pancreas, and kidneys...',
      impression: 'Normal abdominal ultrasound study.'
    },
    {
      id: 5,
      reportNumber: 'RPT2025005',
      patientName: 'Vikas Singh',
      patientId: 'P005',
      age: 52,
      gender: 'Male',
      studyDate: '2025-06-12',
      modality: 'CT',
      bodyPart: 'Chest',
      studyDescription: 'CT Chest with contrast',
      accessionNumber: 'ACC2025005',
      status: 'preliminary',
      priority: 'urgent',
      radiologist: 'Dr. Priya Sharma',
      clinicalIndication: 'Persistent cough, rule out malignancy',
      orderingPhysician: 'Dr. Amit Singh',
      department: 'Pulmonology',
      timeAgo: '4 hours ago',
      preliminaryTime: '2025-06-12T16:30:00Z',
      findings: 'Small nodule noted in right upper lobe measuring 8mm...',
      impression: 'Small pulmonary nodule, recommend follow-up CT in 3 months.',
      criticalFindings: 'Pulmonary nodule requires follow-up' // Changed to string instead of array
    }
  ];

  const templates = [
    { id: 1, name: 'CT Brain Normal', modality: 'CT', bodyPart: 'Brain' },
    { id: 2, name: 'Chest X-ray Normal', modality: 'XR', bodyPart: 'Chest' },
    { id: 3, name: 'Abdominal US Normal', modality: 'US', bodyPart: 'Abdomen' },
    { id: 4, name: 'MRI Brain Normal', modality: 'MRI', bodyPart: 'Brain' },
    { id: 5, name: 'Mammography Normal', modality: 'MG', bodyPart: 'Breast' }
  ];

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'stat': return 'bg-red-100 text-red-800';
      case 'urgent': return 'bg-orange-100 text-orange-800';
      case 'routine': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'preliminary': return 'bg-blue-100 text-blue-800';
      case 'final': return 'bg-green-100 text-green-800';
      case 'amended': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending': return <Clock className="h-4 w-4" />;
      case 'preliminary': return <Edit className="h-4 w-4" />;
      case 'final': return <CheckCircle className="h-4 w-4" />;
      case 'amended': return <FileText className="h-4 w-4" />;
      default: return <FileText className="h-4 w-4" />;
    }
  };

  const filteredReports = reports.filter(report => {
    const matchesSearch = report.patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         report.reportNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         report.accessionNumber.toLowerCase().includes(searchTerm.toLowerCase());
    
    if (activeTab === 'worklist') return matchesSearch && report.status === 'pending';
    if (activeTab === 'preliminary') return matchesSearch && report.status === 'preliminary';
    if (activeTab === 'final') return matchesSearch && report.status === 'final';
    return matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Stethoscope className="h-6 w-6 text-primary" />
          <div>
            <h2 className="text-2xl font-bold">Radiology Reporting</h2>
            <p className="text-sm text-muted-foreground">
              Create, review, and manage radiology reports
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <FileText className="h-4 w-4 mr-2" />
            Templates
          </Button>
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            New Report
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Pending Reports</p>
                <p className="text-2xl font-bold text-orange-600">{reportingStats.pendingReports}</p>
              </div>
              <Clock className="h-8 w-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Preliminary</p>
                <p className="text-2xl font-bold text-blue-600">{reportingStats.preliminaryReports}</p>
              </div>
              <Edit className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Final Reports</p>
                <p className="text-2xl font-bold text-green-600">{reportingStats.finalReports}</p>
              </div>
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Avg TAT</p>
                <p className="text-2xl font-bold text-purple-600">{reportingStats.avgTurnaroundTime}h</p>
              </div>
              <Clock className="h-8 w-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search by patient name, report number, or accession number..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Report Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="worklist" className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Worklist
            <Badge variant="secondary">{reports.filter(r => r.status === 'pending').length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="preliminary" className="flex items-center gap-2">
            <Edit className="h-4 w-4" />
            Preliminary
            <Badge variant="secondary">{reports.filter(r => r.status === 'preliminary').length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="final" className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4" />
            Final
          </TabsTrigger>
          <TabsTrigger value="critical" className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Critical
            <Badge variant="destructive">{reports.filter(r => r.criticalFindings).length}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="space-y-4">
          {selectedReport ? (
            /* Report Editor */
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Report Details */}
              <Card>
                <CardHeader>
                  <CardTitle>Report Details</CardTitle>
                </CardHeader>
                <CardContent>
                  {(() => {
                    const report = reports.find(r => r.id === selectedReport);
                    if (!report) return null;
                    
                    return (
                      <div className="space-y-4 text-sm">
                        <div>
                          <div className="text-muted-foreground">Patient</div>
                          <div className="font-medium">{report.patientName}</div>
                          <div className="text-xs">{report.age}Y {report.gender} • ID: {report.patientId}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Study</div>
                          <div className="font-medium">{report.studyDescription}</div>
                          <div className="text-xs">{report.modality} • {new Date(report.studyDate).toLocaleDateString()}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Clinical Indication</div>
                          <div className="font-medium">{report.clinicalIndication}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Ordering Physician</div>
                          <div className="font-medium">{report.orderingPhysician}</div>
                          <div className="text-xs">{report.department}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={getPriorityColor(report.priority)}>
                            {report.priority.toUpperCase()}
                          </Badge>
                          <Badge className={getStatusColor(report.status)}>
                            {getStatusIcon(report.status)}
                            <span className="ml-1">{report.status.toUpperCase()}</span>
                          </Badge>
                        </div>
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>

              {/* Report Editor */}
              <div className="lg:col-span-2 space-y-4">
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle>Report Editor</CardTitle>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline">
                          <FileText className="h-4 w-4 mr-2" />
                          Load Template
                        </Button>
                        <Button size="sm" variant="outline">
                          <Mic className="h-4 w-4 mr-2" />
                          Dictate
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-medium">Clinical Information</label>
                        <textarea
                          className="w-full p-2 border rounded mt-1"
                          rows={2}
                          placeholder="Clinical indication and patient history..."
                          defaultValue={reports.find(r => r.id === selectedReport)?.clinicalIndication}
                        />
                      </div>
                      
                      <div>
                        <label className="text-sm font-medium">Technique</label>
                        <textarea
                          className="w-full p-2 border rounded mt-1"
                          rows={2}
                          placeholder="Imaging technique and protocol..."
                        />
                      </div>

                      <div>
                        <label className="text-sm font-medium">Findings</label>
                        <textarea
                          className="w-full p-2 border rounded mt-1"
                          rows={6}
                          placeholder="Detailed findings..."
                          defaultValue={reports.find(r => r.id === selectedReport)?.findings}
                        />
                      </div>

                      <div>
                        <label className="text-sm font-medium">Impression</label>
                        <textarea
                          className="w-full p-2 border rounded mt-1"
                          rows={3}
                          placeholder="Clinical impression and recommendations..."
                          defaultValue={reports.find(r => r.id === selectedReport)?.impression}
                        />
                      </div>

                      <div>
                        <label className="text-sm font-medium">Critical Findings</label>
                        <textarea
                          className="w-full p-2 border rounded mt-1"
                          rows={2}
                          placeholder="Any critical findings requiring immediate attention..."
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Actions */}
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex gap-2 flex-wrap">
                      <Button>
                        <Save className="h-4 w-4 mr-2" />
                        Save Draft
                      </Button>
                      <Button variant="outline">
                        <Send className="h-4 w-4 mr-2" />
                        Submit Preliminary
                      </Button>
                      <Button variant="outline">
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Finalize Report
                      </Button>
                      <Button variant="outline">
                        <Eye className="h-4 w-4 mr-2" />
                        Preview
                      </Button>
                      <Button variant="outline">
                        <Copy className="h-4 w-4 mr-2" />
                        Copy Previous
                      </Button>
                      <Button variant="outline">
                        <Printer className="h-4 w-4 mr-2" />
                        Print
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : (
            /* Report List */
            <div className="space-y-4">
              {filteredReports.map((report) => (
                <Card key={report.id} className="hover:shadow-md transition-shadow cursor-pointer"
                      onClick={() => setSelectedReport(report.id)}>
                  <CardContent className="pt-6">
                    <div className="space-y-4">
                      {/* Header Row */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div>
                            <div className="font-semibold text-lg">{report.patientName}</div>
                            <div className="text-sm text-muted-foreground">{report.age}Y {report.gender} • ID: {report.patientId}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={getPriorityColor(report.priority)}>
                            {report.priority.toUpperCase()}
                          </Badge>
                          <Badge className={getStatusColor(report.status)}>
                            {getStatusIcon(report.status)}
                            <span className="ml-1">{report.status.toUpperCase()}</span>
                          </Badge>
                          {report.criticalFindings && (
                            <Badge variant="destructive">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              CRITICAL
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Study Details */}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                        <div>
                          <div className="text-muted-foreground">Report Number</div>
                          <div className="font-medium">{report.reportNumber}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Study</div>
                          <div className="font-medium">{report.studyDescription}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Modality</div>
                          <div className="font-medium">{report.modality}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Study Date</div>
                          <div className="font-medium">{new Date(report.studyDate).toLocaleDateString()}</div>
                        </div>
                      </div>

                      {/* Clinical Information */}
                      <div className="border-t pt-4">
                        <div className="text-sm">
                          <div className="text-muted-foreground mb-1">Clinical Indication</div>
                          <div className="font-medium">{report.clinicalIndication}</div>
                        </div>
                      </div>

                      {/* Physician and Time Info */}
                      <div className="border-t pt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        <div>
                          <div className="text-muted-foreground flex items-center gap-1">
                            <User className="h-3 w-3" />
                            Ordering Physician
                          </div>
                          <div className="font-medium">{report.orderingPhysician}</div>
                          <div className="text-xs text-muted-foreground">{report.department}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Time</div>
                          <div className="font-medium">{report.timeAgo}</div>
                          {report.radiologist && (
                            <div className="text-xs text-muted-foreground">Assigned: {report.radiologist}</div>
                          )}
                        </div>
                      </div>

                      {/* Preview of findings for completed reports */}
                      {(report.findings || report.impression) && (
                        <div className="border-t pt-4 text-sm">
                          {report.findings && (
                            <div className="mb-2">
                              <div className="text-muted-foreground mb-1">Findings</div>
                              <div className="line-clamp-2">{report.findings}</div>
                            </div>
                          )}
                          {report.impression && (
                            <div>
                              <div className="text-muted-foreground mb-1">Impression</div>
                              <div className="font-medium line-clamp-1">{report.impression}</div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Critical Findings Alert */}
                      {report.criticalFindings && (
                        <div className="border-t pt-4">
                          <div className="bg-red-50 border border-red-200 rounded p-3">
                            <div className="flex items-center gap-2 text-red-800">
                              <AlertTriangle className="h-4 w-4" />
                              <div className="font-medium">Critical Finding</div>
                            </div>
                            <div className="text-sm text-red-700 mt-1">{report.criticalFindings}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {selectedReport && (
        <div className="fixed bottom-4 right-4">
          <Button onClick={() => setSelectedReport(null)} variant="outline">
            ← Back to List
          </Button>
        </div>
      )}

      {filteredReports.length === 0 && !selectedReport && (
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-muted-foreground mb-2">No reports found</div>
            <div className="text-sm">Try adjusting your search criteria</div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default RadiologyReporting;
