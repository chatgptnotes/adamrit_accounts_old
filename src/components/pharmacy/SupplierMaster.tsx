// Supplier Master Component
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
  TableRow
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Textarea
} from '@/components/ui/textarea';
import {
  Building2,
  Search,
  Plus,
  Edit,
  Trash2,
  Phone,
  Mail,
  MapPin,
  FileText,
  Filter,
  Download,
  Upload,
  Eye,
  MoreHorizontal,
  Pencil
} from 'lucide-react';
import { ManufacturerService, ManufacturerCompany } from '@/lib/manufacturer-service';
import {
  searchSupplierLedgers,
  fetchLedgerById,
  type SupplierLedgerOption,
} from '@/lib/pharmacy/supplierLedgers';
import { SupplierService, Supplier } from '@/lib/supplier-service';
import { useToast } from '@/hooks/use-toast';

// Accept an optional prop 'activeTab' to control which tab is shown
interface SupplierMasterProps {
  activeTab?: 'supplier' | 'manufacturer';
    }

const SupplierMaster: React.FC<SupplierMasterProps> = ({ activeTab: propActiveTab }) => {
  const activeTab = propActiveTab ?? 'supplier';
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  // Supplier state
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [filteredSuppliers, setFilteredSuppliers] = useState<Supplier[]>([]);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [supplierForm, setSupplierForm] = useState<Partial<Supplier>>({
    supplier_name: '',
    supplier_code: '',
    supplier_type: '',
    phone: '',
    credit_limit: 0,
    email: '',
    pin: '',
    dl_no: '',
    account_group: '',
    cst: '',
    s_tax_no: '',
    address: '',
    credit_day: 0,
    bank_or_branch: '',
    mobile: '',
    ledger_account_id: null,
  });

  // The accounting ledger this supplier posts to, and what the user is typing
  // to find it. Every supplier must have one: the GRN credits it and Lalit's
  // tile debits it, so an unmapped supplier lands in Other Creditors instead.
  const [ledger, setLedger] = useState<SupplierLedgerOption | null>(null);
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [ledgerOptions, setLedgerOptions] = useState<SupplierLedgerOption[]>([]);
  const [ledgerOpen, setLedgerOpen] = useState(false);

  // Manufacturer state
  const [manufacturers, setManufacturers] = useState<ManufacturerCompany[]>([]);
  const [filteredManufacturers, setFilteredManufacturers] = useState<ManufacturerCompany[]>([]);
  const [manufacturerName, setManufacturerName] = useState('');
  const [manufacturerAddress, setManufacturerAddress] = useState('');
  const [manufacturerSearch, setManufacturerSearch] = useState('');
  const [editingManufacturer, setEditingManufacturer] = useState<ManufacturerCompany | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  // Load data when activeTab changes
  useEffect(() => {
    if (activeTab === 'manufacturer') {
      loadManufacturers();
    } else if (activeTab === 'supplier') {
      loadSuppliers();
    }
  }, [activeTab]);

  // Filter suppliers based on search
  useEffect(() => {
    if (supplierSearch.trim() === '') {
      setFilteredSuppliers(suppliers);
    } else {
      const filtered = suppliers.filter(s =>
        s.supplier_name.toLowerCase().includes(supplierSearch.toLowerCase()) ||
        s.supplier_code.toLowerCase().includes(supplierSearch.toLowerCase())
      );
      setFilteredSuppliers(filtered);
    }
    setCurrentPage(1);
  }, [supplierSearch, suppliers]);

  // Filter manufacturers based on search
  useEffect(() => {
    if (manufacturerSearch.trim() === '') {
      setFilteredManufacturers(manufacturers);
    } else {
      const filtered = manufacturers.filter(m =>
        m.name.toLowerCase().includes(manufacturerSearch.toLowerCase())
      );
      setFilteredManufacturers(filtered);
    }
    setCurrentPage(1); // Reset to first page when searching
  }, [manufacturerSearch, manufacturers]);

  const loadSuppliers = async () => {
    try {
      setIsLoading(true);
      const data = await SupplierService.getAll();
      setSuppliers(data);
      setFilteredSuppliers(data);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load suppliers',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const loadManufacturers = async () => {
    try {
      setIsLoading(true);
      const data = await ManufacturerService.getAll();
      setManufacturers(data);
      setFilteredManufacturers(data);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load manufacturers',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Calculate pagination for suppliers
  const totalSupplierPages = Math.ceil(filteredSuppliers.length / itemsPerPage);
  const supplierStartIndex = (currentPage - 1) * itemsPerPage;
  const supplierEndIndex = supplierStartIndex + itemsPerPage;
  const paginatedSuppliers = filteredSuppliers.slice(supplierStartIndex, supplierEndIndex);

  // Calculate pagination for manufacturers
  const totalManufacturerPages = Math.ceil(filteredManufacturers.length / itemsPerPage);
  const manufacturerStartIndex = (currentPage - 1) * itemsPerPage;
  const manufacturerEndIndex = manufacturerStartIndex + itemsPerPage;
  const paginatedManufacturers = filteredManufacturers.slice(manufacturerStartIndex, manufacturerEndIndex);

  const handlePageChange = (page: number, type: 'supplier' | 'manufacturer') => {
    const totalPages = type === 'supplier' ? totalSupplierPages : totalManufacturerPages;
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  // Ledger search — runs while the picker is open, on what has been typed.
  useEffect(() => {
    if (!showDialog) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchSupplierLedgers(ledgerSearch)
        .then((options) => { if (!cancelled) setLedgerOptions(options); })
        .catch(() => { if (!cancelled) setLedgerOptions([]); });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [ledgerSearch, showDialog]);

  // Supplier CRUD handlers
  const handleAddOrUpdateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!supplierForm.supplier_name || !supplierForm.supplier_code) {
      toast({
        title: 'Error',
        description: 'Please fill in all required fields',
        variant: 'destructive',
      });
      return;
    }

    if (!supplierForm.ledger_account_id) {
      toast({
        title: 'Pick an accounting ledger',
        description:
          'Every supplier posts to a creditor ledger — goods received credit it and payments debit it.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsLoading(true);
      if (editingSupplier) {
        await SupplierService.update(editingSupplier.id, supplierForm);
        toast({
          title: 'Success',
          description: 'Supplier updated successfully',
        });
      } else {
        await SupplierService.create(supplierForm as Omit<Supplier, 'id' | 'created_at' | 'updated_at'>);
        toast({
          title: 'Success',
          description: 'Supplier added successfully',
        });
      }
      resetSupplierForm();
      setShowDialog(false);
      await loadSuppliers();
    } catch (error) {
      toast({
        title: 'Error',
        description: `Failed to ${editingSupplier ? 'update' : 'add'} supplier`,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditSupplier = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setSupplierForm(supplier);
    setLedgerSearch('');
    setLedgerOpen(false);
    setLedger(null);
    void fetchLedgerById(supplier.ledger_account_id).then(setLedger).catch(() => setLedger(null));
    setShowDialog(true);
  };

  const handleDeleteSupplier = async (id: number) => {
    if (!confirm('Are you sure you want to delete this supplier?')) {
      return;
    }

    try {
      setIsLoading(true);
      await SupplierService.delete(id);
      toast({
        title: 'Success',
        description: 'Supplier deleted successfully',
      });
      await loadSuppliers();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to delete supplier',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const resetSupplierForm = () => {
    setEditingSupplier(null);
    setSupplierForm({
      supplier_name: '',
      supplier_code: '',
      supplier_type: '',
      phone: '',
      credit_limit: 0,
      email: '',
      pin: '',
      dl_no: '',
      account_group: '',
      cst: '',
      s_tax_no: '',
      address: '',
      credit_day: 0,
      bank_or_branch: '',
      mobile: '',
      ledger_account_id: null,
    });
    setLedger(null);
    setLedgerSearch('');
    setLedgerOpen(false);
  };

  const handleAddOrUpdateManufacturer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manufacturerName.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a manufacturer name',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsLoading(true);
      if (editingManufacturer) {
        await ManufacturerService.update(editingManufacturer.id, manufacturerName, manufacturerAddress);
        toast({
          title: 'Success',
          description: 'Manufacturer updated successfully',
        });
      } else {
        await ManufacturerService.create(manufacturerName, manufacturerAddress);
        toast({
          title: 'Success',
          description: 'Manufacturer added successfully',
        });
      }
      setManufacturerName('');
      setManufacturerAddress('');
      setEditingManufacturer(null);
      await loadManufacturers();
    } catch (error) {
      toast({
        title: 'Error',
        description: `Failed to ${editingManufacturer ? 'update' : 'add'} manufacturer`,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditManufacturer = (manufacturer: ManufacturerCompany) => {
    setEditingManufacturer(manufacturer);
    setManufacturerName(manufacturer.name);
    setManufacturerAddress(manufacturer.address || '');
  };

  const handleDeleteManufacturer = async (id: number) => {
    if (!confirm('Are you sure you want to delete this manufacturer?')) {
      return;
    }

    try {
      setIsLoading(true);
      await ManufacturerService.delete(id);
      toast({
        title: 'Success',
        description: 'Manufacturer deleted successfully',
      });
      await loadManufacturers();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to delete manufacturer',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingManufacturer(null);
    setManufacturerName('');
    setManufacturerAddress('');
  };

  return (
    <div className="bg-white p-6 rounded shadow-md w-full">
      {/* Only show supplier table if activeTab is supplier */}
      {activeTab === 'supplier' && (
        <div className="w-full">
          <h2 className="text-xl font-bold text-green-800 mb-0">Supplier Management</h2>
          <div className="h-1 w-full mb-6" style={{background: 'linear-gradient(90deg, #ff9800, #e91e63, #3f51b5, #4caf50)'}}></div>

          {/* Search Box */}
          <div className="mb-4 flex items-center gap-3">
            <div className="flex-1 max-w-md">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                <input
                  type="text"
                  placeholder="Search suppliers..."
                  value={supplierSearch}
                  onChange={(e) => setSupplierSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="text-sm text-gray-600">
              Showing {filteredSuppliers.length} of {suppliers.length} suppliers
            </div>
          </div>

          {/* Add Supplier Form */}
          <div className="mb-6 p-4 bg-gray-50 rounded-md border border-gray-200">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-700">Quick Add Supplier</h3>
              <Button
                className="bg-blue-600 hover:bg-blue-700 text-white"
                onClick={() => { resetSupplierForm(); setShowDialog(true); }}
              >
                <Plus className="mr-2" size={18} />
                Add New Supplier
              </Button>
            </div>
          </div>

          {/* Supplier Table */}
          <div className="overflow-x-auto">
            {isLoading && !suppliers.length ? (
              <div className="text-center py-8">
                <p className="text-gray-500">Loading suppliers...</p>
              </div>
            ) : (
              <table className="min-w-full border border-gray-300">
                <thead>
                  <tr className="bg-blue-100 text-blue-900 text-base font-bold">
                    <th className="px-4 py-2 border">Supplier Name</th>
                    <th className="px-4 py-2 border">Supplier Code</th>
                    <th className="px-4 py-2 border">DL No.</th>
                    <th className="px-4 py-2 border">GST No.</th>
                    <th className="px-4 py-2 border">S.Tax No.</th>
                    <th className="px-4 py-2 border">Phone</th>
                    <th className="px-4 py-2 border">Ledger</th>
                    <th className="px-4 py-2 border">Edit</th>
                    <th className="px-4 py-2 border">Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSuppliers.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                        {supplierSearch ? 'No suppliers found matching your search.' : 'No suppliers found. Add one using the Add Supplier button.'}
                      </td>
                    </tr>
                  ) : (
                    paginatedSuppliers.map((s, idx) => (
                      <tr key={s.id} className={idx % 2 === 0 ? 'bg-gray-100' : 'bg-white'}>
                        <td className="px-4 py-2 border font-semibold">{s.supplier_name}</td>
                        <td className="px-4 py-2 border">{s.supplier_code}</td>
                        <td className="px-4 py-2 border">{s.dl_no}</td>
                        <td className="px-4 py-2 border">{s.cst}</td>
                        <td className="px-4 py-2 border">{s.s_tax_no}</td>
                        <td className="px-4 py-2 border">{s.phone}</td>
                        <td className="px-4 py-2 border text-center">
                          {s.ledger_account_id ? (
                            <span className="text-green-700">Mapped</span>
                          ) : (
                            <span className="text-red-600" title="Goods received from this supplier land in Other Creditors">
                              Not mapped
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 border text-center">
                          <button
                            onClick={() => handleEditSupplier(s)}
                            className="inline-block cursor-pointer text-blue-600 hover:text-blue-800"
                            disabled={isLoading}
                          >
                            <Pencil size={20} />
                          </button>
                        </td>
                        <td className="px-4 py-2 border text-center">
                          <button
                            onClick={() => handleDeleteSupplier(s.id)}
                            className="inline-block cursor-pointer text-red-600 hover:text-red-800"
                            disabled={isLoading}
                          >
                            <Trash2 size={20} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination Controls */}
          {filteredSuppliers.length > 0 && (
            <div className="mt-4 flex items-center justify-between">
              <div className="text-sm text-gray-600">
                Showing {supplierStartIndex + 1} to {Math.min(supplierEndIndex, filteredSuppliers.length)} of {filteredSuppliers.length} entries
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handlePageChange(1, 'supplier')}
                  disabled={currentPage === 1}
                  className="px-3 py-1 border rounded bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  First
                </button>
                <button
                  onClick={() => handlePageChange(currentPage - 1, 'supplier')}
                  disabled={currentPage === 1}
                  className="px-3 py-1 border rounded bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>

                {/* Page Numbers */}
                <div className="flex gap-1">
                  {Array.from({ length: totalSupplierPages }, (_, i) => i + 1)
                    .filter(page => {
                      return (
                        page === 1 ||
                        page === totalSupplierPages ||
                        (page >= currentPage - 1 && page <= currentPage + 1)
                      );
                    })
                    .map((page, idx, arr) => {
                      const showEllipsisBefore = idx > 0 && page - arr[idx - 1] > 1;
                      return (
                        <React.Fragment key={page}>
                          {showEllipsisBefore && <span className="px-2">...</span>}
                          <button
                            onClick={() => handlePageChange(page, 'supplier')}
                            className={`px-3 py-1 border rounded ${
                              currentPage === page
                                ? 'bg-blue-600 text-white'
                                : 'bg-white hover:bg-gray-100'
                            }`}
                          >
                            {page}
                          </button>
                        </React.Fragment>
                      );
                    })}
                </div>

                <button
                  onClick={() => handlePageChange(currentPage + 1, 'supplier')}
                  disabled={currentPage === totalSupplierPages}
                  className="px-3 py-1 border rounded bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
                <button
                  onClick={() => handlePageChange(totalSupplierPages, 'supplier')}
                  disabled={currentPage === totalSupplierPages}
                  className="px-3 py-1 border rounded bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Last
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {/* Add Supplier Dialog (full form as per screenshot) */}
      {showDialog && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-30 z-50">
          <div className="bg-white p-6 rounded shadow-md w-full max-w-5xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold mb-4">{editingSupplier ? 'Edit Supplier' : 'Add Supplier'}</h3>
            <form onSubmit={handleAddOrUpdateSupplier} className="grid grid-cols-2 gap-x-8 gap-y-3">
              {/* Left column */}
              <div className="flex flex-col gap-3">
                <label className="flex items-center gap-2">
                  <span className="w-32">Supplier Name<span className="text-red-500">*</span></span>
                  <input
                    className="border rounded px-2 py-1 flex-1"
                    value={supplierForm.supplier_name}
                    onChange={(e) => setSupplierForm({...supplierForm, supplier_name: e.target.value})}
                    required
                    disabled={isLoading}
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span className="w-32">Supplier Code<span className="text-red-500">*</span></span>
                  <input
                    className="border rounded px-2 py-1 flex-1"
                    value={supplierForm.supplier_code}
                    onChange={(e) => setSupplierForm({...supplierForm, supplier_code: e.target.value})}
                    required
                    disabled={isLoading}
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span className="w-32">Supplier Type</span>
                  <select
                    className="border rounded px-2 py-1 flex-1"
                    value={supplierForm.supplier_type}
                    onChange={(e) => setSupplierForm({...supplierForm, supplier_type: e.target.value})}
                    disabled={isLoading}
                  >
                    <option value="">Please select</option>
                    <option value="Distributor">Distributor</option>
                    <option value="Wholesaler">Wholesaler</option>
                    <option value="Retailer">Retailer</option>
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  <span className="w-32">Phone</span>
                  <input
                    className="border rounded px-2 py-1 flex-1"
                    value={supplierForm.phone}
                    onChange={(e) => setSupplierForm({...supplierForm, phone: e.target.value})}
                    disabled={isLoading}
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span className="w-32">Credit Limit<span className="text-red-500">*</span></span>
                  <input
                    type="number"
                    className="border rounded px-2 py-1 flex-1"
                    value={supplierForm.credit_limit}
                    onChange={(e) => setSupplierForm({...supplierForm, credit_limit: parseFloat(e.target.value) || 0})}
                    required
                    disabled={isLoading}
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span className="w-32">Email</span>
                  <input
                    type="email"
                    className="border rounded px-2 py-1 flex-1"
                    value={supplierForm.email}
                    onChange={(e) => setSupplierForm({...supplierForm, email: e.target.value})}
                    disabled={isLoading}
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span className="w-32">Pin</span>
                  <input
                    className="border rounded px-2 py-1 flex-1"
                    value={supplierForm.pin}
                    onChange={(e) => setSupplierForm({...supplierForm, pin: e.target.value})}
                    disabled={isLoading}
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span className="w-32">DL No.<span className="text-red-500">*</span></span>
                  <input
                    className="border rounded px-2 py-1 flex-1"
                    value={supplierForm.dl_no}
                    onChange={(e) => setSupplierForm({...supplierForm, dl_no: e.target.value})}
                    required
                    disabled={isLoading}
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span className="w-32">Account Group<span className="text-red-500">*</span></span>
                  <select
                    className="border rounded px-2 py-1 flex-1"
                    value={supplierForm.account_group}
                    onChange={(e) => setSupplierForm({...supplierForm, account_group: e.target.value})}
                    required
                    disabled={isLoading}
                  >
                    <option value="">Please Select</option>
                    <option value="Pharmacy">Pharmacy</option>
                    <option value="General">General</option>
                  </select>
                </label>
                {/* The creditor ledger this supplier posts to. Goods received
                    credit it; paying the vendor debits it. */}
                <div className="flex items-start gap-2">
                  <span className="w-32 pt-1">Accounting Ledger<span className="text-red-500">*</span></span>
                  <div className="relative flex-1">
                    <input
                      className="border rounded px-2 py-1 w-full"
                      value={ledger ? ledger.name : ledgerSearch}
                      placeholder="Search ledgers in the accounting module…"
                      autoComplete="off"
                      disabled={isLoading}
                      onFocus={() => setLedgerOpen(true)}
                      onChange={(e) => {
                        setLedger(null);
                        setSupplierForm({ ...supplierForm, ledger_account_id: null });
                        setLedgerSearch(e.target.value);
                        setLedgerOpen(true);
                      }}
                    />
                    {ledger && (
                      <p className="mt-1 text-xs text-green-700">
                        Mapped to {ledger.name}{ledger.code ? ` (${ledger.code})` : ''}
                      </p>
                    )}
                    {ledgerOpen && !ledger && (
                      <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded border bg-white shadow">
                        {ledgerOptions.length === 0 ? (
                          <p className="px-3 py-2 text-sm text-gray-500">
                            No creditor ledger matches — create it in the accounting module first.
                          </p>
                        ) : (
                          ledgerOptions.map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              className="block w-full px-3 py-2 text-left text-sm hover:bg-blue-50"
                              onClick={() => {
                                setLedger(option);
                                setSupplierForm({ ...supplierForm, ledger_account_id: option.id });
                                setLedgerSearch('');
                                setLedgerOpen(false);
                              }}
                            >
                              {option.name}
                              {option.code && <span className="ml-2 text-xs text-gray-500">{option.code}</span>}
                              {!option.companyName && (
                                <span className="ml-2 text-xs text-amber-700">central</span>
                              )}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {/* Right column */}
              <div className="flex flex-col gap-3">
                <label className="flex items-center gap-2">
                  <span className="w-32">GST No<span className="text-red-500">*</span></span>
                  <input
                    className="border rounded px-2 py-1 flex-1"
                    value={supplierForm.cst}
                    onChange={(e) => setSupplierForm({...supplierForm, cst: e.target.value})}
                    required
                    disabled={isLoading}
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span className="w-32">S. Tax No.</span>
                  <input
                    className="border rounded px-2 py-1 flex-1"
                    value={supplierForm.s_tax_no}
                    onChange={(e) => setSupplierForm({...supplierForm, s_tax_no: e.target.value})}
                    disabled={isLoading}
                  />
                </label>
                <label className="flex items-center gap-2 items-start">
                  <span className="w-32">Address</span>
                  <textarea
                    className="border rounded px-2 py-1 flex-1 min-h-[60px]"
                    value={supplierForm.address}
                    onChange={(e) => setSupplierForm({...supplierForm, address: e.target.value})}
                    disabled={isLoading}
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span className="w-32">Credit Day<span className="text-red-500">*</span></span>
                  <input
                    type="number"
                    className="border rounded px-2 py-1 flex-1"
                    value={supplierForm.credit_day}
                    onChange={(e) => setSupplierForm({...supplierForm, credit_day: parseInt(e.target.value) || 0})}
                    required
                    disabled={isLoading}
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span className="w-32">Bank or Branch</span>
                  <input
                    className="border rounded px-2 py-1 flex-1"
                    value={supplierForm.bank_or_branch}
                    onChange={(e) => setSupplierForm({...supplierForm, bank_or_branch: e.target.value})}
                    disabled={isLoading}
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span className="w-32">Mobile</span>
                  <input
                    className="border rounded px-2 py-1 flex-1"
                    value={supplierForm.mobile}
                    onChange={(e) => setSupplierForm({...supplierForm, mobile: e.target.value})}
                    disabled={isLoading}
                  />
                </label>
              </div>
              {/* Submit button */}
              <div className="col-span-2 flex justify-end mt-4">
                <Button
                  type="button"
                  className="bg-gray-300 text-black mr-2"
                  onClick={() => { setShowDialog(false); resetSupplierForm(); }}
                  disabled={isLoading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-blue-500 hover:bg-blue-600 text-white"
                  disabled={isLoading}
                >
                  {isLoading ? 'Saving...' : (editingSupplier ? 'Update' : 'Submit')}
                </Button>
              </div>
            </form>
              </div>
            </div>
      )}
      {/* Add after the supplier section */}
      {activeTab === 'manufacturer' && (
        <div className="w-full">
          <h2 className="text-xl font-bold text-green-800 mb-0">Manufacturing Company</h2>
          <div className="h-1 w-full mb-6" style={{background: 'linear-gradient(90deg, #ff9800, #e91e63, #3f51b5, #4caf50)'}}></div>

          {/* Search Box */}
          <div className="mb-4 flex items-center gap-3">
            <div className="flex-1 max-w-md">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                <input
                  type="text"
                  placeholder="Search manufacturers..."
                  value={manufacturerSearch}
                  onChange={(e) => setManufacturerSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="text-sm text-gray-600">
              Showing {filteredManufacturers.length} of {manufacturers.length} manufacturers
            </div>
          </div>

          <form onSubmit={handleAddOrUpdateManufacturer} className="flex flex-col gap-4 mb-6 p-4 bg-gray-50 rounded-md border border-gray-200">
            <div className="flex items-center gap-4">
              <label className="font-semibold text-gray-700 whitespace-nowrap w-48">
                Manufacture Company Name<span className="text-red-500">*</span>
              </label>
              <input
                className="border border-gray-400 rounded px-4 py-2 text-lg flex-1"
                placeholder="add new manufacturer company name"
                value={manufacturerName}
                onChange={(e) => setManufacturerName(e.target.value)}
                disabled={isLoading}
                required
              />
            </div>
            <div className="flex items-center gap-4">
              <label className="font-semibold text-gray-700 whitespace-nowrap w-48">
                Address
              </label>
              <input
                className="border border-gray-400 rounded px-4 py-2 text-lg flex-1"
                placeholder="enter manufacturer address"
                value={manufacturerAddress}
                onChange={(e) => setManufacturerAddress(e.target.value)}
                disabled={isLoading}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="submit"
                className="bg-blue-600 text-white px-6 py-2 rounded font-bold hover:bg-blue-700 disabled:opacity-50"
                disabled={isLoading}
              >
                {editingManufacturer ? 'Update' : 'Submit'}
              </button>
              {editingManufacturer && (
                <button
                  type="button"
                  className="bg-gray-600 text-white px-6 py-2 rounded font-bold hover:bg-gray-700"
                  onClick={handleCancelEdit}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
          <div className="overflow-x-auto">
            {isLoading && !manufacturers.length ? (
              <div className="text-center py-8">
                <p className="text-gray-500">Loading manufacturers...</p>
              </div>
            ) : (
              <table className="min-w-full border border-gray-300">
                <thead>
                  <tr className="bg-blue-100 text-blue-900 text-base font-bold">
                    <th className="px-4 py-2 border">Manufacture Company Name</th>
                    <th className="px-4 py-2 border">Address</th>
                    <th className="px-4 py-2 border">Edit</th>
                    <th className="px-4 py-2 border">Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredManufacturers.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                        {manufacturerSearch ? 'No manufacturers found matching your search.' : 'No manufacturers found. Add one using the form above.'}
                      </td>
                    </tr>
                  ) : (
                    paginatedManufacturers.map((manufacturer, idx) => (
                      <tr key={manufacturer.id} className={idx % 2 === 0 ? "bg-gray-100" : "bg-white"}>
                        <td className="px-4 py-2 border font-semibold">{manufacturer.name}</td>
                        <td className="px-4 py-2 border">{manufacturer.address || '-'}</td>
                        <td className="px-4 py-2 border text-center">
                          <button
                            onClick={() => handleEditManufacturer(manufacturer)}
                            className="inline-block cursor-pointer text-blue-600 hover:text-blue-800"
                            disabled={isLoading}
                          >
                            <Pencil size={20} />
                          </button>
                        </td>
                        <td className="px-4 py-2 border text-center">
                          <button
                            onClick={() => handleDeleteManufacturer(manufacturer.id)}
                            className="inline-block cursor-pointer text-red-600 hover:text-red-800"
                            disabled={isLoading}
                          >
                            <Trash2 size={20} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}

            {/* Pagination Controls */}
            {filteredManufacturers.length > 0 && (
              <div className="mt-4 flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  Showing {manufacturerStartIndex + 1} to {Math.min(manufacturerEndIndex, filteredManufacturers.length)} of {filteredManufacturers.length} entries
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handlePageChange(1, 'manufacturer')}
                    disabled={currentPage === 1}
                    className="px-3 py-1 border rounded bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    First
                  </button>
                  <button
                    onClick={() => handlePageChange(currentPage - 1, 'manufacturer')}
                    disabled={currentPage === 1}
                    className="px-3 py-1 border rounded bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>

                  {/* Page Numbers */}
                  <div className="flex gap-1">
                    {Array.from({ length: totalManufacturerPages }, (_, i) => i + 1)
                      .filter(page => {
                        // Show first page, last page, current page, and pages around current
                        return (
                          page === 1 ||
                          page === totalManufacturerPages ||
                          (page >= currentPage - 1 && page <= currentPage + 1)
                        );
                      })
                      .map((page, idx, arr) => {
                        // Add ellipsis if there's a gap
                        const showEllipsisBefore = idx > 0 && page - arr[idx - 1] > 1;
                        return (
                          <React.Fragment key={page}>
                            {showEllipsisBefore && <span className="px-2">...</span>}
                            <button
                              onClick={() => handlePageChange(page, 'manufacturer')}
                              className={`px-3 py-1 border rounded ${
                                currentPage === page
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-white hover:bg-gray-100'
                              }`}
                            >
                              {page}
                            </button>
                          </React.Fragment>
                        );
                      })}
                  </div>

                  <button
                    onClick={() => handlePageChange(currentPage + 1, 'manufacturer')}
                    disabled={currentPage === totalManufacturerPages}
                    className="px-3 py-1 border rounded bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                  <button
                    onClick={() => handlePageChange(totalManufacturerPages, 'manufacturer')}
                    disabled={currentPage === totalManufacturerPages}
                    className="px-3 py-1 border rounded bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Last
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SupplierMaster; 