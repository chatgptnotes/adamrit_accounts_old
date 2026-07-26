// Blocking gate shown in place of a locked invoice.
//
// Rendered INSTEAD OF the bill, never over it — an overlay would leave the real
// content in the DOM, one devtools node-delete away from being read.
//
// The field is a password input, not a run of OTP slots: the access code is
// short, and masking it stops it being read over a shoulder or captured in a
// screen-share while someone types it at a ward terminal.

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Eye, EyeOff, Loader2, Lock, ShieldCheck } from 'lucide-react';

interface InvoicePasswordGateProps {
  billNo?: string | null;
  patientName?: string | null;
  verifying: boolean;
  error: string | null;
  onUnlock: (code: string) => void;
  onBack?: () => void;
}

export const InvoicePasswordGate: React.FC<InvoicePasswordGateProps> = ({
  billNo,
  patientName,
  verifying,
  error,
  onUnlock,
  onBack,
}) => {
  const [code, setCode] = useState('');
  const [reveal, setReveal] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim() && !verifying) onUnlock(code.trim());
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow-lg p-8">
        <div className="flex flex-col items-center text-center">
          <div className="h-14 w-14 rounded-full bg-amber-100 flex items-center justify-center mb-4">
            <Lock className="h-7 w-7 text-amber-600" />
          </div>

          <h1 className="text-xl font-bold text-gray-900">This invoice is protected</h1>
          <p className="mt-2 text-sm text-gray-600">
            Payment has been received for this bill. Enter the access password to view it.
          </p>

          {(billNo || patientName) && (
            <div className="mt-4 w-full rounded-md bg-gray-50 border border-gray-200 p-3 text-sm text-gray-700">
              {billNo && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Bill</span>
                  <span className="font-medium">{billNo}</span>
                </div>
              )}
              {patientName && (
                <div className="flex justify-between mt-1">
                  <span className="text-gray-500">Patient</span>
                  <span className="font-medium">{patientName}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="relative">
            <label htmlFor="invoice-access-code" className="sr-only">
              Access password
            </label>
            <Input
              id="invoice-access-code"
              type={reveal ? 'text' : 'password'}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              placeholder="Access password"
              className="text-center text-xl tracking-[0.3em] font-mono h-14 pr-12"
              disabled={verifying}
            />
            <button
              type="button"
              onClick={() => setReveal((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label={reveal ? 'Hide password' : 'Show password'}
              tabIndex={-1}
            >
              {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {error && (
            <p className="text-sm text-center text-red-600 bg-red-50 border border-red-200 rounded-md py-2 px-3">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={!code.trim() || verifying}>
            {verifying ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Checking…
              </>
            ) : (
              <>
                <ShieldCheck className="h-4 w-4 mr-2" />
                Unlock invoice
              </>
            )}
          </Button>
        </form>

        <p className="mt-4 text-[11px] text-center text-gray-400">
          Access unlocks for 15 minutes and is recorded against your account.
        </p>

        {onBack && (
          <Button variant="ghost" size="sm" className="w-full mt-3" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Go back
          </Button>
        )}
      </div>
    </div>
  );
};

export default InvoicePasswordGate;
