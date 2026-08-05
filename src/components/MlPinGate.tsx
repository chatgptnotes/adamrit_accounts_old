import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { isMlUnlocked, subscribeMlLock, unlockMl } from '@/lib/ml-lock';

/**
 * Past bills sit behind the office PIN (the same one that unlocks the
 * M.L. Enterprises books). The pages themselves never checked the lock —
 * this wrapper is the missing wiring: nothing renders until the PIN is
 * entered, and closing the tab locks it again.
 */
export function MlPinGate({ children, title = 'Past bills are locked' }: { children: ReactNode; title?: string }) {
  const unlocked = useSyncExternalStore(subscribeMlLock, isMlUnlocked);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  if (unlocked) return <>{children}</>;

  const submit = () => {
    if (unlockMl(pin)) {
      setError(false);
    } else {
      setError(true);
      setPin('');
    }
  };

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-xs space-y-4 rounded-xl border p-6 text-center shadow-sm">
        <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">Enter the PIN to view them.</p>
        </div>
        <Input
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => {
            setPin(e.target.value);
            setError(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          className="text-center text-lg tracking-widest"
          placeholder="••••"
          aria-label="PIN"
        />
        {error && <p className="text-sm text-destructive">Wrong PIN.</p>}
        <Button className="w-full" onClick={submit} disabled={!pin.trim()}>
          Unlock
        </Button>
      </div>
    </div>
  );
}

export default MlPinGate;
