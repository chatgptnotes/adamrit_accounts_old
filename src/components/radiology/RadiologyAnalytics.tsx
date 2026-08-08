// Radiology Analytics Component
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  BarChart3, 
  TrendingUp, 
  Download,
  Calendar,
  Users,
  Activity,
  Clock,
  DollarSign,
  Camera,
  FileText,
  AlertTriangle,
  CheckCircle
} from 'lucide-react';

const RadiologyAnalytics: React.FC = () => {
  const [dateRange, setDateRange] = useState({ from: '2025-06-01', to: '2025-06-13' });
  const [selectedMetric, setSelectedMetric] = useState('productivity');

  const analyticsData = {
    productivity: {
      totalStudies: 1847,
      avgStudiesPerDay: 142,
      peakHour: '10:00 AM',
      modalityUtilization: [
        { modality: 'CT', studies: 445, utilization: 89, revenue: 1567500 },
        { modality: 'MRI', studies: 289, utilization: 72, revenue: 2453000 },
        { modality: 'XR', studies: 678, utilization: 68, revenue: 339000 },
        { modality: 'US', studies: 234, utilization: 58, revenue: 351000 },
        { modality: 'MG', studies: 156, utilization: 65, revenue: 390000 },
        { modality: 'FL', studies: 45, utilization: 38, revenue: 202500 }
      ]
    },
    quality: {
      reportAccuracy: 97.8,
      avgTurnaroundTime: 4.2,
      criticalValueCompliance: 98.5,
      patientSatisfaction: 4.6,
      qualityMetrics: [
        { metric: 'Report Accuracy', value: 97.8, target: 95, status: 'good' },
        { metric: 'Turnaround Time', value: 4.2, target: 6, status: 'good' },
        { metric: 'Critical Value Notification', value: 98.5, target: 95, status: 'excellent' },
        { metric: 'Patient Satisfaction', value: 4.6, target: 4.0, status: 'excellent' },
        { metric: 'Equipment Uptime', value: 96.8, target: 95, status: 'good' },
        { metric: 'Radiation Compliance', value: 94.2, target: 98, status: 'needs_improvement' }
      ]
    },
    financial: {
      totalRevenue: 5303000,
      avgRevenuePerStudy: 2870,
      topProcedures: [
        { procedure: 'MRI Brain with contrast', count: 89, revenue: 765000 },
        { procedure: 'CT Chest with contrast', count: 125, revenue: 687500 },
        { procedure: 'CT Brain without contrast', count: 156, revenue: 546000 },
        { procedure: 'Abdominal Ultrasound', count: 178, revenue: 267000 },
        { procedure: 'Mammography Screening', count: 156, revenue: 390000 }
      ]
    },
    radiologist: {
      totalRadiologists: 4,
      avgReportsPerDay: 38,
      performanceMetrics: [
        { 
          name: 'Dr. Rajesh Kumar', 
          reports: 342, 
          avgTime: 18.5, 
          accuracy: 98.2, 
          criticalFindings: 12,
          specialties: ['Neuroradiology', 'Emergency']
        },
        { 
          name: 'Dr. Priya Sharma', 
          reports: 298, 
          avgTime: 22.1, 
          accuracy: 97.8, 
          criticalFindings: 8,
          specialties: ['Musculoskeletal', 'Sports Medicine']
        },
        { 
          name: 'Dr. Amit Patel', 
          reports: 267, 
          avgTime: 15.8, 
          accuracy: 98.5, 
          criticalFindings: 15,
          specialties: ['Cardiac', 'Thoracic']
        },
        { 
          name: 'Dr. Sunita Reddy', 
          reports: 234, 
          avgTime: 20.3, 
          accuracy: 97.5, 
          criticalFindings: 6,
          specialties: ['Breast Imaging', 'Women\'s Health']
        }
      ]
    }
  };

  const formatCurrency = (amount: number) => 
    new Intl.NumberFormat('en-IN', { 
      style: 'currency', 
      currency: 'INR',
      minimumFractionDigits: 0
    }).format(amount);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'excellent': return 'text-green-600';
      case 'good': return 'text-blue-600';
      case 'needs_improvement': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'excellent': return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'good': return <TrendingUp className="h-4 w-4 text-blue-600" />;
      case 'needs_improvement': return <AlertTriangle className="h-4 w-4 text-red-600" />;
      default: return <Activity className="h-4 w-4 text-gray-600" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-6 w-6 text-primary" />
          <div>
            <h2 className="text-2xl font-bold">Radiology Analytics</h2>
            <p className="text-sm text-muted-foreground">
              Comprehensive performance metrics and insights
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export Report
          </Button>
          <Button variant="outline">
            <Calendar className="h-4 w-4 mr-2" />
            Custom Range
          </Button>
        </div>
      </div>

      {/* Date Range Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Report Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-sm font-medium">From Date</label>
              <Input
                type="date"
                value={dateRange.from}
                onChange={(e) => setDateRange(prev => ({ ...prev, from: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium">To Date</label>
              <Input
                type="date"
                value={dateRange.to}
                onChange={(e) => setDateRange(prev => ({ ...prev, to: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Report Type</label>
              <select
                className="w-full p-2 border rounded"
                value={selectedMetric}
                onChange={(e) => setSelectedMetric(e.target.value)}
              >
                <option value="productivity">Productivity Analysis</option>
                <option value="quality">Quality Metrics</option>
                <option value="financial">Financial Performance</option>
                <option value="radiologist">Radiologist Performance</option>
              </select>
            </div>
            <div className="flex items-end">
              <Button className="w-full">
                <BarChart3 className="h-4 w-4 mr-2" />
                Generate Report
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={selectedMetric} onValueChange={setSelectedMetric} className="space-y-6">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="productivity">Productivity</TabsTrigger>
          <TabsTrigger value="quality">Quality</TabsTrigger>
          <TabsTrigger value="financial">Financial</TabsTrigger>
          <TabsTrigger value="radiologist">Radiologists</TabsTrigger>
        </TabsList>

        <TabsContent value="productivity" className="space-y-6">
          {/* Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Studies</p>
                    <p className="text-2xl font-bold text-blue-600">{analyticsData.productivity.totalStudies.toLocaleString()}</p>
                  </div>
                  <Camera className="h-8 w-8 text-blue-600" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Avg Studies/Day</p>
                    <p className="text-2xl font-bold text-green-600">{analyticsData.productivity.avgStudiesPerDay}</p>
                  </div>
                  <TrendingUp className="h-8 w-8 text-green-600" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Peak Hour</p>
                    <p className="text-2xl font-bold text-purple-600">{analyticsData.productivity.peakHour}</p>
                  </div>
                  <Clock className="h-8 w-8 text-purple-600" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Revenue</p>
                    <p className="text-2xl font-bold text-orange-600">{formatCurrency(analyticsData.financial.totalRevenue)}</p>
                  </div>
                  <DollarSign className="h-8 w-8 text-orange-600" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Modality Performance */}
          <Card>
            <CardHeader>
              <CardTitle>Modality Performance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {analyticsData.productivity.modalityUtilization.map((modality, index) => (
                  <div key={index} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-4">
                      <div className="font-medium text-lg">{modality.modality}</div>
                      <div className="text-sm text-muted-foreground">
                        {modality.studies} studies
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-center">
                        <div className="text-sm text-muted-foreground">Utilization</div>
                        <div className="font-bold">{modality.utilization}%</div>
                        <div className="w-24 bg-gray-200 rounded-full h-2 mt-1">
                          <div 
                            className={`h-2 rounded-full ${
                              modality.utilization >= 80 ? 'bg-red-500' :
                              modality.utilization >= 60 ? 'bg-yellow-500' :
                              'bg-green-500'
                            }`}
                            style={{ width: `${modality.utilization}%` }}
                          />
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-sm text-muted-foreground">Revenue</div>
                        <div className="font-bold text-green-600">{formatCurrency(modality.revenue)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="quality" className="space-y-6">
          {/* Quality Metrics Overview */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4">
                <div className="text-center">
                  <div className="text-3xl font-bold text-green-600">{analyticsData.quality.reportAccuracy}%</div>
                  <div className="text-sm text-muted-foreground">Report Accuracy</div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="text-center">
                  <div className="text-3xl font-bold text-blue-600">{analyticsData.quality.avgTurnaroundTime}h</div>
                  <div className="text-sm text-muted-foreground">Avg Turnaround</div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="text-center">
                  <div className="text-3xl font-bold text-purple-600">{analyticsData.quality.criticalValueCompliance}%</div>
                  <div className="text-sm text-muted-foreground">Critical Value Compliance</div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="text-center">
                  <div className="text-3xl font-bold text-orange-600">{analyticsData.quality.patientSatisfaction}/5</div>
                  <div className="text-sm text-muted-foreground">Patient Satisfaction</div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Detailed Quality Metrics */}
          <Card>
            <CardHeader>
              <CardTitle>Quality Performance Indicators</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {analyticsData.quality.qualityMetrics.map((metric, index) => (
                  <div key={index} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-3">
                      {getStatusIcon(metric.status)}
                      <div>
                        <div className="font-medium">{metric.metric}</div>
                        <div className="text-sm text-muted-foreground">Target: {metric.target}{metric.metric.includes('Satisfaction') ? '/5' : '%'}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-xl font-bold ${getStatusColor(metric.status)}`}>
                        {metric.value}{metric.metric.includes('Satisfaction') ? '/5' : '%'}
                      </div>
                      <Badge className={
                        metric.status === 'excellent' ? 'bg-green-100 text-green-800' :
                        metric.status === 'good' ? 'bg-blue-100 text-blue-800' :
                        'bg-red-100 text-red-800'
                      }>
                        {metric.status.replace('_', ' ').toUpperCase()}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="financial" className="space-y-6">
          {/* Financial Overview */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-4">
                <div className="text-center">
                  <div className="text-3xl font-bold text-green-600">{formatCurrency(analyticsData.financial.totalRevenue)}</div>
                  <div className="text-sm text-muted-foreground">Total Revenue</div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="text-center">
                  <div className="text-3xl font-bold text-blue-600">{formatCurrency(analyticsData.financial.avgRevenuePerStudy)}</div>
                  <div className="text-sm text-muted-foreground">Avg Revenue/Study</div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="text-center">
                  <div className="text-3xl font-bold text-purple-600">{analyticsData.productivity.totalStudies}</div>
                  <div className="text-sm text-muted-foreground">Total Studies</div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Top Procedures by Revenue */}
          <Card>
            <CardHeader>
              <CardTitle>Top Procedures by Revenue</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {analyticsData.financial.topProcedures.map((procedure, index) => (
                  <div key={index} className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <div className="font-medium">{procedure.procedure}</div>
                      <div className="text-sm text-muted-foreground">{procedure.count} procedures</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-green-600">{formatCurrency(procedure.revenue)}</div>
                      <div className="text-sm text-muted-foreground">{formatCurrency(procedure.revenue / procedure.count)}/study</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="radiologist" className="space-y-6">
          {/* Radiologist Overview */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Radiologists</p>
                    <p className="text-2xl font-bold text-blue-600">{analyticsData.radiologist.totalRadiologists}</p>
                  </div>
                  <Users className="h-8 w-8 text-blue-600" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Avg Reports/Day</p>
                    <p className="text-2xl font-bold text-green-600">{analyticsData.radiologist.avgReportsPerDay}</p>
                  </div>
                  <FileText className="h-8 w-8 text-green-600" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Reports</p>
                    <p className="text-2xl font-bold text-purple-600">
                      {analyticsData.radiologist.performanceMetrics.reduce((sum, r) => sum + r.reports, 0)}
                    </p>
                  </div>
                  <Activity className="h-8 w-8 text-purple-600" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Critical Findings</p>
                    <p className="text-2xl font-bold text-red-600">
                      {analyticsData.radiologist.performanceMetrics.reduce((sum, r) => sum + r.criticalFindings, 0)}
                    </p>
                  </div>
                  <AlertTriangle className="h-8 w-8 text-red-600" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Individual Radiologist Performance */}
          <Card>
            <CardHeader>
              <CardTitle>Individual Performance Metrics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {analyticsData.radiologist.performanceMetrics.map((radiologist, index) => (
                  <div key={index} className="p-4 border rounded-lg">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <div className="font-semibold text-lg">{radiologist.name}</div>
                        <div className="text-sm text-muted-foreground">
                          Specialties: {radiologist.specialties.join(', ')}
                        </div>
                      </div>
                      <Badge className="bg-blue-100 text-blue-800">
                        Active
                      </Badge>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-blue-600">{radiologist.reports}</div>
                        <div className="text-muted-foreground">Reports Completed</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-green-600">{radiologist.avgTime} min</div>
                        <div className="text-muted-foreground">Avg Reporting Time</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-purple-600">{radiologist.accuracy}%</div>
                        <div className="text-muted-foreground">Accuracy Rate</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-red-600">{radiologist.criticalFindings}</div>
                        <div className="text-muted-foreground">Critical Findings</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default RadiologyAnalytics;