import React, { useState } from 'react';
import { useNavigate, useSearchParams, Navigate } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText, AlertCircle, Plus, Edit, Eye, Trash2, X, ChevronLeft, ChevronRight, Download, Upload, EyeOff } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const MASTER_ADMIN_EMAILS = [
  'admin@hopehospital.com',
  'admin@ayushmanhospital.com',
  'admin@test.com',
];

interface CghsSurgery {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  created_at: string | null;
  updated_at: string | null;
  cost: string | null;
  Procedure_Name: string | null;
  Non_NABH_NABL_Rate: string | null;
  NABH_NABL_Rate: string | null;
  Revised_Date: string | null;
  category: string | null;
  private: string | null;
  bhopal_nabh_rate: string | null;
  bhopal_non_nabh_rate: string | null;
  is_active: boolean;
}

const CghsSurgeryMaster = () => {
  const navigate = useNavigate();
  const { hospitalConfig, user } = useAuth();
  const { canEditMasters } = usePermissions();

  // Route-level protection: only specific admins and superadmins
  const userEmail = user?.email?.toLowerCase() || '';
  const userRole = user?.role;
  if (userRole !== 'superadmin' && !MASTER_ADMIN_EMAILS.includes(userEmail)) {
    return <Navigate to="/" replace />;
  }
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // URL-persisted state
  const searchTerm = searchParams.get('search') || '';
  const currentPage = parseInt(searchParams.get('page') || '1');
  const itemsPerPage = parseInt(searchParams.get('perPage') || '10');

  // Helper to update URL params
  const updateParams = (updates: Record<string, string | null>) => {
    const newParams = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === '' || (key === 'page' && value === '1') || (key === 'perPage' && value === '10')) {
        newParams.delete(key);
      } else {
        newParams.set(key, value);
      }
    });
    setSearchParams(newParams, { replace: true });
  };

  // Setter functions
  const setSearchTerm = (value: string) => updateParams({ search: value, page: '1' });
  const setCurrentPage = (value: number) => updateParams({ page: value.toString() });
  const setItemsPerPage = (value: number) => updateParams({ perPage: value.toString(), page: '1' });

  // Non-persisted state
  const [totalCount, setTotalCount] = useState(0);
  const [viewingSurgery, setViewingSurgery] = useState<CghsSurgery | null>(null);
  const [editingSurgery, setEditingSurgery] = useState<CghsSurgery | null>(null);
  const [deletingSurgery, setDeletingSurgery] = useState<CghsSurgery | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  // Create form state
  const [createFormData, setCreateFormData] = useState({
    name: '',
    code: '',
    description: '',
    cost: '',
    Procedure_Name: '',
    Non_NABH_NABL_Rate: '',
    NABH_NABL_Rate: '',
    category: '',
    private: '',
    bhopal_nabh_rate: '',
    bhopal_non_nabh_rate: ''
  });

  // Edit form state
  const [editFormData, setEditFormData] = useState<Partial<CghsSurgery>>({});

  // Category options
  const categoryOptions = [
    'HERNIA SURGERIES',
    'UROLOGICAL -Circumcision related',
    'UROLOGICAL - stones related',
    'UROLOGICAL - urethra related',
    'UROLOGICAL - Scrotum related',
    'VASCULAR PROCEDURES',
    'PLASTIC/RECONSTRUCTIVE SURGERY',
    'ORTHOPEDIC PROCEDURES',
    'GENERAL SURGERY',
    'WOUND CARE & DEBRIDEMENT',
    'COLORECTAL PROCEDURES'
  ];

  // Fetch CGHS surgeries from database with pagination
  const { data: cghsSurgeries, isLoading, error } = useQuery({
    queryKey: ['cghs-surgeries', searchTerm, currentPage, itemsPerPage, showInactive],
    queryFn: async () => {
      const from = (currentPage - 1) * itemsPerPage;
      const to = from + itemsPerPage - 1;

      let query = supabase
        .from('cghs_surgery')
        .select('*', { count: 'exact' });

      // Filter by active status (only show active by default)
      if (!showInactive) {
        query = query.eq('is_active', true);
      }

      // Apply search filter BEFORE pagination
      if (searchTerm && searchTerm.trim()) {
        const search = searchTerm.trim();
        query = query.or(`name.ilike.*${search}*,code.ilike.*${search}*,description.ilike.*${search}*,category.ilike.*${search}*`);
      }

      // Apply ordering and pagination AFTER filters
      query = query.order('name', { ascending: true }).range(from, to);

      const { data, error, count } = await query;

      if (error) {
        throw error;
      }

      // Update total count for pagination
      setTotalCount(count || 0);

      return data as CghsSurgery[];
    }
  });

  // Create surgery mutation
  const createSurgeryMutation = useMutation({
    mutationFn: async (formData: typeof createFormData) => {
      const { data, error } = await supabase
        .from('cghs_surgery')
        .insert({
          name: formData.name,
          code: formData.code || null,
          description: formData.description || null,
          cost: formData.cost || null,
          Procedure_Name: formData.Procedure_Name || null,
          Non_NABH_NABL_Rate: formData.Non_NABH_NABL_Rate || null,
          NABH_NABL_Rate: formData.NABH_NABL_Rate || null,
          category: formData.category || null,
          private: formData.private || null,
          bhopal_nabh_rate: formData.bhopal_nabh_rate || null,
          bhopal_non_nabh_rate: formData.bhopal_non_nabh_rate || null,
          created_at: new Date().toISOString().split('T')[0]
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      return data;
    },
    onSuccess: () => {
      toast.success('CGHS surgery created successfully');
      queryClient.invalidateQueries({ queryKey: ['cghs-surgeries'] });
      setIsCreating(false);
      setCreateFormData({
        name: '',
        code: '',
        description: '',
        cost: '',
        Procedure_Name: '',
        Non_NABH_NABL_Rate: '',
        NABH_NABL_Rate: '',
        category: '',
        private: '',
        bhopal_nabh_rate: '',
        bhopal_non_nabh_rate: ''
      });
    },
    onError: (error) => {
      console.error('Error creating CGHS surgery:', error);
      toast.error('Failed to create CGHS surgery');
    }
  });

  // Handler functions for actions
  const handleView = (surgery: CghsSurgery) => {
    setViewingSurgery(surgery);
  };

  const handleEdit = (surgery: CghsSurgery) => {
    setEditingSurgery(surgery);
    setEditFormData(surgery);
  };

  const handleDelete = (surgery: CghsSurgery) => {
    setDeletingSurgery(surgery);
  };

  const handleConfirmDelete = async () => {
    if (!deletingSurgery) return;

    setIsDeleting(true);
    try {
      const { error } = await supabase
        .from('cghs_surgery')
        .delete()
        .eq('id', deletingSurgery.id);

      if (error) throw error;

      toast.success('CGHS surgery deleted successfully');
      queryClient.invalidateQueries({ queryKey: ['cghs-surgeries'] });
      setDeletingSurgery(null);
    } catch (error) {
      console.error('Error deleting CGHS surgery:', error);
      toast.error('Failed to delete CGHS surgery');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleToggleActive = async (surgery: CghsSurgery) => {
    try {
      const newStatus = !surgery.is_active;
      const { error } = await supabase
        .from('cghs_surgery')
        .update({ is_active: newStatus } as any)
        .eq('id', surgery.id);

      if (error) throw error;

      toast.success(`Surgery "${surgery.name}" ${newStatus ? 'activated' : 'deactivated'} successfully`);
      queryClient.invalidateQueries({ queryKey: ['cghs-surgeries'] });
    } catch (error) {
      console.error('Error toggling surgery status:', error);
      toast.error('Failed to update surgery status');
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSurgery || !editFormData) return;

    try {
      const { error } = await supabase
        .from('cghs_surgery')
        .update({
          name: editFormData.name,
          code: editFormData.code,
          description: editFormData.description,
          cost: editFormData.cost,
          Procedure_Name: editFormData.Procedure_Name,
          Non_NABH_NABL_Rate: editFormData.Non_NABH_NABL_Rate,
          NABH_NABL_Rate: editFormData.NABH_NABL_Rate,
          category: editFormData.category,
          private: editFormData.private,
          bhopal_nabh_rate: editFormData.bhopal_nabh_rate,
          bhopal_non_nabh_rate: editFormData.bhopal_non_nabh_rate,
          updated_at: new Date().toISOString().split('T')[0]
        })
        .eq('id', editingSurgery.id);

      if (error) throw error;

      toast.success('CGHS surgery updated successfully');
      queryClient.invalidateQueries({ queryKey: ['cghs-surgeries'] });
      setEditingSurgery(null);
    } catch (error) {
      console.error('Error updating CGHS surgery:', error);
      toast.error('Failed to update CGHS surgery');
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    createSurgeryMutation.mutate(createFormData);
  };

  // Pagination calculations
  const totalPages = Math.ceil(totalCount / itemsPerPage);
  const startItem = (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalCount);

  // Pagination handlers
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleItemsPerPageChange = (value: string) => {
    // setItemsPerPage already resets page to 1 in the SAME URL update. A
    // second setCurrentPage(1) here rebuilt the params from the stale
    // searchParams of this render and overwrote the perPage change — which
    // is why switching 10 → 100 appeared to do nothing.
    setItemsPerPage(Number(value));
  };

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    // Note: setSearchTerm already resets page to 1 via updateParams
  };

  // Export function - downloads all data as Excel
  const handleExport = async () => {
    try {
      const { data, error } = await supabase
        .from('cghs_surgery')
        .select('*')
        .order('name', { ascending: true });

      if (error) {
        toast.error('Failed to export data');
        return;
      }

      // Column keys matching the table display
      const headers = ['name', 'code', 'category', 'NABH_NABL_Rate', 'Non_NABH_NABL_Rate', 'private', 'bhopal_nabh_rate', 'bhopal_non_nabh_rate'];
      // Human-readable labels for Excel header row
      const headerLabels = ['Name', 'Code', 'Category', 'NABH Rate', 'Non-NABH Rate', 'Private Rate', 'Bhopal NABH Rate', 'Bhopal Non-NABH Rate'];

      // Prepare data for Excel - filter out empty rows and add Sr No
      const excelData = data
        .filter(row => row.name && row.name.trim()) // Only include rows with valid name
        .map((row, index) => {
          const obj: any = { 'Sr No': index + 1 }; // Add serial number
          headers.forEach((h, i) => {
            obj[headerLabels[i]] = (row as any)[h] || '';
          });
          return obj;
        });

      // Create workbook and worksheet
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(excelData);
      XLSX.utils.book_append_sheet(wb, ws, 'CGHS Surgery');

      // Download Excel file
      XLSX.writeFile(wb, `cghs_surgery_export_${new Date().toISOString().split('T')[0]}.xlsx`);

      toast.success(`Exported ${data.length} records`);
    } catch (err) {
      toast.error('Export failed');
    }
  };

  // Import function - uploads CSV or Excel file and adds records
  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        let records: any[] = [];
        const fileName = file.name.toLowerCase();

        if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
          // Parse Excel file
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet);

          // Map Excel headers to database columns
          records = jsonData.map((row: any) => ({
            name: row['Name'] || null,
            code: row['Code'] || null,
            category: row['Category'] || null,
            NABH_NABL_Rate: row['NABH Rate'] || null,
            Non_NABH_NABL_Rate: row['Non-NABH Rate'] || null,
            private: row['Private Rate'] || null,
            bhopal_nabh_rate: row['Bhopal NABH Rate'] || null,
            bhopal_non_nabh_rate: row['Bhopal Non-NABH Rate'] || null,
          }));
        } else {
          // Parse CSV file
          const text = e.target?.result as string;
          const lines = text.split('\n');
          const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));

          records = lines.slice(1).filter(line => line.trim()).map(line => {
            const values = line.match(/(".*?"|[^,]+)/g) || [];
            const record: any = {};
            headers.forEach((header, i) => {
              const value = values[i]?.replace(/^"|"$/g, '').replace(/""/g, '"') || null;
              record[header] = value === '' ? null : value;
            });
            return record;
          });
        }

        // Filter out empty records
        records = records.filter(r => r.name && r.name.trim());

        const { error } = await supabase.from('cghs_surgery').insert(records);

        if (error) {
          toast.error('Failed to import: ' + error.message);
        } else {
          toast.success(`Imported ${records.length} records`);
          queryClient.invalidateQueries({ queryKey: ['cghs-surgeries'] });
        }
      } catch (err) {
        toast.error('Import failed - invalid file format');
      }
    };

    // Read as ArrayBuffer for xlsx, as text for csv
    if (file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls')) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
    event.target.value = '';
  };

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
            <FileText className="h-8 w-8 text-blue-600" />
            CGHS Surgery Master
          </h1>
          <p className="text-gray-600 mt-2">
            Manage CGHS surgery codes, rates and procedures
          </p>
        </div>
        <button
          onClick={() => setIsCreating(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Create Surgery
        </button>
      </div>

      {/* Search Bar */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <div className="flex-1">
              <Label htmlFor="search">Search Surgeries</Label>
              <Input
                id="search"
                placeholder="Search by name, code, description, or category..."
                value={searchTerm}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* CGHS Surgeries Table */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>CGHS Surgeries</span>
            <div className="flex items-center gap-4">
              <span className="text-sm font-normal text-gray-500">
                {isLoading ? 'Loading...' : totalCount > 0 ? `Showing ${startItem}-${endItem} of ${totalCount} surgeries` : 'No surgeries found'}
              </span>
              <div className="flex items-center gap-2">
                <Label htmlFor="itemsPerPage" className="text-sm font-normal text-gray-500">Show:</Label>
                <Select value={itemsPerPage.toString()} onValueChange={handleItemsPerPageChange}>
                  <SelectTrigger id="itemsPerPage" className="w-20 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5</SelectItem>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="20">20</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 cursor-pointer text-sm font-normal">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => { setShowInactive(e.target.checked); setCurrentPage(1); }}
                  className="rounded border-gray-300"
                />
                Show Inactive
              </label>
              {canEditMasters && (
                <Button variant="outline" size="sm" onClick={handleExport}>
                  <Download className="h-4 w-4 mr-2" />
                  Export
                </Button>
              )}
              {canEditMasters && (
                <label className="cursor-pointer">
                  <Button variant="outline" size="sm" asChild>
                    <span>
                      <Upload className="h-4 w-4 mr-2" />
                      Import
                    </span>
                  </Button>
                  <input type="file" accept=".csv,.xlsx,.xls" onChange={handleImport} className="hidden" />
                </label>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <span className="ml-3 text-gray-600">Loading CGHS surgeries...</span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-8 text-red-600">
              <AlertCircle className="h-5 w-5 mr-2" />
              Error loading CGHS surgeries. Please try again.
            </div>
          ) : cghsSurgeries && cghsSurgeries.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-3 font-semibold text-gray-700">Name</th>
                    <th className="text-left p-3 font-semibold text-gray-700">Code</th>
                    <th className="text-left p-3 font-semibold text-gray-700">Category</th>
                    <th className="text-left p-3 font-semibold text-gray-700">NABH Rate</th>
                    <th className="text-left p-3 font-semibold text-gray-700">Non-NABH Rate</th>
                    <th className="text-left p-3 font-semibold text-gray-700">Private Rate</th>
                    <th className="text-left p-3 font-semibold text-gray-700">Bhopal NABH Rate</th>
                    <th className="text-left p-3 font-semibold text-gray-700">Bhopal Non-NABH Rate</th>
                    <th className="text-left p-3 font-semibold text-gray-700">Created</th>
                    <th className="text-left p-3 font-semibold text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {cghsSurgeries.map((surgery) => (
                    <tr key={surgery.id} className={`border-b hover:bg-gray-50 ${!surgery.is_active ? 'opacity-50 bg-gray-100' : ''}`}>
                      <td className="p-3 font-medium text-gray-900">
                        {surgery.name}
                        {!surgery.is_active && <span className="ml-2 text-xs text-red-500 font-normal">(Inactive)</span>}
                      </td>
                      <td className="p-3 text-gray-600">{surgery.code || '-'}</td>
                      <td className="p-3 text-gray-600">{surgery.category || '-'}</td>
                      <td className="p-3 text-gray-600">{surgery.NABH_NABL_Rate || '-'}</td>
                      <td className="p-3 text-gray-600">{surgery.Non_NABH_NABL_Rate || '-'}</td>
                      <td className="p-3 text-gray-600">{surgery.private || '-'}</td>
                      <td className="p-3 text-gray-600">{surgery.bhopal_nabh_rate || '-'}</td>
                      <td className="p-3 text-gray-600">{surgery.bhopal_non_nabh_rate || '-'}</td>
                      <td className="p-3 text-gray-600 text-sm">
                        {surgery.created_at ? new Date(surgery.created_at).toLocaleDateString() : '-'}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleView(surgery)}
                            className="p-1 text-blue-600 hover:text-blue-800"
                            title="View surgery details"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          {canEditMasters && (
                            <button
                              onClick={() => handleEdit(surgery)}
                              className="p-1 text-green-600 hover:text-green-800"
                              title="Edit surgery"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                          )}
                          {canEditMasters && (
                            <button
                              onClick={() => handleToggleActive(surgery)}
                              className={`p-1 ${surgery.is_active ? 'text-orange-600 hover:text-orange-800' : 'text-green-600 hover:text-green-800'}`}
                              title={surgery.is_active ? 'Make inactive' : 'Make active'}
                            >
                              <EyeOff className="h-4 w-4" />
                            </button>
                          )}
                          {canEditMasters && (
                            <button
                              onClick={() => handleDelete(surgery)}
                              className="p-1 text-red-600 hover:text-red-800"
                              title="Delete surgery"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-gray-500">
              <FileText className="h-12 w-12 mb-4 text-gray-300" />
              <p className="text-lg font-medium mb-2">No CGHS surgeries found</p>
              <p className="text-sm text-center">
                {searchTerm ? 'No surgeries match your search criteria' : 'Create your first CGHS surgery'}
              </p>
              <button
                onClick={() => setIsCreating(true)}
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Create Surgery
              </button>
            </div>
          )}

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t">
              <div className="text-sm text-gray-500">
                Showing {startItem}-{endItem} of {totalCount} results
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="flex items-center gap-1"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>

                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNumber;
                    if (totalPages <= 5) {
                      pageNumber = i + 1;
                    } else if (currentPage <= 3) {
                      pageNumber = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNumber = totalPages - 4 + i;
                    } else {
                      pageNumber = currentPage - 2 + i;
                    }

                    return (
                      <Button
                        key={pageNumber}
                        variant={pageNumber === currentPage ? "default" : "outline"}
                        size="sm"
                        onClick={() => handlePageChange(pageNumber)}
                        className="w-8 h-8 p-0"
                      >
                        {pageNumber}
                      </Button>
                    );
                  })}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="flex items-center gap-1"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Modal */}
      {isCreating && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-900">Create CGHS Surgery</h2>
              <button
                onClick={() => setIsCreating(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="h-6 w-6" />
              </button>
            </div>
            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="block text-sm font-medium text-gray-700 mb-2">
                    Surgery Name *
                  </Label>
                  <Input
                    type="text"
                    value={createFormData.name}
                    onChange={(e) => setCreateFormData(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full"
                    required
                  />
                </div>
                <div>
                  <Label className="block text-sm font-medium text-gray-700 mb-2">
                    Code
                  </Label>
                  <Input
                    type="text"
                    value={createFormData.code}
                    onChange={(e) => setCreateFormData(prev => ({ ...prev, code: e.target.value }))}
                    className="w-full"
                  />
                </div>
                <div>
                  <Label className="block text-sm font-medium text-gray-700 mb-2">
                    Procedure Name
                  </Label>
                  <Input
                    type="text"
                    value={createFormData.Procedure_Name}
                    onChange={(e) => setCreateFormData(prev => ({ ...prev, Procedure_Name: e.target.value }))}
                    className="w-full"
                  />
                </div>
                <div>
                  <Label className="block text-sm font-medium text-gray-700 mb-2">
                    Category
                  </Label>
                  <Select
                    value={createFormData.category}
                    onValueChange={(value) => setCreateFormData(prev => ({ ...prev, category: value }))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {categoryOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="block text-sm font-medium text-gray-700 mb-2">
                    NABH/NABL Rate
                  </Label>
                  <Input
                    type="text"
                    value={createFormData.NABH_NABL_Rate}
                    onChange={(e) => setCreateFormData(prev => ({ ...prev, NABH_NABL_Rate: e.target.value }))}
                    className="w-full"
                  />
                </div>
                <div>
                  <Label className="block text-sm font-medium text-gray-700 mb-2">
                    Non-NABH/NABL Rate
                  </Label>
                  <Input
                    type="text"
                    value={createFormData.Non_NABH_NABL_Rate}
                    onChange={(e) => setCreateFormData(prev => ({ ...prev, Non_NABH_NABL_Rate: e.target.value }))}
                    className="w-full"
                  />
                </div>
                <div>
                  <Label className="block text-sm font-medium text-gray-700 mb-2">
                    Private Rate
                  </Label>
                  <Input
                    type="text"
                    value={createFormData.private}
                    onChange={(e) => setCreateFormData(prev => ({ ...prev, private: e.target.value }))}
                    className="w-full"
                  />
                </div>
                <div>
                  <Label className="block text-sm font-medium text-gray-700 mb-2">
                    Bhopal NABH Rate
                  </Label>
                  <Input
                    type="text"
                    value={createFormData.bhopal_nabh_rate}
                    onChange={(e) => setCreateFormData(prev => ({ ...prev, bhopal_nabh_rate: e.target.value }))}
                    className="w-full"
                  />
                </div>
                <div>
                  <Label className="block text-sm font-medium text-gray-700 mb-2">
                    Bhopal Non-NABH Rate
                  </Label>
                  <Input
                    type="text"
                    value={createFormData.bhopal_non_nabh_rate}
                    onChange={(e) => setCreateFormData(prev => ({ ...prev, bhopal_non_nabh_rate: e.target.value }))}
                    className="w-full"
                  />
                </div>
                <div className="hidden">
                  <Label className="block text-sm font-medium text-gray-700 mb-2">
                    Cost
                  </Label>
                  <Input
                    type="text"
                    value={createFormData.cost}
                    onChange={(e) => setCreateFormData(prev => ({ ...prev, cost: e.target.value }))}
                    className="w-full"
                  />
                </div>
              </div>
              <div>
                <Label className="block text-sm font-medium text-gray-700 mb-2">
                  Description
                </Label>
                <Textarea
                  value={createFormData.description}
                  onChange={(e) => setCreateFormData(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full"
                  rows={3}
                />
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createSurgeryMutation.isPending}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {createSurgeryMutation.isPending ? 'Creating...' : 'Create Surgery'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Modal */}
      {viewingSurgery && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-900">CGHS Surgery Details</h2>
              <button
                onClick={() => setViewingSurgery(null)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="h-6 w-6" />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Surgery Name</label>
                <p className="mt-1 text-sm text-gray-900">{viewingSurgery.name}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Code</label>
                <p className="mt-1 text-sm text-gray-900">{viewingSurgery.code || '-'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Procedure Name</label>
                <p className="mt-1 text-sm text-gray-900">{viewingSurgery.Procedure_Name || '-'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Category</label>
                <p className="mt-1 text-sm text-gray-900">{viewingSurgery.category || '-'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">NABH/NABL Rate</label>
                <p className="mt-1 text-sm text-gray-900">{viewingSurgery.NABH_NABL_Rate || '-'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Non-NABH/NABL Rate</label>
                <p className="mt-1 text-sm text-gray-900">{viewingSurgery.Non_NABH_NABL_Rate || '-'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Private Rate</label>
                <p className="mt-1 text-sm text-gray-900">{viewingSurgery.private || '-'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Bhopal NABH Rate</label>
                <p className="mt-1 text-sm text-gray-900">{viewingSurgery.bhopal_nabh_rate || '-'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Bhopal Non-NABH Rate</label>
                <p className="mt-1 text-sm text-gray-900">{viewingSurgery.bhopal_non_nabh_rate || '-'}</p>
              </div>
              <div className="hidden">
                <label className="block text-sm font-medium text-gray-700">Cost</label>
                <p className="mt-1 text-sm text-gray-900">{viewingSurgery.cost || '-'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Created</label>
                <p className="mt-1 text-sm text-gray-900">
                  {viewingSurgery.created_at ? new Date(viewingSurgery.created_at).toLocaleDateString() : '-'}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Last Updated</label>
                <p className="mt-1 text-sm text-gray-900">
                  {viewingSurgery.updated_at ? new Date(viewingSurgery.updated_at).toLocaleDateString() : '-'}
                </p>
              </div>
            </div>
            {viewingSurgery.description && (
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700">Description</label>
                <p className="mt-1 text-sm text-gray-900">{viewingSurgery.description}</p>
              </div>
            )}
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setViewingSurgery(null)}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingSurgery && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-900">Edit CGHS Surgery</h2>
              <button
                onClick={() => setEditingSurgery(null)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="h-6 w-6" />
              </button>
            </div>
            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="block text-sm font-medium text-gray-700 mb-2">
                    Surgery Name *
                  </Label>
                  <Input
                    type="text"
                    value={editFormData.name || ''}
                    onChange={(e) => setEditFormData(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full"
                    required
                  />
                </div>
                <div>
                  <Label className="block text-sm font-medium text-gray-700 mb-2">
                    Code
                  </Label>
                  <Input
                    type="text"
                    value={editFormData.code || ''}
                    onChange={(e) => setEditFormData(prev => ({ ...prev, code: e.target.value }))}
                    className="w-full"
                  />
                </div>
                <div>
                  <Label className="block text-sm font-medium text-gray-700 mb-2">
                    Procedure Name
                  </Label>
                  <Input
                    type="text"
                    value={editFormData.Procedure_Name || ''}
                    onChange={(e) => setEditFormData(prev => ({ ...prev, Procedure_Name: e.target.value }))}
                    className="w-full"
                  />
                </div>
                <div>
                  <Label className="block text-sm font-medium text-gray-700 mb-2">
                    Category
                  </Label>
                  <Select
                    value={editFormData.category || ''}
                    onValueChange={(value) => setEditFormData(prev => ({ ...prev, category: value }))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {categoryOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="block text-sm font-medium text-gray-700 mb-2">
                    NABH/NABL Rate
                  </Label>
                  <Input
                    type="text"
                    value={editFormData.NABH_NABL_Rate || ''}
                    onChange={(e) => setEditFormData(prev => ({ ...prev, NABH_NABL_Rate: e.target.value }))}
                    className="w-full"
                  />
                </div>
                <div>
                  <Label className="block text-sm font-medium text-gray-700 mb-2">
                    Non-NABH/NABL Rate
                  </Label>
                  <Input
                    type="text"
                    value={editFormData.Non_NABH_NABL_Rate || ''}
                    onChange={(e) => setEditFormData(prev => ({ ...prev, Non_NABH_NABL_Rate: e.target.value }))}
                    className="w-full"
                  />
                </div>
                <div>
                  <Label className="block text-sm font-medium text-gray-700 mb-2">
                    Private Rate
                  </Label>
                  <Input
                    type="text"
                    value={editFormData.private || ''}
                    onChange={(e) => setEditFormData(prev => ({ ...prev, private: e.target.value }))}
                    className="w-full"
                  />
                </div>
                <div>
                  <Label className="block text-sm font-medium text-gray-700 mb-2">
                    Bhopal NABH Rate
                  </Label>
                  <Input
                    type="text"
                    value={editFormData.bhopal_nabh_rate || ''}
                    onChange={(e) => setEditFormData(prev => ({ ...prev, bhopal_nabh_rate: e.target.value }))}
                    className="w-full"
                  />
                </div>
                <div>
                  <Label className="block text-sm font-medium text-gray-700 mb-2">
                    Bhopal Non-NABH Rate
                  </Label>
                  <Input
                    type="text"
                    value={editFormData.bhopal_non_nabh_rate || ''}
                    onChange={(e) => setEditFormData(prev => ({ ...prev, bhopal_non_nabh_rate: e.target.value }))}
                    className="w-full"
                  />
                </div>
                <div className="hidden">
                  <Label className="block text-sm font-medium text-gray-700 mb-2">
                    Cost
                  </Label>
                  <Input
                    type="text"
                    value={editFormData.cost || ''}
                    onChange={(e) => setEditFormData(prev => ({ ...prev, cost: e.target.value }))}
                    className="w-full"
                  />
                </div>
              </div>
              <div>
                <Label className="block text-sm font-medium text-gray-700 mb-2">
                  Description
                </Label>
                <Textarea
                  value={editFormData.description || ''}
                  onChange={(e) => setEditFormData(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full"
                  rows={3}
                />
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setEditingSurgery(null)}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Update Surgery
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingSurgery && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center mb-4">
              <div className="flex-shrink-0 w-10 h-10 mx-auto bg-red-100 rounded-full flex items-center justify-center">
                <Trash2 className="h-6 w-6 text-red-600" />
              </div>
              <div className="mt-0 ml-4">
                <h3 className="text-lg font-medium text-gray-900">Delete CGHS Surgery</h3>
              </div>
            </div>
            <div className="mb-4">
              <p className="text-sm text-gray-500">
                Are you sure you want to delete "<strong>{deletingSurgery.name}</strong>"?
                This action cannot be undone.
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeletingSurgery(null)}
                disabled={isDeleting}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default CghsSurgeryMaster;