import React, { useEffect, useState } from 'react';
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
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [deactivated, setDeactivated] = useState(false);

  // A session ended mid-shift because the account was switched off. Say so
  // here, or the person just finds themselves at a login screen for no reason.
  useEffect(() => {
    if (localStorage.getItem('hmis_deactivated')) {
      setDeactivated(true);
      localStorage.removeItem('hmis_deactivated');
    }
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  const { login, loginWithGoogle } = useAuth();

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

          {/* Restored: this block was dropped by mistake in "Simplify user ID
              login", which was only meant to change the email field to a user
              ID. The whole Google path behind it stayed wired up the entire
              time -- there was simply nothing left on screen to press. */}
          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-gray-500">Or continue with</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full flex items-center gap-2"
            disabled={isGoogleLoading}
            onClick={async () => {
              setIsGoogleLoading(true);
              setError(null);
              try {
                await loginWithGoogle();
              } catch {
                // Google never took over the page, so the button has to come
                // back rather than sit on "Redirecting..." for ever.
                setError('Google sign-in failed. Please try again.');
                setIsGoogleLoading(false);
              }
            }}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            {isGoogleLoading ? 'Redirecting...' : 'Sign in with Google'}
          </Button>
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
