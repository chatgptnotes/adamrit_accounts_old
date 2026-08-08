import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { validatePassword } from '@/utils/auth';
import { Mail, KeyRound, CheckCircle2 } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Prefills the email box from whatever was typed on the login form. */
  initialEmail?: string;
}

const ERRORS: Record<string, string> = {
  email_not_configured: 'Password reset by email is not set up yet. Ask your administrator to reset it for you.',
  email_send_failed: 'The code could not be emailed. Please try again in a moment.',
  too_many_attempts: 'Too many incorrect codes. Wait 15 minutes and start again.',
  code_expired_or_missing: 'That code has expired. Request a new one.',
  invalid_code: 'That code is not right. Check the email and try again.',
  password_too_short: 'Password must be at least 8 characters.',
};

const message = (code?: string) => ERRORS[code || ''] || 'Something went wrong. Please try again.';

/**
 * Three steps: ask for the address, enter the mailed code, set the password.
 *
 * The request step always reports success, even for an address that has no
 * account — the server answers identically either way, so this box cannot be
 * used to find out who works at the hospital.
 */
const ForgotPasswordDialog = ({ open, onClose, initialEmail = '' }: Props) => {
  const [step, setStep] = useState<'email' | 'code' | 'done'>('email');
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setStep('email');
    setCode('');
    setPassword('');
    setConfirm('');
    setError('');
    setBusy(false);
  };

  const close = () => { reset(); onClose(); };

  const post = async (body: Record<string, unknown>) => {
    const response = await fetch('/api/password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { ok: response.ok, payload: await response.json().catch(() => ({})) };
  };

  const requestCode = async () => {
    if (!email.trim()) return setError('Enter your email address.');
    setBusy(true);
    setError('');
    const { ok, payload } = await post({ action: 'request', email: email.trim() });
    setBusy(false);
    if (!ok || !payload?.ok) return setError(message(payload?.error));
    setStep('code');
  };

  const submitNewPassword = async () => {
    if (code.trim().length !== 6) return setError('Enter the 6-digit code from the email.');
    if (password !== confirm) return setError('Passwords do not match.');
    const validation = validatePassword(password);
    if (!validation.isValid) return setError(validation.error || 'Password does not meet requirements.');

    setBusy(true);
    setError('');
    const { ok, payload } = await post({
      action: 'verify',
      email: email.trim(),
      code: code.trim(),
      newPassword: password,
    });
    setBusy(false);
    if (!ok || !payload?.ok) return setError(message(payload?.error));
    setStep('done');
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step === 'done'
              ? <CheckCircle2 className="h-5 w-5 text-green-600" />
              : step === 'code'
                ? <KeyRound className="h-5 w-5 text-blue-600" />
                : <Mail className="h-5 w-5 text-blue-600" />}
            {step === 'done' ? 'Password changed' : 'Reset your password'}
          </DialogTitle>
          <DialogDescription>
            {step === 'email' && 'We will email a 6-digit code to the address on your account.'}
            {step === 'code' && `If ${email} has an account, a code is on its way. It expires in 10 minutes.`}
            {step === 'done' && 'You can now sign in with your new password.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'email' && (
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="fp-email">Email</Label>
              <Input
                id="fp-email" type="email" autoFocus
                placeholder="you@hospital.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && requestCode()}
              />
            </div>
          </div>
        )}

        {step === 'code' && (
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="fp-code">6-digit code</Label>
              <Input
                id="fp-code" autoFocus inputMode="numeric" maxLength={6}
                placeholder="000000"
                className="text-center text-2xl tracking-[0.5em] font-mono"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fp-password">New password</Label>
              <Input
                id="fp-password" type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fp-confirm">Confirm new password</Label>
              <Input
                id="fp-confirm" type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitNewPassword()}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              At least 8 characters, with an uppercase letter, a lowercase letter,
              a number and a special character.
            </p>
          </div>
        )}

        {error && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</p>}

        <DialogFooter>
          {step === 'email' && (
            <>
              <Button variant="outline" onClick={close} disabled={busy}>Cancel</Button>
              <Button onClick={requestCode} disabled={busy}>
                {busy ? 'Sending...' : 'Send code'}
              </Button>
            </>
          )}
          {step === 'code' && (
            <>
              <Button variant="outline" onClick={() => { setStep('email'); setError(''); }} disabled={busy}>
                Back
              </Button>
              <Button onClick={submitNewPassword} disabled={busy}>
                {busy ? 'Saving...' : 'Set password'}
              </Button>
            </>
          )}
          {step === 'done' && <Button onClick={close}>Sign in</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ForgotPasswordDialog;
