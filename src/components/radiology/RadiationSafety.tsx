// Radiation Safety Component
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Shield, 
  Search, 
  AlertTriangle,
  TrendingUp,
  Activity,
  Clock,
  User,
  Baby,
  Zap,
  BarChart3,
  Calendar,
  Download,
  Eye,
  Settings
} from 'lucide-react';

const RadiationSafety: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTab, setSelectedTab] = useState('tracking');

  const radiationStats = {
    totalExposures: 1847,
    avgDosePerStudy: 8.5,
    drlExceeded: 23,
    pregnantExposures: 2,
    pediatricExposures: 156,
    complianceRate: 96.2
  };

  const doseTracking = [
    {
      id: 1,
      patientName: 'Rajesh Kumar',
      patientId: 'P001',
      age: 45,
      gender: 'Male',
      studyDate: '2025-06-13',
      modality: 'CT',
      procedure: 'CT Brain without contrast',
      bodyPart: 'Brain',
      effectiveDose: 2.3, // mSv
      ctdi: 45.2, // mGy
      dlp: 890, // mGy.cm
      drl: 1000, // mGy.cm
      exceedsDrl: false,
      pregnancyStatus: 'not_pregnant',
      patientWeight: 75,
      technologist: 'Ravi Singh',
      optimizationNotes: 'Standard protocol used'
    },
    {
      id: 2,
      patientName: 'Priya Sharma',
      patientId: 'P002',
      age: 32,
      gender: 'Female',
      studyDate: '2025-06-13',
      modality: 'CT',
      procedure: 'CT Chest with contrast',
      bodyPart: 'Chest',
      effectiveDose: 7.2, // mSv
      ctdi: 12.5, // mGy
      dlp: 420, // mGy.cm
      drl: 400, // mGy.cm
      exceedsDrl: true,
      pregnancyStatus: 'not_pregnant',
      patientWeight: 68,
      technologist: 'Ravi Singh',
      optimizationNotes: 'Repeat scan due to motion artifact'
    },
    {
      id: 3,
      patientName: 'Mohammed Ali',
      patientId: 'P003',
      age: 65,
      gender: 'Male',
      studyDate: '2025-06-13',
      modality: 'XR',
      procedure: 'Chest X-ray PA view',
      bodyPart: 'Chest',
      effectiveDose: 0.1, // mSv
      entranceSkinDose: 0.25, // mGy
      kvp: 120,
      mas: 3.2,
      exceedsDrl: false,
      pregnancyStatus: 'not_applicable',
      patientWeight: 80,
      technologist: 'Kavita Rao',
      optimizationNotes: 'Optimal technique parameters'
    },
    {
      id: 4,
      patientName: 'Aarav Patel',
      patientId: 'P004',
      age: 8,
      gender: 'Male',
      studyDate: '2025-06-13',
      modality: 'CT',
      procedure: 'CT Abdomen pediatric',
      bodyPart: 'Abdomen',
      effectiveDose: 3.8, // mSv
      ctdi: 8.2, // mGy
      dlp: 150, // mGy.cm
      drl: 180, // mGy.cm (pediatric)
      exceedsDrl: false,
      pregnancyStatus: 'not_applicable',
      patientWeight: 28,
      technologist: 'Ravi Singh',
      optimizationNotes: 'Pediatric protocol with size-specific dose optimization'
    },
    {
      id: 5,
      patientName: 'Sunita Reddy',
      patientId: 'P005',
      age: 28,
      gender: 'Female',
      studyDate: '2025-06-12',
      modality: 'FL',
      procedure: 'Fluoroscopy guided procedure',
      bodyPart: 'Lumbar Spine',
      effectiveDose: 12.5, // mSv
      fluoroscopyTime: 480, // seconds
      entranceSkinDose: 850, // mGy
      exceedsDrl: false,
      pregnancyStatus: 'unknown',
      patientWeight: 62,
      technologist: 'Kavita Rao',
      optimizationNotes: 'Complex interventional procedure'
    }
  ];

  const doseOptimization = [
    {
      modality: 'CT',
      totalStudies: 445,
      avgDose: 8.5,
      drlCompliance: 94.8,
      optimizationActions: [
        'Size-specific dose estimation implemented',
        'Automatic exposure control optimization',
        'Low-dose protocols for routine studies'
      ]
    },
    {
      modality: 'XR',
      totalStudies: 678,
      avgDose: 0.12,
      drlCompliance: 98.2,
      optimizationActions: [
        'Digital radiography with optimal processing',
        'Rare earth filters for dose reduction',
        'Grid removal for pediatric studies'
      ]
    },
    {
      modality: 'FL',
      totalStudies: 45,
      avgDose: 15.2,
      drlCompliance: 91.1,
      optimizationActions: [
        'Pulsed fluoroscopy implementation',
        'Last image hold technology',
        'Collimation optimization'
      ]
    },
    {
      modality: 'MG',
      totalStudies: 156,
      avgDose: 1.8,
      drlCompliance: 97.4,
      optimizationActions: [
        'Automatic optimization of exposure',
        'Breast compression optimization',
        'Spectral shaping filters'
      ]
    }
  ];

  const pregnancyProtocol = {
    totalPregnantPatients: 2,
    protocolCompliance: 100,
    procedures: [
      {
        patientName: 'Kavya Krishnan',
        gestationalAge: '12 weeks',
        procedure: 'Abdominal Ultrasound',
        modality: 'US',
        radiationDose: 0, // Non-ionizing
        justification: 'Suspected appendicitis - ultrasound first',
        alternativeConsidered: 'MRI if ultrasound inconclusive',
        consultingPhysician: 'Dr. Obstetrics Team'
      },
      {
        patientName: 'Meera Singh',
        gestationalAge: '28 weeks',
        procedure: 'Chest X-ray',
        modality: 'XR',
        radiationDose: 0.01, // mSv
        justification: 'Pneumonia suspected - maternal benefit vs fetal risk',
        alternativeConsidered: 'Clinical observation attempted first',
        consultingPhysician: 'Dr. Pulmonology Team'
      }
    ]
  };

  const getComplianceColor = (compliance: number) => {
    if (compliance >= 95) return 'text-green-600';
    if (compliance >= 90) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getDoseColor = (dose: number, modality: string) => {
    // Simplified dose level classification
    if (modality === 'CT' && dose > 10) return 'text-red-600';
    if (modality === 'FL' && dose > 20) return 'text-red-600';
    if (modality === 'XR' && dose > 0.5) return 'text-yellow-600';
    return 'text-green-600';
  };

  const filteredDoseTracking = doseTracking.filter(record =>
    record.patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    record.procedure.toLowerCase().includes(searchTerm.toLowerCase()) ||
    record.modality.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-primary" />
          <div>
            <h2 className="text-2xl font-bold">Radiation Safety</h2>
            <p className="text-sm text-muted-foreground">
              Monitor radiation doses and ensure ALARA compliance
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export Report
          </Button>
          <Button variant="outline">
            <Settings className="h-4 w-4 mr-2" />
            DRL Settings
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Exposures</p>
                <p className="text-2xl font-bold text-blue-600">{radiationStats.totalExposures}</p>
              </div>
              <Zap className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Avg Dose/Study</p>
                <p className="text-2xl font-bold text-green-600">{radiationStats.avgDosePerStudy} mSv</p>
              </div>
              <Activity className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">DRL Exceeded</p>
                <p className="text-2xl font-bold text-red-600">{radiationStats.drlExceeded}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-red-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Pregnant Patients</p>
                <p className="text-2xl font-bold text-purple-600">{radiationStats.pregnantExposures}</p>
              </div>
              <User className="h-8 w-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Pediatric Studies</p>
                <p className="text-2xl font-bold text-orange-600">{radiationStats.pediatricExposures}</p>
              </div>
              <Baby className="h-8 w-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Compliance Rate</p>
                <p className="text-2xl font-bold text-teal-600">{radiationStats.complianceRate}%</p>
              </div>
              <TrendingUp className="h-8 w-8 text-teal-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-6">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="tracking">Dose Tracking</TabsTrigger>
          <TabsTrigger value="optimization">Optimization</TabsTrigger>
          <TabsTrigger value="pregnancy">Pregnancy Protocol</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="tracking" className="space-y-4">
          {/* Search */}
          <Card>
            <CardContent className="pt-6">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  placeholder="Search dose records by patient name, procedure, or modality..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </CardContent>
          </Card>

          {/* Dose Tracking Records */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Dose Tracking Records</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {filteredDoseTracking.map((record) => (
                  <div key={record.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div>
                          <div className="font-semibold text-lg">{record.patientName}</div>
                          <div className="text-sm text-muted-foreground">
                            {record.age}Y {record.gender} • ID: {record.patientId}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={`${record.modality === 'CT' ? 'bg-blue-100 text-blue-800' : 
                                         record.modality === 'XR' ? 'bg-green-100 text-green-800' : 
                                         record.modality === 'FL' ? 'bg-purple-100 text-purple-800' :
                                         'bg-gray-100 text-gray-800'}`}>
                          {record.modality}
                        </Badge>
                        {record.exceedsDrl && (
                          <Badge variant="destructive">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            DRL EXCEEDED
                          </Badge>
                        )}
                        {record.age < 18 && (
                          <Badge className="bg-orange-100 text-orange-800">
                            <Baby className="h-3 w-3 mr-1" />
                            PEDIATRIC
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm mb-4">
                      <div>
                        <div className="text-muted-foreground">Procedure</div>
                        <div className="font-medium">{record.procedure}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Body Part</div>
                        <div className="font-medium">{record.bodyPart}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Study Date</div>
                        <div className="font-medium">{new Date(record.studyDate).toLocaleDateString()}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Technologist</div>
                        <div className="font-medium">{record.technologist}</div>
                      </div>
                    </div>

                    {/* Dose Information */}
                    <div className="border-t pt-4 mb-4">
                      <div className="text-sm font-medium mb-2">Radiation Dose Information</div>
                      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 text-sm">
                        {record.effectiveDose && (
                          <div className="text-center p-2 bg-gray-50 rounded">
                            <div className={`text-lg font-bold ${getDoseColor(record.effectiveDose, record.modality)}`}>
                              {record.effectiveDose} mSv
                            </div>
                            <div className="text-xs text-muted-foreground">Effective Dose</div>
                          </div>
                        )}
                        {record.ctdi && (
                          <div className="text-center p-2 bg-gray-50 rounded">
                            <div className="text-lg font-bold text-blue-600">{record.ctdi} mGy</div>
                            <div className="text-xs text-muted-foreground">CTDI</div>
                          </div>
                        )}
                        {record.dlp && (
                          <div className="text-center p-2 bg-gray-50 rounded">
                            <div className={`text-lg font-bold ${record.exceedsDrl ? 'text-red-600' : 'text-green-600'}`}>
                              {record.dlp} mGy.cm
                            </div>
                            <div className="text-xs text-muted-foreground">DLP</div>
                            {record.drl && (
                              <div className="text-xs text-muted-foreground">DRL: {record.drl}</div>
                            )}
                          </div>
                        )}
                        {record.entranceSkinDose && (
                          <div className="text-center p-2 bg-gray-50 rounded">
                            <div className="text-lg font-bold text-purple-600">{record.entranceSkinDose} mGy</div>
                            <div className="text-xs text-muted-foreground">Entrance Skin Dose</div>
                          </div>
                        )}
                        {record.fluoroscopyTime && (
                          <div className="text-center p-2 bg-gray-50 rounded">
                            <div className="text-lg font-bold text-orange-600">{record.fluoroscopyTime}s</div>
                            <div className="text-xs text-muted-foreground">Fluoroscopy Time</div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Technical Parameters */}
                    {(record.kvp || record.mas) && (
                      <div className="border-t pt-4 mb-4">
                        <div className="text-sm font-medium mb-2">Technical Parameters</div>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
                          {record.kvp && (
                            <div>
                              <div className="text-muted-foreground">kVp</div>
                              <div className="font-medium">{record.kvp}</div>
                            </div>
                          )}
                          {record.mas && (
                            <div>
                              <div className="text-muted-foreground">mAs</div>
                              <div className="font-medium">{record.mas}</div>
                            </div>
                          )}
                          <div>
                            <div className="text-muted-foreground">Patient Weight</div>
                            <div className="font-medium">{record.patientWeight} kg</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Pregnancy Status</div>
                            <div className="font-medium">{record.pregnancyStatus.replace('_', ' ')}</div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Optimization Notes */}
                    {record.optimizationNotes && (
                      <div className="border-t pt-4 mb-4">
                        <div className="text-sm font-medium mb-1">Optimization Notes</div>
                        <div className="text-sm text-muted-foreground">{record.optimizationNotes}</div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="border-t pt-4 flex gap-2">
                      <Button size="sm" variant="outline">
                        <Eye className="h-4 w-4 mr-2" />
                        View Details
                      </Button>
                      <Button size="sm" variant="outline">
                        <BarChart3 className="h-4 w-4 mr-2" />
                        Dose History
                      </Button>
                      {record.exceedsDrl && (
                        <Button size="sm" variant="outline">
                          <AlertTriangle className="h-4 w-4 mr-2" />
                          Investigation
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="optimization" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Dose Optimization by Modality</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {doseOptimization.map((modality, index) => (
                  <div key={index} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <div className="font-semibold text-lg">{modality.modality}</div>
                        <div className="text-sm text-muted-foreground">{modality.totalStudies} studies</div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-center">
                          <div className="text-lg font-bold text-blue-600">{modality.avgDose}</div>
                          <div className="text-xs text-muted-foreground">Avg Dose (mSv)</div>
                        </div>
                        <div className="text-center">
                          <div className={`text-lg font-bold ${getComplianceColor(modality.drlCompliance)}`}>
                            {modality.drlCompliance}%
                          </div>
                          <div className="text-xs text-muted-foreground">DRL Compliance</div>
                        </div>
                      </div>
                    </div>
                    
                    <div>
                      <div className="text-sm font-medium mb-2">Optimization Actions Implemented</div>
                      <ul className="space-y-1">
                        {modality.optimizationActions.map((action, actionIndex) => (
                          <li key={actionIndex} className="text-sm text-muted-foreground flex items-center gap-2">
                            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                            {action}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pregnancy" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Pregnancy Protocol Management</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="text-center p-4 bg-purple-50 rounded-lg">
                    <div className="text-2xl font-bold text-purple-600">{pregnancyProtocol.totalPregnantPatients}</div>
                    <div className="text-sm text-muted-foreground">Pregnant Patients</div>
                  </div>
                  <div className="text-center p-4 bg-green-50 rounded-lg">
                    <div className="text-2xl font-bold text-green-600">{pregnancyProtocol.protocolCompliance}%</div>
                    <div className="text-sm text-muted-foreground">Protocol Compliance</div>
                  </div>
                  <div className="text-center p-4 bg-blue-50 rounded-lg">
                    <div className="text-2xl font-bold text-blue-600">0</div>
                    <div className="text-sm text-muted-foreground">Protocol Violations</div>
                  </div>
                </div>

                {pregnancyProtocol.procedures.map((procedure, index) => (
                  <div key={index} className="border rounded-lg p-4 bg-purple-50">
                    <div className="flex items-center gap-2 mb-3">
                      <User className="h-5 w-5 text-purple-600" />
                      <div className="font-semibold text-lg">{procedure.patientName}</div>
                      <Badge className="bg-purple-100 text-purple-800">
                        {procedure.gestationalAge}
                      </Badge>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-4">
                      <div>
                        <div className="text-muted-foreground">Procedure</div>
                        <div className="font-medium">{procedure.procedure}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Modality</div>
                        <div className="font-medium">{procedure.modality}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Radiation Dose</div>
                        <div className={`font-medium ${procedure.radiationDose === 0 ? 'text-green-600' : 'text-orange-600'}`}>
                          {procedure.radiationDose} mSv
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Consulting Physician</div>
                        <div className="font-medium">{procedure.consultingPhysician}</div>
                      </div>
                    </div>

                    <div className="border-t pt-3 space-y-2 text-sm">
                      <div>
                        <div className="text-muted-foreground font-medium">Clinical Justification</div>
                        <div>{procedure.justification}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground font-medium">Alternative Considered</div>
                        <div>{procedure.alternativeConsidered}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Radiation Safety Analytics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center text-muted-foreground">
                <BarChart3 className="h-16 w-16 mx-auto mb-4" />
                <div className="text-lg font-medium">Analytics Dashboard</div>
                <div className="text-sm">Detailed radiation dose analytics and trending charts would be displayed here</div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default RadiationSafety;