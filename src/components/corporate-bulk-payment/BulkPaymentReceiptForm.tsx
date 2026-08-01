import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useCorporateData } from '@/hooks/useCorporateData';
import { useCreateCorporateBulkPayment, useUpdateCorporateBulkPayment } from '@/hooks/useCorporateBulkPayments';
import { AllocationRow, CorporateBulkPayment, CORPORATE_PAYMENT_MODES } from '@/types/corporateBulkPayment';
import PatientAllocationTable from './PatientAllocationTable';

interface BulkPaymentReceiptFormProps {
  onSuccess: () => void;
  onCancel: () => void;
  editData?: CorporateBulkPayment | null;
}

const BulkPaymentReceiptForm: React.FC<BulkPaymentReceiptFormProps> = ({
  onSuccess,
  onCancel,
  editData,
}) => {
  const { user, hospitalConfig } = useAuth();
  const { corporateOptions, corporateIdMap, loading: corporatesLoading } = useCorporateData();
  const createMutation = useCreateCorporateBulkPayment();
  const updateMutation = useUpdateCorporateBulkPayment();
  const isEditMode = !!editData;

  const [corporateName, setCorporateName] = useState(editData?.corporate_name || '');
  const [paymentDate, setPaymentDate] = useState(
    editData?.payment_date || new Date().toISOString().split('T')[0]
  );
  const [paymentMode, setPaymentMode] = useState(editData?.payment_mode || 'ONLINE');
  const [referenceNumber, setReferenceNumber] = useState(editData?.reference_number || '');
  const [bankName, setBankName] = useState(editData?.bank_name || '');
  const [claimAmount, setClaimAmount] = useState(
    editData?.claim_amount ? String(editData.claim_amount) : ''
  );
  const [receivedAmount, setReceivedAmount] = useState(
    editData?.total_amount ? String(editData.total_amount) : ''
  );
  const [narration, setNarration] = useState(editData?.narration || '');
  const [allocations, setAllocations] = useState<AllocationRow[]>(
    editData?.allocations?.map((a) => ({
      temp_id: a.id || crypto.randomUUID(),
      patient_id: a.patient_id || '',
      patient_name: a.patient_name,
      patients_id: a.patients_id || '',
      visit_id: a.visit_id || '',
      amount: String(a.amount),
      bill_amount: String(a.bill_amount || ''),
      deduction_amount: String(a.deduction_amount || ''),
      tds_amount: String(a.tds_amount || ''),
      remarks: a.remarks || '',
    })) || []
  );

  // Fetch bank accounts from DB
  const [bankOptions, setBankOptions] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    const fetchBanks = async () => {
      const { data } = await supabase
        .from('chart_of_accounts')
        .select('account_name, account_code')
        .in('account_code', ['1121', '1122', '1123', '1124', '1125'])
        .eq('is_active', true)
        .order('account_name');
      if (data && data.length > 0) {
        const dbBanks = data.map((b: any) => ({ value: b.account_name, label: b.account_name }));
        setBankOptions([
          ...dbBanks,
          { value: 'Canara Bank (Itwari)', label: 'Canara Bank (Itwari)' },
          { value: 'Shikshak Sahakari Bank', label: 'Shikshak Sahakari Bank' },
        ]);
      } else {
        setBankOptions([
          { value: 'Canara Bank [A/C120023677813)JARIPATHKA ]', label: 'Canara Bank [A/C120023677813)JARIPATHKA ]' },
          { value: 'SARASWAT BANK', label: 'SARASWAT BANK' },
          { value: 'STATE BANK OF INDIA (DRM)', label: 'STATE BANK OF INDIA (DRM)' },
          { value: 'Canara Bank (Itwari)', label: 'Canara Bank (Itwari)' },
          { value: 'Shikshak Sahakari Bank', label: 'Shikshak Sahakari Bank' },
        ]);
      }
    };
    fetchBanks();
  }, []);

  const totalAllocated = allocations.reduce(
    (sum, a) => sum + (parseFloat(a.amount) || 0),
    0
  );

  const handleSubmit = async () => {
    // Validation
    if (!corporateName) {
      toast.error('Please select a corporate');
      return;
    }
    if (!paymentDate) {
      toast.error('Please select a payment date');
      return;
    }
    if (!paymentMode) {
      toast.error('Please select a payment mode');
      return;
    }
    if (!receivedAmount || parseFloat(receivedAmount) < 0) {
      toast.error('Please enter the received bulk amount');
      return;
    }
    const validAllocations = allocations.filter(
      (a) => a.patient_name
    );

    // Get corporate UUID from the pre-loaded map
    const corporateId = corporateIdMap[corporateName] || null;

    const allocationPayload = validAllocations.map((a) => ({
      patient_id: a.patient_id || null,
      patient_name: a.patient_name,
      visit_id: a.visit_id || null,
      amount: parseFloat(a.amount) || 0,
      bill_amount: parseFloat(a.bill_amount) || null,
      deduction_amount: parseFloat(a.deduction_amount) || null,
      tds_amount: parseFloat(a.tds_amount) || null,
      remarks: a.remarks || null,
    }));

    try {
      if (isEditMode && editData) {
        await updateMutation.mutateAsync({
          id: editData.id,
          header: {
            corporate_name: corporateName,
            payment_date: paymentDate,
            payment_mode: paymentMode,
            reference_number: referenceNumber || null,
            bank_name: bankName || null,
            claim_amount: claimAmount ? parseFloat(claimAmount) : null,
            total_amount: parseFloat(receivedAmount),
            narration: narration || null,
          },
          allocations: allocationPayload,
        });
        toast.success('Receipt updated successfully');
      } else {
        await createMutation.mutateAsync({
          header: {
            corporate_name: corporateName,
            corporate_id: corporateId,
            payment_date: paymentDate,
            payment_mode: paymentMode,
            reference_number: referenceNumber || null,
            bank_name: bankName || null,
            claim_amount: claimAmount ? parseFloat(claimAmount) : null,
            total_amount: parseFloat(receivedAmount),
            narration: narration || null,
            hospital_name: hospitalConfig.name,
            created_by: user?.email || null,
          },
          allocations: allocationPayload,
        });
        toast.success('Corporate bulk payment receipt saved successfully');
      }
      onSuccess();
    } catch (error: any) {
      console.error('Error saving bulk payment:', error);
      toast.error(`Failed to save: ${error.message || 'Unknown error'}`);
    }
  };

  const showBankField = paymentMode && paymentMode !== 'CASH' && paymentMode !== 'UPI';

  return (
    <div className="space-y-5 max-h-[70vh] overflow-y-auto pr-1">
      {/* Payment Header Fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Corporate *</Label>
          <SearchableSelect
            options={corporateOptions}
            value={corporateName}
            onValueChange={setCorporateName}
            placeholder="Select corporate..."
            searchPlaceholder="Search corporates..."
          />
        </div>

        <div className="space-y-2">
          <Label>Payment Date *</Label>
          <Input
            type="date"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Payment Mode *</Label>
          <Select value={paymentMode} onValueChange={setPaymentMode}>
            <SelectTrigger>
              <SelectValue placeholder="Select mode..." />
            </SelectTrigger>
            <SelectContent>
              {CORPORATE_PAYMENT_MODES.map((mode) => (
                <SelectItem key={mode.value} value={mode.value}>
                  {mode.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Reference / UTR Number</Label>
          <Input
            placeholder="Cheque no., UTR, transaction ref..."
            value={referenceNumber}
            onChange={(e) => setReferenceNumber(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Claim Amount (Rs.)</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="Enter total claim amount..."
            value={claimAmount}
            onChange={(e) => {
              const val = e.target.value;
              setClaimAmount(val.replace(/^0+(?=\d)/, '') || val);
            }}
          />
        </div>

        <div className="space-y-2">
          <Label>Received Bulk Amount (Rs.) *</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="Enter total amount received..."
            value={receivedAmount}
            onChange={(e) => {
              const val = e.target.value;
              setReceivedAmount(val.replace(/^0+(?=\d)/, '') || val);
            }}
            className="text-lg font-semibold"
          />
        </div>

        {showBankField && (
          <div className="space-y-2">
            <Label>Bank Name</Label>
            <SearchableSelect
              options={bankOptions}
              value={bankName}
              onValueChange={setBankName}
              placeholder="Select bank..."
              searchPlaceholder="Search banks..."
            />
          </div>
        )}

        <div className="space-y-2 md:col-span-2">
          <Label>Narration / Remarks</Label>
          <Textarea
            placeholder="Optional narration..."
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
            rows={2}
          />
        </div>
      </div>

      {/* Patient Allocation — optional at receipt time. The bulk amount is
          entered the day the money arrives; patient-wise allocation can be
          done later by editing this receipt. */}
      <p className="text-xs text-muted-foreground">
        Patient-wise allocation is optional now — save the bulk receipt first and come back to
        allocate patients when the statement is worked out. Unallocated receipts stay flagged on
        the list.
      </p>
      <PatientAllocationTable
        allocations={allocations}
        onAllocationsChange={setAllocations}
      />

      {/* Total & Actions */}
      <div className="flex items-center justify-between pt-3 border-t">
        <div className="space-y-1">
          <div className="text-sm text-gray-600">
            Received: <span className="font-semibold text-black">Rs. {(parseFloat(receivedAmount) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="text-sm text-gray-600">
            Allocated: <span className="font-semibold text-black">Rs. {totalAllocated.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
          {receivedAmount && (
            <div className={`text-sm font-semibold ${
              (parseFloat(receivedAmount) || 0) - totalAllocated === 0
                ? 'text-green-600'
                : (parseFloat(receivedAmount) || 0) - totalAllocated > 0
                  ? 'text-orange-500'
                  : 'text-red-500'
            }`}>
              Unallocated: Rs. {((parseFloat(receivedAmount) || 0) - totalAllocated).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending || updateMutation.isPending}
          >
            {(createMutation.isPending || updateMutation.isPending)
              ? 'Saving...'
              : isEditMode ? 'Update Receipt' : 'Save Receipt'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default BulkPaymentReceiptForm;
