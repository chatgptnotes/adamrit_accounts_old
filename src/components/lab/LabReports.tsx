// Lab Reports Component
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  BarChart3, 
  TrendingUp, 
  FileText,
  Download,
  Calendar,
  Users,
  TestTube,
  Clock,
  DollarSign
} from 'lucide-react';

const LabReports: React.FC = () => {
  const [selectedReport, setSelectedReport] = useState('productivity');
  const [dateRange, setDateRange] = useState({ from: '2025-06-01', to: '2025-06-13' });

  const formatCurrency = (amount: number) => 
    new Intl.NumberFormat('en-IN', { 
      style: 'currency', 
      currency: 'INR',
      minimumFractionDigits: 0
    }).format(amount);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-6 w-6 text-primary" />
          <div>
            <h2 className="text-2xl font-bold">Laboratory Reports & Analytics</h2>
            <p className="text-sm text-muted-foreground">
              Generate comprehensive lab performance and analytics reports
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export PDF
          </Button>
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export Excel
          </Button>
        </div>
      </div>

      {/* Report Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Report Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-sm font-medium">Report Type</label>
              <select
                className="w-full p-2 border rounded"
                value={selectedReport}
                onChange={(e) => setSelectedReport(e.target.value)}
              >
                <option value="productivity">Productivity Report</option>
                <option value="quality">Quality Report</option>
                <option value="financial">Financial Report</option>
                <option value="turnaround">Turnaround Time Report</option>
              </select>
            </div>
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
            <div className="flex items-end">
              <Button className="w-full">
                <FileText className="h-4 w-4 mr-2" />
                Generate Report
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={selectedReport} onValueChange={setSelectedReport} className="space-y-6">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="productivity">Productivity</TabsTrigger>
          <TabsTrigger value="quality">Quality</TabsTrigger>
          <TabsTrigger value="financial">Financial</TabsTrigger>
          <TabsTrigger value="turnaround">TAT Analysis</TabsTrigger>
        </TabsList>

        <TabsContent value="productivity" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Orders</p>
                    <p className="text-2xl font-bold">1,247</p>
                  </div>
                  <FileText className="h-8 w-8 text-blue-600" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Tests</p>
                    <p className="text-2xl font-bold">5,678</p>
                  </div>
                  <TestTube className="h-8 w-8 text-green-600" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Avg TAT</p>
                    <p className="text-2xl font-bold">18.5 hrs</p>
                  </div>
                  <Clock className="h-8 w-8 text-orange-600" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Revenue</p>
                    <p className="text-2xl font-bold">{formatCurrency(2876540)}</p>
                  </div>
                  <DollarSign className="h-8 w-8 text-purple-600" />
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Department-wise Performance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[
                  { dept: 'Hematology', orders: 345, tests: 1250, tat: '2.5 hrs' },
                  { dept: 'Chemistry', orders: 567, tests: 2100, tat: '3.2 hrs' },
                  { dept: 'Immunology', orders: 234, tests: 890, tat: '6.5 hrs' },
                  { dept: 'Microbiology', orders: 101, tests: 438, tat: '24 hrs' }
                ].map((dept, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                    <div className="font-medium">{dept.dept}</div>
                    <div className="flex gap-6 text-sm">
                      <span>Orders: {dept.orders}</span>
                      <span>Tests: {dept.tests}</span>
                      <span>TAT: {dept.tat}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="quality" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Quality Metrics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="text-center">
                  <div className="text-3xl font-bold text-green-600">98.5%</div>
                  <div className="text-sm text-muted-foreground">QC Pass Rate</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-orange-600">2.1%</div>
                  <div className="text-sm text-muted-foreground">Sample Rejection Rate</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-blue-600">15</div>
                  <div className="text-sm text-muted-foreground">Critical Values</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="financial" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Financial Performance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="text-center">
                  <div className="text-3xl font-bold text-green-600">{formatCurrency(2876540)}</div>
                  <div className="text-sm text-muted-foreground">Total Revenue</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-blue-600">{formatCurrency(2650000)}</div>
                  <div className="text-sm text-muted-foreground">Collected</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-orange-600">{formatCurrency(226540)}</div>
                  <div className="text-sm text-muted-foreground">Outstanding</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="turnaround" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Turnaround Time Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="text-center">
                  <div className="text-3xl font-bold text-green-600">85%</div>
                  <div className="text-sm text-muted-foreground">On-time Delivery</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-blue-600">18.5 hrs</div>
                  <div className="text-sm text-muted-foreground">Average TAT</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-orange-600">12%</div>
                  <div className="text-sm text-muted-foreground">Delayed Reports</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default LabReports;