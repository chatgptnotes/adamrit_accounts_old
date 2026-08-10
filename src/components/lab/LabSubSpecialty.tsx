import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import {
  Plus,
  Edit,
  Trash2,
  FlaskConical
} from 'lucide-react';

interface LabSubSpecialty {
  id: string;
  name: string;
  code: string;
  modality?: string;
  remark?: string;
}

const LabSubSpecialty: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingSpecialty, setEditingSpecialty] = useState<LabSubSpecialty | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Shares its query key with the lab-orders category autocomplete (LabOrders.tsx),
  // so invalidating here refreshes that dropdown too.
  const { data: subspecialties = [], isLoading, error } = useQuery({
    queryKey: ['lab-sub-specialities'],
    queryFn: async () => {
      const { data, error: fetchError } = await supabase
        .from('lab_sub_speciality')
        .select('id, name, sub_code, modality, remark')
        .order('name');

      if (fetchError) throw fetchError;

      // DB column is sub_code; the table and forms below use `code`.
      return (data || []).map((row: any): LabSubSpecialty => ({
        id: row.id,
        name: row.name || '',
        code: row.sub_code || '',
        modality: row.modality || '',
        remark: row.remark || ''
      }));
    }
  });

  const refreshList = () => queryClient.invalidateQueries({ queryKey: ['lab-sub-specialities'] });

  const reportFailure = (action: string, err: unknown) => {
    console.error(`Error trying to ${action} lab sub specialty:`, err);
    toast({
      title: `Could not ${action} sub specialty`,
      description: err instanceof Error ? err.message : 'Unexpected error. Please try again.',
      variant: 'destructive'
    });
  };

  const addMutation = useMutation({
    mutationFn: async (values: Omit<LabSubSpecialty, 'id'>) => {
      const { error: insertError } = await supabase
        .from('lab_sub_speciality')
        .insert({
          name: values.name,
          sub_code: values.code,
          modality: values.modality || null,
          remark: values.remark || null
        });
      if (insertError) throw insertError;
    },
    onSuccess: () => {
      refreshList();
      setIsAddDialogOpen(false);
      toast({ title: 'Sub specialty added' });
    },
    onError: (err) => reportFailure('add', err)
  });

  const updateMutation = useMutation({
    mutationFn: async (values: LabSubSpecialty) => {
      const { error: updateError } = await supabase
        .from('lab_sub_speciality')
        .update({
          name: values.name,
          sub_code: values.code,
          modality: values.modality || null,
          remark: values.remark || null
        })
        .eq('id', values.id);
      if (updateError) throw updateError;
    },
    onSuccess: () => {
      refreshList();
      setEditingSpecialty(null);
      toast({ title: 'Sub specialty updated' });
    },
    onError: (err) => reportFailure('update', err)
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error: deleteError } = await supabase
        .from('lab_sub_speciality')
        .delete()
        .eq('id', id);
      if (deleteError) throw deleteError;
    },
    onSuccess: () => {
      refreshList();
      toast({ title: 'Sub specialty deleted' });
    },
    onError: (err) => reportFailure('delete', err)
  });

  const filteredSubspecialties = subspecialties.filter(subspecialty =>
    subspecialty.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    subspecialty.code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Pagination logic
  const totalPages = Math.ceil(filteredSubspecialties.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedSubspecialties = filteredSubspecialties.slice(startIndex, endIndex);

  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  // Pagination handlers
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handlePageSizeChange = (newPageSize: string) => {
    setPageSize(Number(newPageSize));
    setCurrentPage(1);
  };

  const goToFirstPage = () => setCurrentPage(1);
  const goToLastPage = () => setCurrentPage(totalPages);
  const goToPreviousPage = () => setCurrentPage(Math.max(1, currentPage - 1));
  const goToNextPage = () => setCurrentPage(Math.min(totalPages, currentPage + 1));

  // Generate page numbers for pagination
  const getPageNumbers = () => {
    const pages = [];
    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    const endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

    if (endPage - startPage < maxVisiblePages - 1) {
      startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
      pages.push(i);
    }
    return pages;
  };

  const handleAddSubspecialty = (newSubspecialty: Omit<LabSubSpecialty, 'id'>) => {
    addMutation.mutate(newSubspecialty);
  };

  const handleEditSubspecialty = (updatedSubspecialty: LabSubSpecialty) => {
    updateMutation.mutate(updatedSubspecialty);
  };

  const handleDeleteSubspecialty = (id: string) => {
    deleteMutation.mutate(id);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FlaskConical className="h-6 w-6 text-primary" />
          <div>
            <h2 className="text-2xl font-bold">Laboratory Sub Specialty</h2>
            <p className="text-muted-foreground">Manage laboratory subspecialties and test categories</p>
          </div>
        </div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add Sub Specialty
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Add New Sub Specialty</DialogTitle>
            </DialogHeader>
            <AddSubSpecialtyForm onSubmit={handleAddSubspecialty} isSaving={addMutation.isPending} />
          </DialogContent>
        </Dialog>
      </div>

      {/* Search and Filters */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <Input
              placeholder="Search subspecialties..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-md"
            />
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Show:</span>
              <Select value={pageSize.toString()} onValueChange={handlePageSizeChange}>
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5</SelectItem>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">entries</span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sub Specialty Name</TableHead>
                  <TableHead>Sub Specialty Code</TableHead>
                  <TableHead>Modality</TableHead>
                  <TableHead>Remark</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      Loading sub specialties...
                    </TableCell>
                  </TableRow>
                ) : error ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-destructive">
                      Could not load sub specialties: {error instanceof Error ? error.message : 'Unknown error'}
                    </TableCell>
                  </TableRow>
                ) : paginatedSubspecialties.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      {searchTerm
                        ? 'No sub specialties match your search.'
                        : 'No sub specialties yet. Use "Add Sub Specialty" to create one.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedSubspecialties.map((subspecialty) => (
                  <TableRow key={subspecialty.id}>
                    <TableCell className="font-medium">{subspecialty.name}</TableCell>
                    <TableCell>{subspecialty.code}</TableCell>
                    <TableCell>{subspecialty.modality || '...'}</TableCell>
                    <TableCell>{subspecialty.remark || '...'}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingSpecialty(subspecialty)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={deleteMutation.isPending}
                          onClick={() => handleDeleteSubspecialty(subspecialty.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-2 py-4">
              <div className="text-sm text-muted-foreground">
                Showing {startIndex + 1} to {Math.min(endIndex, filteredSubspecialties.length)} of {filteredSubspecialties.length} entries
              </div>
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={goToPreviousPage}
                      className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>

                  {getPageNumbers().map((pageNumber) => (
                    <PaginationItem key={pageNumber}>
                      <PaginationLink
                        onClick={() => handlePageChange(pageNumber)}
                        isActive={currentPage === pageNumber}
                        className="cursor-pointer"
                      >
                        {pageNumber}
                      </PaginationLink>
                    </PaginationItem>
                  ))}

                  <PaginationItem>
                    <PaginationNext
                      onClick={goToNextPage}
                      className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editingSpecialty} onOpenChange={() => setEditingSpecialty(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Sub Specialty</DialogTitle>
          </DialogHeader>
          {editingSpecialty && (
            <EditSubSpecialtyForm
              subspecialty={editingSpecialty}
              onSubmit={handleEditSubspecialty}
              isSaving={updateMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

interface AddSubSpecialtyFormProps {
  onSubmit: (subspecialty: Omit<LabSubSpecialty, 'id'>) => void;
  isSaving: boolean;
}

const AddSubSpecialtyForm: React.FC<AddSubSpecialtyFormProps> = ({ onSubmit, isSaving }) => {
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    modality: '',
    remark: ''
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Deliberately not cleared here: the dialog unmounts this form on success, and
    // keeping the values on failure means a rejected save does not lose the typing.
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium">Sub Specialty Name *</label>
          <Input
            value={formData.name}
            onChange={(e) => setFormData({...formData, name: e.target.value})}
            required
          />
        </div>
        <div>
          <label className="text-sm font-medium">Sub Specialty Code *</label>
          <Input
            value={formData.code}
            onChange={(e) => setFormData({...formData, code: e.target.value})}
            required
          />
        </div>
      </div>
      <div>
        <label className="text-sm font-medium">Modality</label>
        <Input
          value={formData.modality}
          onChange={(e) => setFormData({...formData, modality: e.target.value})}
        />
      </div>
      <div>
        <label className="text-sm font-medium">Remark</label>
        <Input
          value={formData.remark}
          onChange={(e) => setFormData({...formData, remark: e.target.value})}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={isSaving}>{isSaving ? 'Saving...' : 'Save'}</Button>
      </div>
    </form>
  );
};

interface EditSubSpecialtyFormProps {
  subspecialty: LabSubSpecialty;
  onSubmit: (subspecialty: LabSubSpecialty) => void;
  isSaving: boolean;
}

const EditSubSpecialtyForm: React.FC<EditSubSpecialtyFormProps> = ({ subspecialty, onSubmit, isSaving }) => {
  const [formData, setFormData] = useState(subspecialty);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium">Sub Specialty Name *</label>
          <Input
            value={formData.name}
            onChange={(e) => setFormData({...formData, name: e.target.value})}
            required
          />
        </div>
        <div>
          <label className="text-sm font-medium">Sub Specialty Code *</label>
          <Input
            value={formData.code}
            onChange={(e) => setFormData({...formData, code: e.target.value})}
            required
          />
        </div>
      </div>
      <div>
        <label className="text-sm font-medium">Modality</label>
        <Input
          value={formData.modality}
          onChange={(e) => setFormData({...formData, modality: e.target.value})}
        />
      </div>
      <div>
        <label className="text-sm font-medium">Remark</label>
        <Input
          value={formData.remark}
          onChange={(e) => setFormData({...formData, remark: e.target.value})}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={isSaving}>{isSaving ? 'Updating...' : 'Update'}</Button>
      </div>
    </form>
  );
};

export default LabSubSpecialty;
