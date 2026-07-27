import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

interface DiscountTabProps {
  visitId?: string;
  onDiscountUpdate?: (discountAmount: number) => void;
  requiresApproval?: boolean;
}

interface DiscountData {
  id?: string;
  discount_amount: number;
  discount_reason: string;
  approval_status?: string;
  approved_by?: string;
  approved_at?: string;
  rejection_reason?: string;
}

export const DiscountTab: React.FC<DiscountTabProps> = ({
  visitId,
  onDiscountUpdate,
  requiresApproval = true,
}) => {
  const { isAdmin, hospitalConfig } = useAuth() as any;
  const approvalRequiredForUser = requiresApproval && !isAdmin;
  const [discountData, setDiscountData] = useState<DiscountData>({
    discount_amount: 0,
    discount_reason: ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);


  // Load existing discount data
  useEffect(() => {
    const loadDiscountData = async () => {
      if (!visitId) {
        return;
      }

      setIsLoading(true);
      try {
        console.log('🔍 [DISCOUNT LOAD] Loading discount data for visitId:', visitId);

        // Convert visitId (string) to visit UUID
        const { data: visitData, error: visitError } = await supabase
          .from('visits')
          .select('id')
          .eq('visit_id', visitId)
          .single();

        if (visitError) {
          console.error('❌ [DISCOUNT LOAD] Error finding visit UUID:', visitError);
          toast.error('Error finding visit record for discount loading');
          return;
        }

        if (!visitData) {
          return;
        }


        // Load discount data using visit UUID
        const { data: discountData, error: discountError } = await supabase
          .from('visit_discounts')
          .select('*')
          .eq('visit_id', visitData.id)
          .single();

        if (discountError && discountError.code !== 'PGRST116') {
          console.error('❌ [DISCOUNT LOAD] Error loading discount data:', discountError);
          toast.error('Error loading discount data');
          return;
        }

        if (discountData) {
          setDiscountData({
            id: discountData.id,
            discount_amount: discountData.discount_amount || 0,
            discount_reason: discountData.discount_reason || '',
            approval_status: (discountData as any).approval_status || 'pending_approval',
            approved_by: (discountData as any).approved_by,
            approved_at: (discountData as any).approved_at,
            rejection_reason: (discountData as any).rejection_reason
          });

          // Only notify parent with discount amount if approved
          const status = (discountData as any).approval_status;
          if (onDiscountUpdate) {
            onDiscountUpdate(status === 'approved' ? (discountData.discount_amount || 0) : 0);
          }
        } else {
          console.log('📝 [DISCOUNT LOAD] No existing discount found');
        }
      } catch (error) {
        console.error('❌ [DISCOUNT LOAD] Exception:', error);
        toast.error('Failed to load discount data');
      } finally {
        setIsLoading(false);
      }
    };

    loadDiscountData();
  }, [visitId]);

  // Save discount data
  const handleSaveDiscount = async () => {
    if (!visitId) {
      toast.error('Visit ID is required to save discount');
      return;
    }

    if (discountData.discount_amount < 0) {
      toast.error('Discount amount cannot be negative');
      return;
    }

    setIsSaving(true);
    try {
      // Convert visitId (string) to visit UUID
      const { data: visitData, error: visitError } = await supabase
        .from('visits')
        .select('id')
        .eq('visit_id', visitId)
        .single();

      if (visitError || !visitData) {
        toast.error('Error finding visit record');
        return;
      }

      // Get current user
      const currentUser = localStorage.getItem('userEmail') || localStorage.getItem('userName') || 'Unknown User';

      // Only non-admin IPD discounts require approval. OPD discounts are
      // approved immediately and never enter the approval queue.
      const approveImmediately = isAdmin || !requiresApproval;
      const upsertData: any = {
        visit_id: visitData.id,
        discount_amount: discountData.discount_amount,
        discount_reason: discountData.discount_reason,
        applied_by: currentUser,
        updated_at: new Date().toISOString(),
        approval_status: approveImmediately ? 'approved' : 'pending_approval',
        hospital_name: hospitalConfig?.name || 'unknown',
        ...(approveImmediately
          ? { approved_by: currentUser, approved_at: new Date().toISOString(), rejection_reason: null }
          : { approved_by: null, approved_at: null, rejection_reason: null })
      };

      // Upsert discount data
      const { data: savedData, error: saveError } = await supabase
        .from('visit_discounts')
        .upsert(upsertData, { onConflict: 'visit_id' })
        .select()
        .single();

      if (saveError) {
        console.error('Error saving discount:', saveError);
        toast.error('Failed to save discount');
        return;
      }

      // Update local state with saved data
      setDiscountData(prev => ({
        ...prev,
        id: savedData.id,
        approval_status: approveImmediately ? 'approved' : 'pending_approval'
      }));

      // Apply OPD discounts immediately; only non-admin IPD requests wait.
      if (onDiscountUpdate) {
        onDiscountUpdate(approveImmediately ? discountData.discount_amount : 0);
      }

      if (approveImmediately) {
        toast.success('Discount approved and saved!');
      } else {
        toast.success('Discount submitted for admin approval!');
      }

      // WhatsApp alert for discounts > Rs. 33,000
      if (discountData.discount_amount >= 33000) {
        import('@/lib/payment-alert-service').then(({ sendPaymentAlert }) => {
          sendPaymentAlert({
            alert_type: 'discount',
            amount: discountData.discount_amount,
            patient_name: `Visit: ${visitId}`,
            visit_id: visitId,
            additional_info: `Reason: ${discountData.discount_reason || 'Not specified'}`,
          });
        });
      }
    } catch (error) {
      console.error('Exception saving discount:', error);
      toast.error('Failed to save discount');
    } finally {
      setIsSaving(false);
    }
  };

  // Handle discount amount change
  const handleDiscountAmountChange = (value: string) => {
    const numericValue = parseFloat(value) || 0;
    setDiscountData(prev => ({
      ...prev,
      discount_amount: numericValue
    }));
  };

  // Handle discount reason change
  const handleDiscountReasonChange = (value: string) => {
    setDiscountData(prev => ({
      ...prev,
      discount_reason: value
    }));
  };

  if (isLoading) {
    return (
      <div className="p-6 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading discount information...</p>
      </div>
    );
  }

  return (
    <div className="p-6 bg-white rounded-lg shadow-sm">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Bill Discount</h3>
          <p className="text-sm text-gray-600">
            Enter discount amount to apply to this bill. The discount will appear in the financial summary table.
          </p>
        </div>

        {/* Discount Form */}
        <div className="space-y-4">
          {/* Discount Amount */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Discount Amount (₹)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={discountData.discount_amount || ''}
              onChange={(e) => handleDiscountAmountChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter discount amount"
            />
          </div>

          {/* Discount Reason */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Discount Reason (Optional)
            </label>
            <textarea
              value={discountData.discount_reason}
              onChange={(e) => handleDiscountReasonChange(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter reason for discount (e.g., Senior citizen discount, Insurance coverage, etc.)"
            />
          </div>

          {/* Save Button */}
          <div className="flex justify-end pt-4">
            <button
              onClick={handleSaveDiscount}
              disabled={isSaving || (discountData.approval_status === 'pending_approval' && approvalRequiredForUser)}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {isSaving ? (
                <span className="flex items-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Saving...
                </span>
              ) : isAdmin ? (
                'Approve & Save Discount'
              ) : !requiresApproval ? (
                'Save Discount'
              ) : (
                'Submit for Approval'
              )}
            </button>
          </div>
        </div>

        {/* Discount Status */}
        {discountData.id && discountData.approval_status === 'approved' && (
          <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-green-800">
                  Discount of ₹{discountData.discount_amount.toLocaleString()} approved{discountData.approved_by ? ` by ${discountData.approved_by}` : ''}.
                </p>
              </div>
            </div>
          </div>
        )}

        {discountData.id && discountData.approval_status === 'pending_approval' && (
          <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-yellow-800">
                  Discount of ₹{discountData.discount_amount.toLocaleString()} is pending admin approval.
                </p>
              </div>
            </div>
          </div>
        )}

        {discountData.id && discountData.approval_status === 'rejected' && (
          <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-red-800">
                  Discount rejected{discountData.rejection_reason ? `: ${discountData.rejection_reason}` : ''}.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
