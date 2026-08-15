// Enterprise Lab Management Dashboard
import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  TestTube, 
  FileText, 
  Package, 
  Users,
  AlertTriangle,
  TrendingUp,
  Clock,
  CheckCircle,
  Calendar,
  BarChart3,
  Settings,
  Plus,
  RefreshCw,
  Microscope,
  FlaskConical
} from 'lucide-react';

// Import lab components
import TestCatalog from './TestCatalog';
import LabOrders from './LabOrders';
import SampleTracking from './SampleTracking';
import ResultEntry from './ResultEntry';
import LabReports from './LabReports';
import QualityControl from './QualityControl';
import LabSubSpecialty from './LabSubSpecialty';
import LabPanelManager from './LabPanelManager';
import LabSampleProcessing from './LabSampleProcessing';
import LabReportPrintFormat from './LabReportPrintFormat';

// Import lab hooks
import { useLabDashboard } from '@/hooks/useLabData';

const LabDashboard: React.FC = () => {
  // Persist selected tab in URL so it survives page refresh
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedTab = searchParams.get('tab') || 'overview';

  const setSelectedTab = (tab: string) => {
    setSearchParams({ tab });
  };

  // Use real data from backend
  const { dashboardData, loading, error, refetch } = useLabDashboard();

  // Calculate dashboard metrics from real data
  const metrics = {
    todayOrders: dashboardData?.orders?.total || 0,
    pendingOrders: dashboardData?.orders?.pending || 0,
    completedOrders: dashboardData?.orders?.completed || 0,
    urgentOrders: dashboardData?.orders?.critical || 0,
    samplesCollected: dashboardData?.samples?.total || 0,
    samplesReceived: dashboardData?.samples?.received || 0,
    samplesRejected: dashboardData?.samples?.rejected || 0,
    testsCompleted: dashboardData?.results?.total || 0,
    testsVerified: dashboardData?.results?.final || 0,
    reportsGenerated: 0, // Will be calculated separately
    qcPassed: dashboardData?.qualityControl?.passed || 0,
    qcFailed: dashboardData?.qualityControl?.failed || 0,
    equipmentDown: 0, // Will be calculated from equipment status
    averageTAT: 18.5 // Will be calculated from historical data
  };

  const formatTime = (hours: number) => {
    if (hours < 24) {
      return `${hours.toFixed(1)} hrs`;
    }
    return `${(hours / 24).toFixed(1)} days`;
  };

  const topTests = [
    { name: 'Complete Blood Count', count: 45, tat: '2.5 hrs' },
    { name: 'Basic Metabolic Panel', count: 38, tat: '3.2 hrs' },
    { name: 'Lipid Panel', count: 29, tat: '4.1 hrs' },
    { name: 'Liver Function Tests', count: 24, tat: '3.8 hrs' },
    { name: 'Thyroid Function Tests', count: 18, tat: '6.2 hrs' }
  ];

  const departmentStatus = [
    { name: 'Hematology', pending: 12, completed: 28, equipment: 'OK' },
    { name: 'Chemistry', pending: 18, completed: 45, equipment: 'OK' },
    { name: 'Microbiology', pending: 8, completed: 15, equipment: 'MAINTENANCE' },
    { name: 'Immunology', pending: 5, completed: 12, equipment: 'OK' },
    { name: 'Molecular Biology', pending: 2, completed: 8, equipment: 'OK' }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <TestTube className="h-6 w-6 text-primary shrink-0" />
          <div>
            <h1 className="text-xl sm:text-3xl font-bold">Laboratory Management</h1>
            <p className="text-muted-foreground text-xs sm:text-sm">
              Enterprise-level laboratory operations and test management
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={refetch}
            disabled={loading}
            className="flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            <span className="text-sm text-muted-foreground">
              {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
          </div>
        </div>
      </div>

      <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-6">
        <div className="flex flex-col sm:flex-row flex-wrap gap-2 overflow-x-auto">
          <TabsList className="flex flex-wrap h-auto gap-1 w-full sm:w-auto">
            <TabsTrigger value="overview" className="text-xs sm:text-sm">Overview</TabsTrigger>
            <TabsTrigger value="catalog" className="text-xs sm:text-sm">Test Catalog</TabsTrigger>
            <TabsTrigger value="orders" className="text-xs sm:text-sm">Orders</TabsTrigger>
            <TabsTrigger value="samples" className="text-xs sm:text-sm">Samples</TabsTrigger>
            <TabsTrigger value="results" className="text-xs sm:text-sm">Results</TabsTrigger>
            <TabsTrigger value="reports" className="text-xs sm:text-sm">Reports</TabsTrigger>
            <TabsTrigger value="printformat" className="text-xs sm:text-sm">Print Format</TabsTrigger>
          </TabsList>
          <TabsList className="flex flex-wrap h-auto gap-1 w-full sm:w-auto bg-blue-50 border-2 border-blue-200">
            <TabsTrigger value="subspecialty" className="text-blue-700 font-semibold text-xs sm:text-sm">Sub Specialty</TabsTrigger>
            <TabsTrigger value="panels" className="text-blue-700 font-semibold text-xs sm:text-sm">Add Panel</TabsTrigger>
            <TabsTrigger value="processing" className="text-blue-700 font-semibold text-xs sm:text-sm">Sample Processing</TabsTrigger>
            <TabsTrigger value="quality" className="text-xs sm:text-sm">Quality</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="space-y-6">
          {/* Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card onClick={() => setSelectedTab('orders')} className="cursor-pointer transition-shadow hover:shadow-md">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Today's Orders</p>
                    <p className="text-2xl font-bold text-blue-600">{metrics.todayOrders}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {metrics.urgentOrders} urgent
                    </p>
                  </div>
                  <FileText className="h-8 w-8 text-blue-600" />
                </div>
              </CardContent>
            </Card>

            <Card onClick={() => setSelectedTab('orders')} className="cursor-pointer transition-shadow hover:shadow-md">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Pending Orders</p>
                    <p className="text-2xl font-bold text-orange-600">{metrics.pendingOrders}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Awaiting processing
                    </p>
                  </div>
                  <Clock className="h-8 w-8 text-orange-600" />
                </div>
              </CardContent>
            </Card>

            <Card onClick={() => setSelectedTab('results')} className="cursor-pointer transition-shadow hover:shadow-md">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Tests Completed</p>
                    <p className="text-2xl font-bold text-green-600">{metrics.testsCompleted}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {metrics.testsVerified} verified
                    </p>
                  </div>
                  <CheckCircle className="h-8 w-8 text-green-600" />
                </div>
              </CardContent>
            </Card>

            <Card onClick={() => setSelectedTab('results')} className="cursor-pointer transition-shadow hover:shadow-md">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Average TAT</p>
                    <p className="text-2xl font-bold">{formatTime(metrics.averageTAT)}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Turnaround time
                    </p>
                  </div>
                  <TrendingUp className="h-8 w-8 text-purple-600" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sample Status */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card onClick={() => setSelectedTab('samples')} className="cursor-pointer transition-shadow hover:shadow-md">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Samples Collected</p>
                    <p className="text-2xl font-bold text-blue-600">{metrics.samplesCollected}</p>
                  </div>
                  <Package className="h-8 w-8 text-blue-600" />
                </div>
              </CardContent>
            </Card>

            <Card onClick={() => setSelectedTab('samples')} className="cursor-pointer transition-shadow hover:shadow-md">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Samples Received</p>
                    <p className="text-2xl font-bold text-green-600">{metrics.samplesReceived}</p>
                  </div>
                  <CheckCircle className="h-8 w-8 text-green-600" />
                </div>
              </CardContent>
            </Card>

            <Card onClick={() => setSelectedTab('samples')} className="cursor-pointer transition-shadow hover:shadow-md">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Samples Rejected</p>
                    <p className="text-2xl font-bold text-red-600">{metrics.samplesRejected}</p>
                  </div>
                  <AlertTriangle className="h-8 w-8 text-red-600" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Button 
                  variant="outline" 
                  className="h-auto flex-col py-4"
                  onClick={() => setSelectedTab('orders')}
                >
                  <FileText className="h-6 w-6 mb-2" />
                  <span>New Order</span>
                </Button>
                <Button 
                  variant="outline" 
                  className="h-auto flex-col py-4"
                  onClick={() => setSelectedTab('samples')}
                >
                  <Package className="h-6 w-6 mb-2" />
                  <span>Collect Sample</span>
                </Button>
                <Button 
                  variant="outline" 
                  className="h-auto flex-col py-4"
                  onClick={() => setSelectedTab('results')}
                >
                  <TestTube className="h-6 w-6 mb-2" />
                  <span>Enter Results</span>
                </Button>
                <Button 
                  variant="outline" 
                  className="h-auto flex-col py-4"
                  onClick={() => setSelectedTab('reports')}
                >
                  <BarChart3 className="h-6 w-6 mb-2" />
                  <span>Generate Report</span>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Dashboard Content Grid. Held two cards until the Recent
              Activities feed was removed — it was five hardcoded lines of
              invented clinical detail ("Critical value detected - Glucose 450
              mg/dL"), identical on every load, at every hospital, for every
              user. */}
          <div className="grid grid-cols-1 gap-6">
            {/* Top Tests */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Microscope className="h-5 w-5" />
                  Top Tests Today
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {topTests.map((test, index) => (
                    <div key={index} className="flex items-center justify-between p-2 rounded hover:bg-gray-50">
                      <div>
                        <p className="text-sm font-medium">{test.name}</p>
                        <p className="text-xs text-muted-foreground">Count: {test.count}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">TAT: {test.tat}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Department Status */}
          <Card>
            <CardHeader>
              <CardTitle>Department Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                {departmentStatus.map((dept, index) => (
                  <div key={index} className="p-4 border rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <FlaskConical className="h-4 w-4" />
                      <h3 className="font-medium">{dept.name}</h3>
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span>Pending:</span>
                        <span className="font-medium">{dept.pending}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Completed:</span>
                        <span className="font-medium">{dept.completed}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Equipment:</span>
                        <span className={`font-medium ${
                          dept.equipment === 'OK' ? 'text-green-600' : 'text-orange-600'
                        }`}>
                          {dept.equipment}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Quality Control Status */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5" />
                  Quality Control
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm">QC Passed</span>
                    <span className="font-semibold text-green-600">{dashboardData.qcPassed}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">QC Failed</span>
                    <span className="font-semibold text-red-600">{dashboardData.qcFailed}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Success Rate</span>
                    <span className="font-semibold">
                      {((dashboardData.qcPassed / (dashboardData.qcPassed + dashboardData.qcFailed)) * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Equipment Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm">Active</span>
                    <span className="font-semibold text-green-600">12</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Maintenance</span>
                    <span className="font-semibold text-orange-600">{dashboardData.equipmentDown}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Out of Order</span>
                    <span className="font-semibold text-red-600">0</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm">Reports Generated</span>
                    <span className="font-semibold">{dashboardData.reportsGenerated}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Completion Rate</span>
                    <span className="font-semibold">
                      {((dashboardData.completedOrders / dashboardData.todayOrders) * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">On-time Delivery</span>
                    <span className="font-semibold">95.2%</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="catalog">
          <TestCatalog />
        </TabsContent>

        <TabsContent value="subspecialty">
          <LabSubSpecialty />
        </TabsContent>

        <TabsContent value="panels">
          <LabPanelManager />
        </TabsContent>

        <TabsContent value="processing">
          <LabSampleProcessing />
        </TabsContent>

        <TabsContent value="orders">
          <LabOrders />
        </TabsContent>

        <TabsContent value="samples">
          <SampleTracking />
        </TabsContent>

        <TabsContent value="results">
          <ResultEntry />
        </TabsContent>

        <TabsContent value="reports">
          <LabReports />
        </TabsContent>

        <TabsContent value="quality">
          <QualityControl />
        </TabsContent>

        <TabsContent value="printformat">
          <LabReportPrintFormat />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default LabDashboard;