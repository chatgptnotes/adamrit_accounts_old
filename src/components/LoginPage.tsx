import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { HospitalType } from '@/types/hospital';
import ForgotPasswordDialog from '@/components/ForgotPasswordDialog';
import { Eye, EyeOff } from 'lucide-react';

interface LoginPageProps {
  hospitalType?: HospitalType | null;
}

const LoginPage: React.FC<LoginPageProps> = ({ hospitalType }) => {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [selectedHospitalType, setSelectedHospitalType] = useState<HospitalType>(() => {
    const saved = localStorage.getItem('hmis_selected_hospital');
    if (saved === 'hope' || saved === 'ayushman') return saved;
    return hospitalType ?? 'hope';
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [deactivated, setDeactivated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  const { login } = useAuth();

  React.useEffect(() => {
    if (hospitalType) {
      setSelectedHospitalType(hospitalType);
      localStorage.setItem('hmis_selected_hospital', hospitalType);
    }
  }, [hospitalType]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!userId.trim() || !password) {
      setError('Please enter both user ID and password');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await login({
        email: userId.trim(),
        password,
        hospitalType: selectedHospitalType,
      });

      if (!result.ok) {
        // A switched-off shared login is not a wrong password, and saying so
        // would send counter staff hunting for a password that works fine.
        if (result.reason === 'account_deactivated') {
          setDeactivated(true);
        } else {
          setError('Invalid user ID or password');
        }
      }
    } catch {
      setError('Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Shared counter logins are being retired. Whoever tries one needs to
          know it is not a broken password, and that their own account exists. */}
      <Dialog open={deactivated} onOpenChange={setDeactivated}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Please sign in with your own user ID</DialogTitle>
            <DialogDescription className="space-y-2 pt-2 text-left">
              <span className="block">
                This shared login has been switched off. Your password is fine —
                the account is simply no longer in use.
              </span>
              <span className="block">
                Sign in with your own user ID instead, the one in your own name.
                It matters for cash: money you take is recorded against whoever
                is signed in, so a shared login records it against nobody and
                you cannot hand it over at the end of your shift.
              </span>
              <span className="block text-muted-foreground">
                If you do not know your user ID, ask the director or the
                accounts desk.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() => {
                setDeactivated(false);
                setUserId('');
                setPassword('');
              }}
            >
              Sign in as myself
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Welcome Back</CardTitle>
          <CardDescription>
            Sign in with your user ID and password
          </CardDescription>
        </CardHeader>
        
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            {error && (
              <Alert className="border-red-200 bg-red-50">
                <AlertDescription className="text-red-700">{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="userId">User ID</Label>
              <Input
                id="userId"
                type="text"
                value={userId}
                onChange={(e) => {
                  setUserId(e.target.value);
                  setError(null);
                }}
                placeholder="Enter your user ID"
                autoComplete="username"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={isLoading}
            >
              {isLoading ? 'Signing In...' : 'Sign In'}
            </Button>

            <button
              type="button"
              onClick={() => setShowForgotPassword(true)}
              className="w-full text-center text-sm text-blue-600 hover:text-blue-800 hover:underline"
            >
              Forgot password?
            </button>
          </form>
        </CardContent>
      </Card>

      <ForgotPasswordDialog
        open={showForgotPassword}
        onClose={() => setShowForgotPassword(false)}
        initialEmail={userId.includes('@') ? userId : ''}
      />
    </div>
    </>
  );
};

export default LoginPage;
