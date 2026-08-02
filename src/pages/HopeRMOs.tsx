import { AddItemDialog } from '@/components/AddItemDialog';
import { useHopeRMOs } from './HopeRMOs/useHopeRMOs';
import { HopeRMOsHeader } from './HopeRMOs/HopeRMOsHeader';
import { HopeRMOsControls } from './HopeRMOs/HopeRMOsControls';
import { HopeRMOsList } from './HopeRMOs/HopeRMOsList';
import { hopeRMOFields } from './HopeRMOs/formFields';
import { LedgerSearchField } from '@/components/LedgerSearchField';

const HopeRMOs = () => {
  const {
    searchTerm, setSearchTerm, isAddDialogOpen, setIsAddDialogOpen,
    isEditDialogOpen, setIsEditDialogOpen, editingRMO, setEditingRMO,
    isLoading, filteredRMOs, handleAdd, handleEdit, handleDelete, handleUpdate,
    handleExport, handleImport
  } = useHopeRMOs();

  // The accounting ledger is picked by searching the chart of accounts —
  // never typed. The duty roster only offers RMOs that carry this mapping.
  const fields = [
    ...hopeRMOFields,
    {
      key: 'ledger_account_id',
      label: 'Accounting Ledger (search — shows beneficiary bank)',
      type: 'custom' as const,
      render: (value: string, onChange: (v: string) => void) => (
        <LedgerSearchField value={value} onChange={onChange} />
      ),
    },
  ];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">Loading Hope RMOs...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto">
        <HopeRMOsHeader />

        <HopeRMOsControls
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          onAddClick={() => setIsAddDialogOpen(true)}
          onExport={handleExport}
          onImport={handleImport}
        />

        <HopeRMOsList
          rmos={filteredRMOs}
          searchTerm={searchTerm}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />

        <AddItemDialog
          isOpen={isAddDialogOpen}
          onClose={() => setIsAddDialogOpen(false)}
          onAdd={handleAdd}
          title="Add Hope RMO"
          fields={fields}
        />

        {editingRMO && (
          <AddItemDialog
            isOpen={isEditDialogOpen}
            onClose={() => {
              setIsEditDialogOpen(false);
              setEditingRMO(null);
            }}
            onAdd={handleUpdate}
            title="Edit Hope RMO"
            defaultValues={{
              name: editingRMO.name || '',
              specialty: editingRMO.specialty || '',
              department: editingRMO.department || '',
              contact_info: editingRMO.contact_info || '',
              tpa_rate: editingRMO.tpa_rate?.toString() || '',
              non_nabh_rate: editingRMO.non_nabh_rate?.toString() || '',
              nabh_rate: editingRMO.nabh_rate?.toString() || '',
              private_rate: editingRMO.private_rate?.toString() || '',
              daily_remuneration: editingRMO.daily_remuneration?.toString() || '',
              morning_rate: editingRMO.morning_rate?.toString() || '',
              evening_rate: editingRMO.evening_rate?.toString() || '',
              night_rate: editingRMO.night_rate?.toString() || '',
              ledger_account_id: editingRMO.ledger_account_id || ''
            }}
            fields={fields}
          />
        )}
      </div>
    </div>
  );
};

export default HopeRMOs;
