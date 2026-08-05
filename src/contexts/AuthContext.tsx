import { createContext, useContext, useState, useEffect, useMemo, useCallback, ReactNode } from 'react';
import { createClient } from '@supabase/supabase-js';
import { HospitalType, getHospitalConfig } from '@/types/hospital';
import { supabase } from '@/integrations/supabase/client';
import { hashPassword, validateEmail, sanitizeInput, signupRateLimiter } from '@/utils/auth';
import { logActivity } from '@/lib/activity-logger';

// Separate anon client for User table lookups — not affected by OAuth session RLS
const supabaseAnon = createClient(
  'https://xvkxccqaopbnkvwgyfjv.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh2a3hjY3Fhb3Bibmt2d2d5Zmp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc4MjMwMTIsImV4cCI6MjA2MzM5OTAxMn0.z9UkKHDm4RPMs_2IIzEPEYzd3-sbQSF6XpxaQg3vZhU',
  { auth: { persistSession: false, autoRefreshToken: false } }
);

interface User {
  id?: string;
  employeeId?: string | null;
  email: string;
  username: string;
  role: 'superadmin' | 'super_admin' | 'admin' | 'doctor' | 'nurse' | 'user' | 'marketing_manager' | 'receptionist' | 'lab_technician' | 'pharmacy' | 'pharmacist' | 'radiology' | 'radiology_tech' | 'ot_tech' | 'cath_lab_tech' | 'billing' | 'housekeeping' | 'security' | 'driver' | 'physiotherapist' | 'lab' | 'reception' | 'maintenance' | 'hr' | 'quality' | 'consultant' | 'front_office';
  hospitalType: HospitalType;
}

interface AuthContextType {
  user: User | null;
  login: (credentials: { email: string; password: string; hospitalType?: HospitalType }) => Promise<boolean>;
  loginWithGoogle: () => Promise<void>;
  signup: (userData: { email: string; password: string; role: string; hospitalType: HospitalType }) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
  isAuthLoading: boolean;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  hospitalType: HospitalType | null;
  hospitalConfig: ReturnType<typeof getHospitalConfig>;
  showLanding: boolean;
  setShowLanding: (show: boolean) => void;
  showHospitalSelection: boolean;
  setShowHospitalSelection: (show: boolean) => void;
  authError: string | null;
  switchHospital: (hospitalType: HospitalType) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(true);
  const [showLanding, setShowLanding] = useState<boolean>(true);
  const [showHospitalSelection, setShowHospitalSelection] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Handle Google OAuth session - look up email in User table using RPC to bypass RLS
  const handleGoogleSession = async (email: string) => {
    const googleEmail = email.toLowerCase();

    // Use SECURITY DEFINER RPC function to bypass RLS
    const { data: rows, error } = await supabaseAnon
      .rpc('lookup_user_by_email', { lookup_email: googleEmail });

    const data = rows?.[0] || null;

    if (error || !data) {
      console.error('[OAuth] Google user not found in User table:', googleEmail, error);
      setAuthError(`No account found for ${googleEmail}. Please contact admin to create your account first.`);
      // Sign out the Supabase OAuth session since user doesn't exist in our app
      supabase.auth.signOut().catch(() => {});
      setIsAuthLoading(false);
      return;
    }


    const appUser: User = {
      id: data.id,
      email: data.email,
      username: data.email.split('@')[0],
      role: data.role,
      hospitalType: data.hospital_type || 'hope',
      employeeId: data.employee_id || null,
    };

    const { data: googleSession } = await supabase.auth.getSession();
    const sessionResponse = await fetch('/api/auth-session', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'google', accessToken: googleSession.session?.access_token || '' }),
    });
    if (!sessionResponse.ok) {
      setAuthError('Could not establish a secure application session. Please try again.');
      await supabase.auth.signOut();
      setIsAuthLoading(false);
      return;
    }

    setUser(appUser);
    localStorage.setItem('hmis_user', JSON.stringify(appUser));
    localStorage.setItem('hmis_visited', 'true');
    setShowLanding(false);
    setShowHospitalSelection(false);
    setAuthError(null);
    setIsAuthLoading(false);

    // Clean up the URL after processing OAuth callback (hash tokens or PKCE code)
    if (window.location.hash.includes('access_token') || new URLSearchParams(window.location.search).has('code')) {
      window.history.replaceState(null, '', window.location.pathname);
    }

    (supabase as any).from('User').update({ last_login_at: new Date().toISOString() }).eq('id', data.id).then(() => {});
    logActivity('user_login', { email: appUser.email, role: appUser.role, hospital: appUser.hospitalType, method: 'google' });
  };

  // Single unified initialization effect
  useEffect(() => {
    // Step 1: Restore saved session from localStorage
    const savedUser = localStorage.getItem('hmis_user');
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        // Backward compatibility: add hospitalType if missing
        if (!parsed.hospitalType) {
          if (parsed.username === 'ayushman') {
            parsed.hospitalType = 'ayushman';
            parsed.hospitalName = 'ayushman';
          } else {
            parsed.hospitalType = 'hope';
            parsed.hospitalName = 'hope';
          }
        }
        if (!parsed.role) {
          parsed.role = parsed.username === 'admin' ? 'admin' : 'user';
        }
        setUser(parsed);
      } catch {
        localStorage.removeItem('hmis_user');
      }
    }

    // Step 2: Handle landing page visibility
    const hasVisited = localStorage.getItem('hmis_visited');
    if (hasVisited) setShowLanding(false);

    // Step 3: If we already have a saved user, stop loading immediately
    if (savedUser) {
      setIsAuthLoading(false);
      return;
    }

    // Detect if this is an OAuth callback (URL has ?code= or #access_token=)
    const isOAuthCallback = new URLSearchParams(window.location.search).has('code') ||
      window.location.hash.includes('access_token');

    // Step 4: No saved user and NOT an OAuth callback — stop loading quickly
    if (!isOAuthCallback) {
      // Check for existing Supabase session (e.g., user refreshed the page while still logged in via Google)
      supabase.auth.getSession().then(async ({ data: { session } }) => {
        if (session?.user?.email) {
          await handleGoogleSession(session.user.email);
        } else {
          setIsAuthLoading(false);
        }
      });
      return;
    }

    // Step 5: OAuth callback — wait for PKCE code exchange to complete
    let resolved = false;

    const processOAuthSession = async (email: string) => {
      if (resolved) return;
      resolved = true;
      await handleGoogleSession(email);
    };

    const finishLoading = () => {
      if (!resolved) {
        resolved = true;
        console.error('[OAuth] Session exchange timed out — no session obtained');
        setAuthError('Google sign-in timed out. Please try again.');
        // Clean up URL
        window.history.replaceState(null, '', window.location.pathname);
        setIsAuthLoading(false);
      }
    };

    // Register auth state change listener — this fires when PKCE exchange completes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user?.email && !resolved) {
        await processOAuthSession(session.user.email);
      }
    });

    // Also check if session is already available (exchange might have completed during init)
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user?.email && !resolved) {
        await processOAuthSession(session.user.email);
      }
    });

    // Safety timeout — give PKCE exchange up to 8 seconds
    const safetyTimeout = setTimeout(finishLoading, 8000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(safetyTimeout);
    };
  }, []);

  // Database authentication
  const login = async (credentials: { email: string; password: string; hospitalType?: HospitalType }): Promise<boolean> => {
    try {
      const response = await fetch('/api/auth-session', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.ok || !body.user) return false;

      const appUser: User = body.user;
      setUser(appUser);
      localStorage.setItem('hmis_user', JSON.stringify(appUser));
      (supabase as any).from('User').update({ last_login_at: new Date().toISOString() }).eq('id', appUser.id).then(() => {});
      logActivity('user_login', { email: appUser.email, role: appUser.role, hospital: appUser.hospitalType });
      return true;
    } catch (error) {
      console.error('Login failed:', error);
      return false;
    }
  };

  // Google OAuth login
  const loginWithGoogle = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    });
    if (error) {
      console.error('Google login error:', error);
    }
  }, []);

  // Signup functionality
  const signup = async (userData: { email: string; password: string; role: string; hospitalType: HospitalType }): Promise<{ success: boolean; error?: string }> => {
    try {
      // Rate limiting check
      const clientIP = 'default'; // In production, get actual client IP
      if (!signupRateLimiter.isAllowed(clientIP)) {
        const remainingTime = Math.ceil(signupRateLimiter.getRemainingTime(clientIP) / 1000 / 60);
        return { success: false, error: `Too many signup attempts. Please try again in ${remainingTime} minutes.` };
      }

      // Validate email
      const emailValidation = validateEmail(userData.email);
      if (!emailValidation.isValid) {
        return { success: false, error: emailValidation.error };
      }

      // Sanitize inputs
      const sanitizedEmail = sanitizeInput(userData.email.toLowerCase());
      const sanitizedRole = sanitizeInput(userData.role);

      // Check if user already exists
      const { data: existingUser } = await supabase
        .from('User')
        .select('id')
        .eq('email', sanitizedEmail)
        .single();

      if (existingUser) {
        return { success: false, error: 'Email already exists. Please use a different email.' };
      }

      // Hash password
      const hashedPassword = await hashPassword(userData.password);

      // Insert new user
      const { error } = await supabase
        .from('User')
        .insert([
          {
            email: sanitizedEmail,
            password: hashedPassword,
            role: sanitizedRole,
            hospital_type: userData.hospitalType
          }
        ]);

      if (error) {
        console.error('Signup error:', error);
        if (error.code === '23505') { // Unique constraint violation
          return { success: false, error: 'Email already exists. Please use a different email.' };
        }
        return { success: false, error: error.message || 'Failed to create account' };
      }

      return { success: true };
    } catch (error) {
      console.error('Signup failed:', error);
      return { success: false, error: 'An unexpected error occurred. Please try again.' };
    }
  };

  const logout = useCallback(async () => {
    setUser(null);
    localStorage.removeItem('hmis_user');
    setShowHospitalSelection(false);
    // Also sign out of Supabase Auth (for Google OAuth sessions)
    // Must be awaited — otherwise the session may still be active on next page load,
    // causing the user to be silently re-authenticated via getSession() in the init effect.
    try {
      await fetch('/api/auth-session', { method: 'DELETE', credentials: 'include' });
      await supabase.auth.signOut();
    } catch {
      // Ignore signOut errors — local state is already cleared
    }
  }, []);

  const switchHospital = useCallback((newHospitalType: HospitalType) => {
    if (!user) return;
    const updatedUser = { ...user, hospitalType: newHospitalType };
    setUser(updatedUser);
    localStorage.setItem('hmis_user', JSON.stringify(updatedUser));
    // Force a full reload so every cached React Query (visits, patients,
    // modals, etc.) re-fetches under the new hospital context. Without this,
    // queries whose key omits hospitalConfig.name keep serving stale data
    // from the previous hospital.
    window.location.reload();
  }, [user]);

  const hospitalConfig = useMemo(() => getHospitalConfig(user?.hospitalType), [user?.hospitalType]);

  const value: AuthContextType = useMemo(() => ({
    user,
    login,
    loginWithGoogle,
    signup,
    logout,
    isAuthenticated: !!user,
    isAuthLoading,
    isSuperAdmin: user?.role === 'superadmin' || user?.role === 'super_admin',
    isAdmin: user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'super_admin',
    hospitalType: user?.hospitalType || null,
    hospitalConfig,
    showLanding,
    setShowLanding,
    showHospitalSelection,
    setShowHospitalSelection,
    authError,
    switchHospital
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [user, isAuthLoading, hospitalConfig, showLanding, showHospitalSelection, authError]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
