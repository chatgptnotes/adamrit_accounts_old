// @ts-nocheck
// Enhanced Radiology Orders Component - Dashboard Style
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  FileText,
  Search,
  Download,
  Edit,
  Eye,
  User,
  RefreshCw,
  CalendarIcon,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import { RadiologyResultDialog } from './RadiologyResultDialog';
import {
  RadiologyImageReportDialog,
  type RadiologyImageReportTarget,
} from './RadiologyImageReportDialog';

interface EnhancedRadiologyOrdersProps {
  onBack?: () => void;
}

const EnhancedRadiologyOrders: React.FC<EnhancedRadiologyOrdersProps> = ({ onBack }) => {
  const [searchTerm, setSearchTerm] = useState('');
  // Set default dates to current month range
  const [fromDate, setFromDate] = useState<Date | undefined>(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1); // First day of current month
  });
  const [toDate, setToDate] = useState<Date | undefined>(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth() + 1, 0); // Last day of current month
  });
  const [selectedStatus, setSelectedStatus] = useState('all');
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Dialog states
  const [resultDialogOpen, setResultDialogOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [imageReportTarget, setImageReportTarget] =
    useState<RadiologyImageReportTarget | null>(null);

  // Fetch real radiology orders data
  const { data: radiologyOrders = [], isLoading, error, refetch } = useQuery({
    queryKey: ['radiology-orders', searchTerm, selectedStatus, fromDate, toDate],
    queryFn: async () => {
      
      let query = supabase
        .from('visit_radiology')
        .select(`
          id,
          status,
          ordered_date,
          scheduled_date,
          completed_date,
          findings,
          impression,
          notes,
          visit_id,
          radiology:radiology_id (
            name,
            description,
            category
          ),
          visits:visit_id (
            patient_id,
            patient_type,
            patients:patient_id (
              id,
              name,
              age,
              gender,
              phone,
              patients_id,
              address
            )
          )
        `)
        .order('ordered_date', { ascending: false });

      // Apply filters
      if (selectedStatus && selectedStatus !== 'all') {
        query = query.eq('status', selectedStatus);
      }
      
      // Apply date range filter
      if (fromDate) {
        query = query.gte('ordered_date', fromDate.toISOString());
      }
      
      if (toDate) {
        // Set time to end of day for toDate
        const endOfToDate = new Date(toDate);
        endOfToDate.setHours(23, 59, 59, 999);
        query = query.lte('ordered_date', endOfToDate.toISOString());
      }
      
      if (searchTerm) {
        // Search in patient name - we'll filter after getting data since we need to search in nested objects
      }

      const { data, error: queryError } = await query;

      if (queryError) {
        console.error('Error fetching radiology orders:', queryError);
        throw queryError;
      }


      // Group data by visit for better display
      const groupedByVisit = {};
      (data || []).forEach((item) => {
        const patient = item.visits?.patients;
        const visitKey = item.visit_id || `unknown-${item.id}`;
        
        if (!groupedByVisit[visitKey]) {
          groupedByVisit[visitKey] = {
            patient: patient,
            visitId: item.visit_id,
            patientType: item.visits?.patient_type || 'OPD',
            orders: []
          };
        }
        
        groupedByVisit[visitKey].orders.push(item);
      });

            // Transform the grouped data to match our UI format
      const transformedData = [];
      let serialNumber = 1;
      
      Object.keys(groupedByVisit).forEach(visitKey => {
        const visitGroup = groupedByVisit[visitKey];
        const patient = visitGroup.patient;
        const visitId = visitGroup.visitId;
        
        visitGroup.orders.forEach((item, orderIndex) => {
          const radiologyInfo = item.radiology;
          const isFirstOrderForVisit = orderIndex === 0;
          
          transformedData.push({
            id: item.id,
            srNo: isFirstOrderForVisit ? serialNumber : '',
            sex: isFirstOrderForVisit ? (patient?.gender || 'Unknown') : '',
            patientName: isFirstOrderForVisit ? (patient?.name || 'Unknown Patient') : '',
            patientId: isFirstOrderForVisit ? (patient?.patients_id || visitId || '-') : '',
            service: radiologyInfo?.name || 'Unknown Service',
            primaryCareProvider: '', // Can be added later from visit data
            status: item.status || 'ordered',
            orderDate: item.ordered_date ? new Date(item.ordered_date).toLocaleString() : 'Unknown Date',
            icon: isFirstOrderForVisit ? (patient?.gender === 'Male' ? '👨‍⚕️' : '👩‍⚕️') : '',
            visitId: item.visit_id,
            // Carried on every row (not only the group header) so View Image
            // can find the patient's uploads from whichever order was clicked.
            // Prefer the visit's patient FK, with the joined patient row as a
            // fallback. Older rows can have one nested value missing even
            // though the order and patient are both valid.
            patientUuid: item.visits?.patient_id || item.visits?.patients?.id || null,
            patientDisplayName: patient?.name || 'Unknown Patient',
            patientCode: patient?.patients_id || null,
            patientAge: patient?.age ?? null,
            patientGender: patient?.gender ?? null,
            findings: item.findings,
            impression: item.impression,
            notes: item.notes,
            isFirstInGroup: isFirstOrderForVisit,
            visitKey: visitKey,
            patientType: visitGroup.patientType
          });
          
          // Only increment serial number for first order of each visit
          if (isFirstOrderForVisit) {
            serialNumber++;
          }
        });
      });

      // Sort IPD (admitted) patients to the top
      const visitKeys = [...new Set(transformedData.map(d => d.visitKey))];
      const visitKeyOrder = visitKeys.sort((a, b) => {
        const aIsIPD = groupedByVisit[a]?.patientType === 'IPD' ? 0 : 1;
        const bIsIPD = groupedByVisit[b]?.patientType === 'IPD' ? 0 : 1;
        return aIsIPD - bIsIPD;
      });
      transformedData.sort((a, b) => {
        return visitKeyOrder.indexOf(a.visitKey) - visitKeyOrder.indexOf(b.visitKey);
      });

      // Re-assign serial numbers after sorting
      let newSerial = 1;
      transformedData.forEach(item => {
        if (item.isFirstInGroup) {
          item.srNo = newSerial++;
        }
      });

      // Apply search filter after transformation
      const filteredData = transformedData.filter(order => {
        if (!searchTerm) return true;
        // Search should work on original patient data, not the displayed data
        const visitGroup = groupedByVisit[order.visitKey];
        const patient = visitGroup?.patient;
        const visitId = visitGroup?.visitId;
        
        return (patient?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                visitId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                order.service.toLowerCase().includes(searchTerm.toLowerCase()));
      });

      
      return filteredData;
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });

  // Calculate stats from real data
  const orderStats = {
    pending: radiologyOrders.filter(order => order.status === 'ordered' || order.status === 'scheduled').length,
    completed: radiologyOrders.filter(order => order.status === 'completed').length,
    total: radiologyOrders.length
  };

  // Reset to page 1 when filters or page size change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedStatus, fromDate, toDate, pageSize]);

  const filteredOrders = radiologyOrders;
  const totalPages = Math.ceil(filteredOrders.length / pageSize);
  const paginatedOrders = filteredOrders.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const handleExportExcel = () => {
    // Export functionality will be implemented
  };

  const handlePACS = () => {
    // PACS functionality will be implemented
  };

  const handleEnterResult = (orderId: string) => {
    const order = radiologyOrders.find(o => o.id === orderId);
    if (order) {
      setSelectedOrder(order);
      setResultDialogOpen(true);
    }
  };

  // The images the Sonali tile uploads against the patient, plus the AI draft
  // report the radiologist reviews and approves. This used to be an empty
  // stub, which is why the button appeared to do nothing.
  const handleViewDICOM = (orderId: string) => {
    const order = (radiologyOrders || []).find((o: any) => o.id === orderId);
    if (!order) return;
    setImageReportTarget({
      orderId: order.id,
      patientUuid: order.patientUuid ?? null,
      patientName: order.patientDisplayName || order.patientName || 'Patient',
      patientCode: order.patientCode ?? null,
      patientAge: order.patientAge ?? null,
      patientGender: order.patientGender ?? null,
      visitId: order.visitId ?? null,
      serviceName: order.service ?? null,
      findings: order.findings ?? null,
      impression: order.impression ?? null,
    });
  };

  const resetToCurrentMonth = () => {
    const today = new Date();
    setFromDate(new Date(today.getFullYear(), today.getMonth(), 1));
    setToDate(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  };

  return (
    <div className="space-y-6">
      {/* Header + Filters Compact Layout */}
      <div className="space-y-3">
        {/* Row 1: Title left, Quick buttons right */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Radiology Dashboard</h2>
            <p className="text-sm text-muted-foreground">
              Enterprise-level radiology operations and imaging management
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={resetToCurrentMonth} className="text-xs">
              📅 This Month
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { const today = new Date(); setFromDate(today); setToDate(today); }}
              className="text-xs"
            >
              📆 Today
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setFromDate(undefined); setToDate(undefined); }}
              className="text-xs text-red-600 border-red-300 hover:bg-red-50"
            >
              ✕ Clear Dates
            </Button>
            {onBack && (
              <Button variant="outline" size="sm" onClick={onBack}>Back</Button>
            )}
          </div>
        </div>

        {/* Row 2: All filters in one row */}
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            placeholder="Patient Name"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-[180px]"
          />
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-[150px] justify-start text-left font-normal">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {fromDate ? format(fromDate, "dd/MM/yyyy") : "From Date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={fromDate} onSelect={setFromDate} initialFocus defaultMonth={fromDate || new Date()} today={new Date()} />
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-[150px] justify-start text-left font-normal">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {toDate ? format(toDate, "dd/MM/yyyy") : "To Date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={toDate} onSelect={setToDate} initialFocus defaultMonth={toDate || new Date()} today={new Date()} />
            </PopoverContent>
          </Popover>
          <Select value={selectedStatus} onValueChange={setSelectedStatus}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="in-progress">In Progress</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => refetch()}>
            <Search className="h-4 w-4 mr-2" />
            Search
          </Button>
          <Button variant="outline" onClick={handlePACS}>
            PACS
          </Button>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex justify-center items-center py-8">
          <div className="text-muted-foreground">Loading radiology orders...</div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="text-red-600 text-center py-4">
          Error loading radiology orders: {error.message}
        </div>
      )}

      {/* Stats Bar */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="text-center text-sm">
          <span className="text-red-600 font-semibold">Pending: {orderStats.pending}</span>
          <span className="mx-4">|</span>
          <span className="text-green-600 font-semibold">Completed: {orderStats.completed}</span>
          <span className="mx-4">|</span>
          <span className="text-blue-600 font-semibold">Total: {orderStats.total}</span>
          <span className="mx-4">|</span>
        </div>
      </div>

      {/* Export Controls */}
      <div className="flex justify-start gap-2">
        <Button variant="outline" onClick={handleExportExcel} className="bg-green-600 text-white hover:bg-green-700">
          <Download className="h-4 w-4 mr-2" />
          Download as Excel
        </Button>
        <Button variant="outline" onClick={handlePACS} className="bg-blue-600 text-white hover:bg-blue-700">
          PACS
        </Button>
      </div>

      {/* Main Data Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-100">
                  <TableHead className="w-16">Sr.No</TableHead>
                  <TableHead className="w-16">Sex</TableHead>
                  <TableHead className="min-w-[150px]">Patient Name</TableHead>
                  <TableHead className="min-w-[120px]">Visit ID</TableHead>
                  <TableHead className="min-w-[200px]">Service</TableHead>
                  <TableHead className="min-w-[150px]">Primary care provider</TableHead>
                  <TableHead className="w-20">Status</TableHead>
                  <TableHead className="min-w-[150px]">Order Date</TableHead>
                  <TableHead className="w-32">Enter Rad Result</TableHead>
                  <TableHead className="w-32">View Image</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedOrders.map((order, index) => {
                  // Check if this is the first row for a new patient group
                  const isNewPatientGroup = order.isFirstInGroup;
                  const isLastOrderForPatient = index === paginatedOrders.length - 1 ||
                    (index < paginatedOrders.length - 1 && paginatedOrders[index + 1].isFirstInGroup);
                  
                  return (
                    <TableRow 
                      key={order.id} 
                      className={`
                        hover:bg-gray-50 
                        ${isNewPatientGroup ? 'border-t-2 border-blue-200' : ''} 
                        ${isLastOrderForPatient ? 'border-b border-gray-300' : 'border-b border-gray-100'}
                      `}
                    >
                      <TableCell className="text-center">{order.srNo}</TableCell>
                      <TableCell className="text-center">
                        <span className="text-2xl">{order.icon}</span>
                      </TableCell>
                      <TableCell className={`font-medium ${isNewPatientGroup ? 'font-bold text-blue-700' : 'text-gray-400'}`}>
                        {order.patientName}
                      </TableCell>
                      <TableCell className={isNewPatientGroup ? 'font-semibold text-blue-600' : 'text-gray-400'}>
                        {order.patientId}
                      </TableCell>
                      <TableCell className="font-medium">{order.service}</TableCell>
                      <TableCell>{order.primaryCareProvider || '-'}</TableCell>
                      <TableCell>
                        <Badge 
                          variant={order.status === 'Pending' ? 'destructive' : 'default'}
                          className={order.status === 'Pending' ? 'bg-red-500' : 'bg-green-500'}
                        >
                          {order.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{order.orderDate}</TableCell>
                      <TableCell>
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => handleEnterResult(order.id)}
                          className="w-8 h-8 p-0"
                        >
                          <Edit className="h-4 w-4 text-blue-600" />
                        </Button>
                      </TableCell>
                      <TableCell>
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => handleViewDICOM(order.id)}
                          className="w-8 h-8 p-0 bg-red-500 text-white hover:bg-red-600"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Pagination Controls */}
      {filteredOrders.length > 0 && (
        <div className="flex items-center justify-between px-2">
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <span>Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, filteredOrders.length)} of {filteredOrders.length} entries</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="border rounded px-2 py-1 text-sm"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <span className="px-3 py-1 bg-gray-100 rounded text-sm">
              Page {currentPage} of {totalPages || 1}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage >= totalPages}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* No Results Message */}
      {filteredOrders.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-muted-foreground mb-2">No orders found</div>
            <div className="text-sm">Try adjusting your search criteria or filters</div>
          </CardContent>
        </Card>
      )}

      {/* Radiology Result Dialog */}
      {selectedOrder && (
        <RadiologyResultDialog
          isOpen={resultDialogOpen}
          onClose={() => {
            setResultDialogOpen(false);
            setSelectedOrder(null);
          }}
          orderData={{
            id: selectedOrder.id,
            patientName: selectedOrder.patientName,
            patientId: selectedOrder.patientId,
            service: selectedOrder.service,
            visitId: selectedOrder.visitId
          }}
        />
      )}

      {/* View Image → the patient's uploaded scans, AI draft, approve & file */}
      <RadiologyImageReportDialog
        target={imageReportTarget}
        onClose={() => {
          setImageReportTarget(null);
          void refetch();
        }}
      />
    </div>
  );
};

export default EnhancedRadiologyOrders;
