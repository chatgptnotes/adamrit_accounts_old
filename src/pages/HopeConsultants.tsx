
import { AddItemDialog } from '@/components/AddItemDialog';
import { useHopeConsultants } from './HopeConsultants/useHopeConsultants';
import { HopeConsultantsHeader } from './HopeConsultants/HopeConsultantsHeader';
import { HopeConsultantsControls } from './HopeConsultants/HopeConsultantsControls';
import { HopeConsultantsList } from './HopeConsultants/HopeConsultantsList';
import { hopeConsultantFields } from './HopeConsultants/formFields';
import { doctorLedgerFormField } from '@/components/DoctorLedgerField';

const HopeConsultants = () => {
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
    filteredConsultants,
    handleAdd,
    handleEdit,
    handleDelete,
    handleUpdate,
    handleExport,
    handleImport
  } = useHopeConsultants();

  // The ledger is mapped against the consultant's NAME, so it can only be
  // picked once that name exists — on Add the field says so instead.
  const addFields = [...hopeConsultantFields, doctorLedgerFormField('')];
  const editFields = [...hopeConsultantFields, doctorLedgerFormField(editingConsultant?.name || '')];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">Loading Hope consultants...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto">
        <HopeConsultantsHeader />

        <HopeConsultantsControls
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          onAddClick={() => setIsAddDialogOpen(true)}
          onExport={handleExport}
          onImport={handleImport}
        />

        <HopeConsultantsList
          consultants={filteredConsultants}
          searchTerm={searchTerm}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />

        <AddItemDialog
          isOpen={isAddDialogOpen}
          onClose={() => setIsAddDialogOpen(false)}
          onAdd={handleAdd}
          title="Add Hope Consultant"
          fields={addFields}
        />

        {editingConsultant && (
          <AddItemDialog
            isOpen={isEditDialogOpen}
            onClose={() => {
              setIsEditDialogOpen(false);
              setEditingConsultant(null);
            }}
            onAdd={handleUpdate}
            title="Edit Hope Consultant"
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

export default HopeConsultants;
