import { AddItemDialog } from '@/components/AddItemDialog';
import { useAyushmanConsultants } from './AyushmanConsultants/useAyushmanConsultants';
import { AyushmanConsultantsHeader } from './AyushmanConsultants/AyushmanConsultantsHeader';
import { AyushmanConsultantsControls } from './AyushmanConsultants/AyushmanConsultantsControls';
import { AyushmanConsultantsList } from './AyushmanConsultants/AyushmanConsultantsList';
import { ayushmanConsultantFields } from './AyushmanConsultants/formFields';
import { doctorLedgerFormField } from '@/components/DoctorLedgerField';

const AyushmanConsultants = () => {
  const {
    searchTerm,
    setSearchTerm,
    isAddDialogOpen,
    setIsAddDialogOpen,
    isEditDialogOpen,
    setIsEditDialogOpen,
    editingConsultant,
    setEditingConsultant,
    isLoading,
    paginatedConsultants,
    currentPage,
    setCurrentPage,
    totalPages,
    totalCount,
    itemsPerPage,
    handleAdd,
    handleEdit,
    handleUpdate,
    handleDelete,
    handleExport,
    handleImport
  } = useAyushmanConsultants();

  // The ledger is mapped against the consultant's NAME, so it can only be
  // picked once that name exists — on Add the field says so instead.
  const addFields = [...ayushmanConsultantFields, doctorLedgerFormField('')];
  const editFields = [...ayushmanConsultantFields, doctorLedgerFormField(editingConsultant?.name || '')];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">Loading Ayushman consultants...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto">
        <AyushmanConsultantsHeader />

        <AyushmanConsultantsControls
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          onAddClick={() => setIsAddDialogOpen(true)}
          onExport={handleExport}
          onImport={handleImport}
        />

        <AyushmanConsultantsList
          consultants={paginatedConsultants}
          searchTerm={searchTerm}
          onEdit={handleEdit}
          onDelete={handleDelete}
          currentPage={currentPage}
          setCurrentPage={setCurrentPage}
          totalPages={totalPages}
          totalCount={totalCount}
          itemsPerPage={itemsPerPage}
        />

        <AddItemDialog
          isOpen={isAddDialogOpen}
          onClose={() => setIsAddDialogOpen(false)}
          onAdd={handleAdd}
          title="Add Ayushman Consultant"
          fields={addFields}
        />

        {/* The hook has always carried an edit dialog's state and handleUpdate,
            but the page never rendered one, so the pencil on a row did
            nothing. The ledger has to be mapped on an existing consultant, so
            it needs somewhere to live. */}
        {editingConsultant && (
          <AddItemDialog
            isOpen={isEditDialogOpen}
            onClose={() => {
              setIsEditDialogOpen(false);
              setEditingConsultant(null);
            }}
            onAdd={handleUpdate}
            title="Edit Ayushman Consultant"
            defaultValues={{
              name: editingConsultant.name || '',
              specialty: editingConsultant.specialty || '',
              department: editingConsultant.department || '',
              contact_info: editingConsultant.contact_info || '',
              tpa_rate: editingConsultant.tpa_rate?.toString() || '',
              non_nabh_rate: editingConsultant.non_nabh_rate?.toString() || '',
              nabh_rate: editingConsultant.nabh_rate?.toString() || '',
              private_rate: editingConsultant.private_rate?.toString() || ''
            }}
            fields={editFields}
          />
        )}
      </div>
    </div>
  );
};

export default AyushmanConsultants;