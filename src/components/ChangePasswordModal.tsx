import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { validatePassword } from '@/utils/auth';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Eye, EyeOff, Lock } from 'lucide-react';

const ChangePasswordModal = () => {
  const { user, mustChangePassword, setMustChangePassword } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!mustChangePassword || !user) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!newPassword || !confirmPassword) {
      setError('Please fill in both fields');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    const validation = validatePassword(newPassword);
    if (!validation.isValid) {
      setError(validation.error || 'Password does not meet requirements');
      return;
    }

    setSaving(true);
    try {
      // Hashed and written server-side. This used to be an anon-key UPDATE
      // filtered on a browser-supplied id, which could set anyone's password.
      const response = await fetch('/api/auth-session', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.ok) {
        setError(
          payload?.error === 'not_authenticated'
            ? 'Your session has expired. Please log in again.'
            : 'Failed to update password. Please try again.',
        );
        console.error('Password update error:', payload?.error);
        return;
      }

      toast.success('Password changed successfully');
      setMustChangePassword(false);
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError('An unexpected error occurred');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-8">
        <div className="flex flex-col items-center mb-6">
          <div className="bg-red-100 p-3 rounded-full mb-3">
            <Lock className="h-8 w-8 text-red-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900">Password Expired</h2>
          <p className="text-sm text-gray-500 mt-1 text-center">
            Your password has expired. Please set a new password to continue.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="new-password">New Password</Label>
            <div className="relative mt-1">
              <Input
                id="new-password"
                type={showPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                autoFocus
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div>
            <Label htmlFor="confirm-password">Confirm Password</Label>
            <Input
              id="confirm-password"
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              className="mt-1"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</p>
          )}

          <p className="text-xs text-gray-400">
            Password must be at least 8 characters with uppercase, lowercase, number, and special character.
          </p>

          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? 'Updating...' : 'Set New Password'}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default ChangePasswordModal;
