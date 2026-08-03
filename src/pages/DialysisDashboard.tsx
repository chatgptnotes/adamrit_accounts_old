import { useMemo } from 'react';
import * as XLSX from 'xlsx';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTileAccess } from '@/hooks/useTileAccess';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Printer, Search, ClipboardList, Download } from 'lucide-react';
import { OpdStatisticsCards } from '@/components/opd/OpdStatisticsCards';
import { OpdPatientTable } from '@/components/opd/OpdPatientTable';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { DateRange } from 'react-day-picker';
import { format } from 'date-fns';

const DialysisDashboard = () => {
  const { hospitalConfig, user } = useAuth();
  const { canSeeTile } = useTileAccess();
  const [searchParams, setSearchParams] = useSearchParams();

  const isMarketingManager = user?.role === 'marketing_manager' || user?.role === 'superadmin';

  // URL-persisted state
  const searchTerm = searchParams.get('search') || '';
  const startDate = searchParams.get('startDate') || '';
  const endDate = searchParams.get('endDate') || '';

  const updateParams = (updates: Record<string, string | null>) => {
    const newParams = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === '') {
        newParams.delete(key);
      } else {
        newParams.set(key, value);
      }
    });
    setSearchParams(newParams, { replace: true });
  };

  const setSearchTerm = (value: string) => updateParams({ search: value });

  const dateRange: DateRange | undefined = useMemo(() => {
    if (!startDate && !endDate) return undefined;
    return {
      from: startDate ? new Date(startDate) : undefined,
      to: endDate ? new Date(endDate) : undefined,
    };
  }, [startDate, endDate]);

  const handleDateRangeChange = (range: DateRange | undefined) => {
    updateParams({
      startDate: range?.from ? format(range.from, 'yyyy-MM-dd') : null,
      endDate: range?.to ? format(range.to, 'yyyy-MM-dd') : null,
    });
  };

  // Fetch Dialysis patients
  const { data: dialysisPatients = [], isLoading, refetch } = useQuery({
    queryKey: ['dialysis-patients', hospitalConfig?.name, startDate, endDate],
    queryFn: async () => {
      let query = supabase
        .from('visits')
        .select(`
          *,
          patients!inner (
            id,
            name,
            gender,
            age,
            date_of_birth,
            patients_id,
            insurance_person_no,
            corporate,
            phone,
            address,
            city_town
          ),
          referees (
            id,
            name
          ),
          relationship_managers (
            id,
            name,
            code
          )
        `)
        .eq('patient_type', 'Dialysis')
        .order('created_at', { ascending: false });

      if (startDate) {
        query = query.gte('visit_date', startDate);
      }
      if (endDate) {
        query = query.lte('visit_date', endDate);
      }

      // If no date range, default to today
      if (!startDate && !endDate) {
        const today = new Date().toISOString().split('T')[0];
        query = query.eq('visit_date', today);
      }

      if (hospitalConfig?.name) {
        query = query.eq('patients.hospital_name', hospitalConfig.name);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching dialysis patients:', error);
        throw error;
      }

      return data || [];
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });

  // Filter patients based on search term (date filtering is done at DB level)
  const filteredPatients = dialysisPatients.filter(patient => {
    const searchLower = searchTerm.toLowerCase();
    return !searchTerm || (
      patient.patients?.name?.toLowerCase().includes(searchLower) ||
      patient.patients?.patients_id?.toLowerCase().includes(searchLower) ||
      patient.visit_id?.toLowerCase().includes(searchLower) ||
      patient.token_number?.toString().includes(searchLower)
    );
  });

  const statistics = {
    waiting: filteredPatients.filter(p => p.status === 'waiting').length,
    inProgress: filteredPatients.filter(p => p.status === 'in_progress').length,
    completed: filteredPatients.filter(p => p.status === 'completed').length,
    total: filteredPatients.length
  };

  const handlePrintList = () => {
    window.print();
  };

  const handleExportToExcel = () => {
    const excelData = filteredPatients.map(patient => ({
      'Name': patient.patients?.name || '',
      'Phone number': patient.patients?.phone || ''
    }));

    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Dialysis Patients');
    XLSX.writeFile(wb, `Dialysis_Patients_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header - hidden in print */}
      <Card className="border-0 shadow-none print:hidden">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ClipboardList className="h-8 w-8" />
              <div>
                <CardTitle className="text-2xl font-bold">DIALYSIS PATIENT DASHBOARD</CardTitle>
                <p className="text-sm text-muted-foreground">Total Dialysis Patients: {statistics.total}</p>
                {/* Date display for print */}
                <p className="hidden print:block text-sm text-gray-700 mt-1">
                  Date: {startDate ? new Date(startDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'All'}
                  {endDate ? ` - ${new Date(endDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}` : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 print:hidden">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  placeholder="Search patients..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-7 w-[200px] h-8 text-xs"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrintList}
                className="flex items-center gap-1 text-xs h-8"
              >
                <Printer className="h-3 w-3" />
                Print List
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportToExcel}
                className="flex items-center gap-1 text-xs h-8"
              >
                <Download className="h-3 w-3" />
                Export XLS
              </Button>
              <DateRangePicker
                date={dateRange}
                onDateChange={handleDateRangeChange}
              />
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Statistics Cards */}
      <div className="print:hidden">
        <OpdStatisticsCards statistics={statistics} canSeeTile={canSeeTile} />
      </div>

      {/* Patients Table */}
      <Card>
        <CardHeader>
          <CardTitle>DIALYSIS PATIENTS</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center items-center h-32">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : (
            <OpdPatientTable patients={filteredPatients} refetch={refetch} isMarketingManager={isMarketingManager} />
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default DialysisDashboard;
