// DATA SOURCE: payment_requests → UPI QR generation + status tracking

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { QrCode, CheckCircle, X, Copy, IndianRupee, Clock, RefreshCw } from 'lucide-react';
import { format, differenceInSeconds } from 'date-fns';

// ── Types ────────────────────────────────────────────────────────────────────

type PaymentStatus = 'pending' | 'paid' | 'failed' | 'expired' | 'cancelled';

interface PaymentRequest {
  id: string;
  visit_id: string | null;
  patient_name: string;
  amount: number;
  upi_id: string;
  upi_ref: string | null;
  qr_data: string | null;
  gateway: string | null;
  status: PaymentStatus;
  notes: string | null;
  created_at: string;
  paid_at: string | null;
  expires_at: string | null;
}

interface GenerateFormState {
  patient_name: string;
  visit_id: string;
  amount: string;
  upi_id: string;
  notes: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a UPI deep-link string from payment details */
function buildUpiString(upiId: string, amount: number): string {
  return `upi://pay?pa=${encodeURIComponent(upiId)}&pn=Hope+Hospital&am=${amount}&cu=INR&tn=Bill+Payment`;
}

/** Return the qrserver.com image URL for a given UPI deep-link */
function buildQrImageUrl(upiString: string): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(upiString)}`;
}

// Hospital's live UPI account, decoded from the PhonePe merchant QR.
const HOSPITAL_UPI_ID = '9373111709-3@ybl';
const HOSPITAL_PAYEE = 'Murali B. Kasiammal';
/** Exact UPI string from the hospital's PhonePe QR — scan to pay any amount. */
const STATIC_UPI_STRING =
  'upi://pay?pa=9373111709-3@ybl&pn=MURALI%20%20BALASUNDARAM%20KASIAMMAL&mc=0000&mode=02&purpose=00';

/** Format seconds into MM:SS countdown display */
function formatCountdown(seconds: number): string {
  if (seconds <= 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Return relative time label like "2 min ago" */
function timeAgo(dateStr: string): string {
  const diff = differenceInSeconds(new Date(), new Date(dateStr));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return format(new Date(dateStr), 'd MMM');
}

/** Map status to badge variant styling */
function statusBadgeClass(status: PaymentStatus): string {
  switch (status) {
    case 'paid':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'pending':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'failed':
      return 'bg-red-100 text-red-800 border-red-200';
    case 'expired':
    case 'cancelled':
    default:
      return 'bg-gray-100 text-gray-600 border-gray-200';
  }
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function PaymentQR() {
  const queryClient = useQueryClient();

  // The currently displayed payment request in the center panel
  const [activeRequest, setActiveRequest] = useState<PaymentRequest | null>(null);

  // Countdown seconds remaining for the active request
  const [countdown, setCountdown] = useState<number>(0);

  // Left-panel form state
  const [form, setForm] = useState<GenerateFormState>({
    patient_name: '',
    visit_id: '',
    amount: '',
    upi_id: HOSPITAL_UPI_ID,
    notes: '',
  });

  // ── Queries ────────────────────────────────────────────────────────────────

  // DATA SOURCE: payment_requests → order by created_at desc, limit 30
  const { data: recentRequests = [], isLoading: loadingRecent } = useQuery({
    queryKey: ['payment_requests'],
    queryFn: async (): Promise<PaymentRequest[]> => {
      const { data, error } = await supabase
        .from('payment_requests')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw new Error(error.message);
      return (data ?? []) as PaymentRequest[];
    },
    // Recent history does not need polling when there is no open payment.
    // Keep the existing 15-second status response only while a request is
    // still pending; mutations invalidate this query immediately.
    refetchInterval: (query) =>
      query.state.data?.some((request) => request.status === 'pending') ? 15000 : false,
  });

  // Today's total collected — sum of paid amounts for today
  const todayTotal: number = recentRequests.reduce((acc, r) => {
    if (r.status !== 'paid' || !r.paid_at) return acc;
    const paidDate = format(new Date(r.paid_at), 'yyyy-MM-dd');
    const today = format(new Date(), 'yyyy-MM-dd');
    if (paidDate !== today) return acc;
    return acc + (r.amount ?? 0);
  }, 0);

  // ── Mutations ──────────────────────────────────────────────────────────────

  /** Insert a new payment_request row and set it as active */
  const generateMutation = useMutation({
    mutationFn: async (): Promise<PaymentRequest> => {
      const amount = parseFloat(form.amount);
      if (!form.patient_name.trim()) throw new Error('Patient name is required');
      if (isNaN(amount) || amount < 1) throw new Error('Amount must be at least ₹1');

      const upiString = buildUpiString(form.upi_id.trim() || HOSPITAL_UPI_ID, amount);
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min from now

      const insertPayload: Record<string, unknown> = {
        patient_name: form.patient_name.trim(),
        amount,
        upi_id: form.upi_id.trim() || HOSPITAL_UPI_ID,
        qr_data: upiString,
        status: 'pending',
        expires_at: expiresAt,
        ...(form.visit_id.trim() ? { visit_id: form.visit_id.trim() } : {}),
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      };

      const { data, error } = await supabase
        .from('payment_requests')
        .insert(insertPayload)
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data as PaymentRequest;
    },
    onSuccess: (newRecord) => {
      setActiveRequest(newRecord);
      queryClient.invalidateQueries({ queryKey: ['payment_requests'] });
      toast.success('QR code generated');
    },
    onError: (err: Error) => {
      toast.error(`Failed to generate QR: ${err.message}`);
    },
  });

  /** Mark the active request as paid */
  const markPaidMutation = useMutation({
    mutationFn: async (id: string): Promise<PaymentRequest> => {
      const { data, error } = await supabase
        .from('payment_requests')
        .update({ status: 'paid', paid_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as PaymentRequest;
    },
    onSuccess: (updated) => {
      setActiveRequest(updated);
      queryClient.invalidateQueries({ queryKey: ['payment_requests'] });
      toast.success('Payment marked as paid');
    },
    onError: (err: Error) => {
      toast.error(`Failed to update: ${err.message}`);
    },
  });

  /** Cancel the active request */
  const cancelMutation = useMutation({
    mutationFn: async (id: string): Promise<PaymentRequest> => {
      const { data, error } = await supabase
        .from('payment_requests')
        .update({ status: 'cancelled' })
        .eq('id', id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as PaymentRequest;
    },
    onSuccess: (updated) => {
      setActiveRequest(updated);
      queryClient.invalidateQueries({ queryKey: ['payment_requests'] });
      toast.success('Payment request cancelled');
    },
    onError: (err: Error) => {
      toast.error(`Failed to cancel: ${err.message}`);
    },
  });

  // ── Countdown effect ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!activeRequest?.expires_at) {
      setCountdown(0);
      return;
    }

    // Recompute immediately
    const recompute = () => {
      const secs = differenceInSeconds(new Date(activeRequest.expires_at!), new Date());
      setCountdown(Math.max(0, secs));
    };

    recompute();
    const interval = setInterval(recompute, 1000);
    return () => clearInterval(interval);
  }, [activeRequest?.expires_at]);

  // ── Derived QR values ──────────────────────────────────────────────────────

  const activeUpiString = activeRequest?.qr_data ?? null;
  const activeQrImageUrl = activeUpiString ? buildQrImageUrl(activeUpiString) : null;

  // ── Handlers ───────────────────────────────────────────────────────────────

  /** Handle form field changes */
  const handleFormChange = (field: keyof GenerateFormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  /** Copy UPI link to clipboard */
  const handleCopyUpiLink = () => {
    if (!activeUpiString) return;
    navigator.clipboard.writeText(activeUpiString).then(() => {
      toast.success('UPI link copied');
    }).catch(() => {
      toast.error('Failed to copy to clipboard');
    });
  };

  /** Click a pending request in the sidebar to show its QR */
  const handleSelectRequest = (req: PaymentRequest) => {
    if (req.status === 'pending') {
      setActiveRequest(req);
    }
  };

  /** Submit generate form */
  const handleGenerate = () => {
    generateMutation.mutate();
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 min-h-screen bg-gray-50">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <QrCode className="h-6 w-6 text-blue-600" />
          UPI Payment QR
        </h1>
        <p className="text-sm text-gray-500 mt-1">Generate QR codes for patient bill payments via UPI</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Left Panel: Generate Payment Request ─────────────────────────── */}
        <Card className="shadow-sm border border-gray-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-gray-800 flex items-center gap-2">
              <IndianRupee className="h-4 w-4 text-green-600" />
              Generate Payment Request
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Patient Name <span className="text-red-500">*</span>
              </label>
              <Input
                placeholder="Enter patient name"
                value={form.patient_name}
                onChange={(e) => handleFormChange('patient_name', e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Visit ID <span className="text-gray-400 text-xs">(optional)</span>
              </label>
              <Input
                placeholder="Paste visit UUID (optional)"
                value={form.visit_id}
                onChange={(e) => handleFormChange('visit_id', e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Amount ₹ <span className="text-red-500">*</span>
              </label>
              <Input
                type="number"
                min={1}
                placeholder="0.00"
                value={form.amount}
                onChange={(e) => handleFormChange('amount', e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">UPI ID</label>
              <Input
                placeholder={HOSPITAL_UPI_ID}
                value={form.upi_id}
                onChange={(e) => handleFormChange('upi_id', e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes <span className="text-gray-400 text-xs">(optional)</span>
              </label>
              <Input
                placeholder="Any notes for this payment"
                value={form.notes}
                onChange={(e) => handleFormChange('notes', e.target.value)}
              />
            </div>

            <Button
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              onClick={handleGenerate}
              disabled={generateMutation.isPending}
            >
              {generateMutation.isPending ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <QrCode className="h-4 w-4 mr-2" />
                  Generate QR
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* ── Center Panel: QR Display ──────────────────────────────────────── */}
        <Card className="shadow-sm border border-gray-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-gray-800 flex items-center gap-2">
              <QrCode className="h-4 w-4 text-blue-600" />
              QR Code
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!activeRequest ? (
              <div className="flex flex-col items-center justify-center gap-3 py-4">
                <div className="border border-gray-200 rounded-lg p-3 bg-white shadow-sm">
                  <img
                    src={buildQrImageUrl(STATIC_UPI_STRING)}
                    alt="Hospital PhonePe UPI QR"
                    width={250}
                    height={250}
                    className="rounded"
                  />
                </div>
                <p className="text-sm font-semibold text-gray-700">Scan to Pay · PhonePe / UPI</p>
                <p className="text-xs text-gray-500">{HOSPITAL_PAYEE} · {HOSPITAL_UPI_ID}</p>
                <p className="text-xs text-gray-400 text-center max-w-[260px]">
                  Scan with any UPI app to pay directly, or generate a request on the left to lock in a specific amount.
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4">
                {/* Status badge */}
                <Badge
                  variant="outline"
                  className={`text-xs font-semibold px-3 py-1 border ${statusBadgeClass(activeRequest.status)}`}
                >
                  {activeRequest.status.toUpperCase()}
                </Badge>

                {/* Patient name */}
                <p className="text-sm font-medium text-gray-700">{activeRequest.patient_name}</p>

                {/* Amount */}
                <div className="flex items-center text-3xl font-bold text-gray-900">
                  <IndianRupee className="h-7 w-7 mr-1" />
                  {activeRequest.amount.toLocaleString('en-IN')}
                </div>

                {/* UPI ID */}
                <p className="text-xs text-gray-500">UPI: {activeRequest.upi_id}</p>

                {/* QR image */}
                {activeQrImageUrl && (
                  <div className="border border-gray-200 rounded-lg p-3 bg-white shadow-sm">
                    <img
                      src={activeQrImageUrl}
                      alt="UPI Payment QR Code"
                      width={250}
                      height={250}
                      className="rounded"
                    />
                  </div>
                )}

                {/* Countdown timer */}
                {activeRequest.status === 'pending' && activeRequest.expires_at && (
                  <div className="flex items-center gap-2 text-sm text-orange-600 font-mono font-semibold">
                    <Clock className="h-4 w-4" />
                    {countdown > 0
                      ? `Expires in ${formatCountdown(countdown)}`
                      : 'Expired'}
                  </div>
                )}

                {/* Action buttons */}
                {activeRequest.status === 'pending' && (
                  <div className="flex flex-col gap-2 w-full">
                    <Button
                      className="w-full bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => markPaidMutation.mutate(activeRequest.id)}
                      disabled={markPaidMutation.isPending}
                    >
                      {markPaidMutation.isPending ? (
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <CheckCircle className="h-4 w-4 mr-2" />
                      )}
                      Mark as Paid
                    </Button>

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1 border-gray-300 hover:bg-gray-50"
                        onClick={handleCopyUpiLink}
                      >
                        <Copy className="h-4 w-4 mr-2" />
                        Share
                      </Button>
                      <Button
                        variant="outline"
                        className="flex-1 border-red-200 text-red-600 hover:bg-red-50"
                        onClick={() => cancelMutation.mutate(activeRequest.id)}
                        disabled={cancelMutation.isPending}
                      >
                        <X className="h-4 w-4 mr-2" />
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {/* Paid confirmation */}
                {activeRequest.status === 'paid' && activeRequest.paid_at && (
                  <div className="flex flex-col items-center gap-1 text-green-700 text-sm">
                    <CheckCircle className="h-8 w-8 text-green-500" />
                    <span className="font-semibold">Payment Received</span>
                    <span className="text-xs text-gray-500">
                      {format(new Date(activeRequest.paid_at), 'dd MMM yyyy, hh:mm a')}
                    </span>
                  </div>
                )}

                {/* Cancelled/expired state */}
                {(activeRequest.status === 'cancelled' || activeRequest.status === 'expired') && (
                  <div className="flex items-center gap-2 text-gray-500 text-sm">
                    <X className="h-5 w-5" />
                    <span>Request {activeRequest.status}</span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Right Panel: Recent Payment Requests ─────────────────────────── */}
        <Card className="shadow-sm border border-gray-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold text-gray-800 flex items-center gap-2">
                <Clock className="h-4 w-4 text-gray-500" />
                Recent Requests
              </CardTitle>
              {/* Today's total collected */}
              <div className="text-right">
                <p className="text-xs text-gray-400">Today Collected</p>
                <p className="text-sm font-bold text-green-700 flex items-center justify-end">
                  <IndianRupee className="h-3.5 w-3.5 mr-0.5" />
                  {todayTotal.toLocaleString('en-IN')}
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loadingRecent ? (
              <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Loading…
              </div>
            ) : recentRequests.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-gray-400">
                <p className="text-sm">No payment requests yet</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100 max-h-[520px] overflow-y-auto">
                {recentRequests.map((req) => (
                  <li
                    key={req.id}
                    onClick={() => handleSelectRequest(req)}
                    className={`px-4 py-3 flex items-start justify-between gap-3 transition-colors ${
                      req.status === 'pending'
                        ? 'cursor-pointer hover:bg-blue-50'
                        : 'cursor-default'
                    } ${activeRequest?.id === req.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{req.patient_name}</p>
                      <div className="flex items-center gap-1 text-sm font-semibold text-gray-700 mt-0.5">
                        <IndianRupee className="h-3.5 w-3.5" />
                        {req.amount.toLocaleString('en-IN')}
                      </div>
                      {req.notes && (
                        <p className="text-xs text-gray-400 truncate mt-0.5">{req.notes}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-0.5">{timeAgo(req.created_at)}</p>
                    </div>
                    <div className="flex-shrink-0 pt-0.5">
                      <Badge
                        variant="outline"
                        className={`text-xs font-semibold border ${statusBadgeClass(req.status)}`}
                      >
                        {req.status}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
