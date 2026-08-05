import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/contexts/AuthContext';
import { HOSPITAL_CONFIGS, HospitalType } from '@/types/hospital';
import { Eye, EyeOff } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface LoginFormData {
  email: string;
  password: string;
}

interface LoginPageProps {
  hospitalType?: HospitalType | null;
}

// Staff quick-login: blank email + @XXXX password
const isStaffPinLogin = (email: string, password: string) =>
  !email.trim() && password.startsWith('@') && password.length === 5;

const LoginPage: React.FC<LoginPageProps> = ({ hospitalType }) => {
  const [formData, setFormData] = useState<LoginFormData>({
    email: '',
    password: ''
  });
  const [selectedHospitalType, setSelectedHospitalType] = useState<HospitalType>(() => {
    const saved = localStorage.getItem('hmis_selected_hospital');
    if (saved === 'hope' || saved === 'ayushman') return saved;
    return hospitalType ?? 'hope';
  });
  
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const { login, loginWithGoogle } = useAuth();
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  React.useEffect(() => {
    if (hospitalType) {
      setSelectedHospitalType(hospitalType);
      localStorage.setItem('hmis_selected_hospital', hospitalType);
    }
  }, [hospitalType]);

  const handleInputChange = (field: keyof LoginFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setError(null);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Allow staff pin login (blank email + @XXXX)
    if (!isStaffPinLogin(formData.email, formData.password)) {
      if (!formData.email || !formData.password) {
        setError('Please enter both email and password');
        return;
      }
    }

    setIsLoading(true);
    setError(null);

    try {
      const success = await login({
        email: formData.email,
        password: formData.password,
        hospitalType: selectedHospitalType
      });

      if (!success) {
        setError('Invalid email or password');
      }
    } catch (err) {
      setError('Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Welcome Back</CardTitle>
          <CardDescription>
            Sign in to access hospital management system
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
              <Label htmlFor="hospital">Hospital</Label>
              <Select
                value={selectedHospitalType}
                onValueChange={(value) => {
                  setSelectedHospitalType(value as HospitalType);
                  localStorage.setItem('hmis_selected_hospital', value);
                  setError(null);
                }}
              >
                <SelectTrigger id="hospital">
                  <SelectValue placeholder="Select hospital" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.values(HOSPITAL_CONFIGS) as Array<(typeof HOSPITAL_CONFIGS)[HospitalType]>).map((hospital) => (
                    <SelectItem key={hospital.id} value={hospital.id}>
                      {hospital.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => handleInputChange('email', e.target.value)}
                placeholder="Enter your email (staff: leave blank)"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => handleInputChange('password', e.target.value)}
                  placeholder="Enter your password"
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
          </form>

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
    </div>
  );
};

export default LoginPage;
