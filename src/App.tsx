
import React, { Suspense, useEffect, useRef, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, useNavigate, useLocation } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { AppRoutes } from "@/components/AppRoutes";
import { useCounts } from "@/hooks/useCounts";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import LoginPage from "@/components/LoginPage";
import LandingPage from "@/components/LandingPage";
import HospitalSelection from "@/components/HospitalSelection";
import { FloatingCameraFAB } from "@/components/CameraUpload";
import ChatWidget from '@/components/ChatWidget';
import { ReloadPrompt } from "@/pwa/ReloadPrompt";
import { useToast } from "@/hooks/use-toast";
import { HospitalType, getHospitalConfig } from "@/types/hospital";
import { Tablet } from "lucide-react";
import { shouldUseTabletEdition, setOverride } from "@/lib/device-class";

// Touch (tablet) edition — rendered on the same URL for tablet/phone devices.
const TabletApp = lazy(() => import("@/tablet/TabletApp"));

// Role-based default landing routes
const DIRECTOR_EMAILS = ['cmd@hopehospital.com', 'finance@hopehospital.com'];

const getRoleDefaultRoute = (role: string, email?: string): string => {
  if (
    (email && DIRECTOR_EMAILS.includes(email.toLowerCase())) ||
    role === 'superadmin' ||
    role === 'super_admin'
  ) {
    return '/director-dashboard';
  }
  switch (role) {
    case 'pharmacist':
    case 'pharmacy':
      return '/pharmacy';
    case 'lab_technician':
    case 'lab':
      return '/lab';
    case 'radiology_tech':
    case 'radiology':
      return '/radiology';
    case 'ot_tech':
      return '/todays-ipd';
    case 'cath_lab_tech':
      return '/cath-lab';
    case 'nurse':
      return '/nursing';
    case 'receptionist':
    case 'reception':
      return '/patient-dashboard';
    case 'front_office':
      return '/opd-summary';
    case 'marketing':
    case 'marketing_manager':
      return '/marketing';
    case 'billing':
      return '/bill-submission';
    case 'doctor':
      return '/todays-ipd';
    case 'consultant':
      return '/patient-dashboard';
    case 'physiotherapist':
      return '/patient-dashboard';
    case 'superadmin':
    case 'super_admin':
      return '/bill-approvals';
    case 'admin':
    default:
      return '/dashboard';
  }
};

// Hide the global FAB pair on Skill Factory (which mounts its own AI sidebar in
// the same screen area). Exact match so /skill-factory/legacy still shows them.
const ROUTES_WITHOUT_FLOATERS = new Set(['/skill-factory', '/skill-factory/v2']);
const FloatingFabs: React.FC = () => {
  const { pathname } = useLocation();
  if (ROUTES_WITHOUT_FLOATERS.has(pathname)) return null;
  return (
    <>
      <FloatingCameraFAB />
      <ChatWidget />
    </>
  );
};

// Role-based redirect component — lives inside BrowserRouter so it can use useNavigate
// This replaces window.location.href which caused infinite reload loops on mobile
const RoleRedirect: React.FC<{ user: { role: string; email: string } }> = ({ user }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const hasRedirected = useRef(false);

  useEffect(() => {
    if (hasRedirected.current) return;
    const genericRoutes = ['/', '/dashboard', '/login'];
    if (genericRoutes.includes(location.pathname)) {
      const targetRoute = getRoleDefaultRoute(user.role, user.email);
      if (location.pathname !== targetRoute) {
        hasRedirected.current = true;
        navigate(targetRoute, { replace: true });
      }
    }
  }, [location.pathname, user.role, navigate]);

  return null;
};

// Suppress React Router v7 warnings
if (typeof window !== 'undefined') {
  (window as any).__REACT_ROUTER_FUTURE_FLAGS__ = {
    v7_startTransition: true,
    v7_relativeSplatPath: true
  };
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5, // 5 minutes - prevent rapid refetching
    },
  },
});

// Error Boundary Component
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('App Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center p-8">
            <h1 className="text-2xl font-bold text-red-600 mb-4">Something went wrong</h1>
            <p className="text-gray-600 mb-4">The application encountered an error. Please refresh the page.</p>
            <button 
              onClick={() => window.location.reload()} 
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const AppContent = () => {
  const {
    isAuthenticated,
    user,
    isAuthLoading,
    login,
    showLanding,
    setShowLanding,
    showHospitalSelection,
    setShowHospitalSelection,
    hospitalConfig,
    authError
  } = useAuth();
  const { toast } = useToast();
  // Always call hooks at the top level; avoid wrapping hooks in try/catch.
  // Gate the sidebar count queries on auth — otherwise their ~17 exact-count
  // requests fire on the login/landing page and starve the login `User` lookup.
  const counts = useCounts(isAuthenticated);
  const [selectedHospitalType, setSelectedHospitalType] = React.useState<HospitalType | null>(null);
  // Role-based redirect is handled by RoleRedirect component inside BrowserRouter (no page reloads)

  // Show loading while auth state is being restored from localStorage
  if (isAuthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  const handleGetStarted = () => {
    localStorage.setItem('hmis_visited', 'true');
    setShowLanding(false);
    setShowHospitalSelection(true);
  };

  const handleLoginClick = () => {
    setShowLanding(false);
    setShowHospitalSelection(true);
  };

  const handleBackToHome = () => {
    setShowLanding(true);
    setShowHospitalSelection(false);
    setSelectedHospitalType(null);
  };

  const handleHospitalSelect = (hospitalType: HospitalType) => {
    setSelectedHospitalType(hospitalType);
    setShowHospitalSelection(false);
  };

  const handleBackToHospitalSelection = () => {
    setShowHospitalSelection(true);
    setSelectedHospitalType(null);
  };

  // Check if current path is an auth route that should bypass guards
  const currentPath = window.location.pathname;
  const authRoutes = ['/login', '/signup', '/signup-full'];
  const isAuthRoute = authRoutes.includes(currentPath);

  // Redirect authenticated users away from auth routes (no full page reload)
  if (isAuthenticated && isAuthRoute) {
    window.history.replaceState(null, '', '/');
  }

  // Allow auth routes to render without authentication
  if (!isAuthenticated && isAuthRoute) {
    return (
      <ThemeProvider>
        <BrowserRouter 
          future={{
            v7_startTransition: true,
            v7_relativeSplatPath: true
          }}
        >
          <QueryClientProvider client={queryClient}>
            <TooltipProvider>
              <div className="min-h-screen">
                <AppRoutes />
              </div>
              <Toaster />
              <Sonner />
            </TooltipProvider>
          </QueryClientProvider>
        </BrowserRouter>
      </ThemeProvider>
    );
  }

  // Show landing page for first-time visitors
  if (showLanding && !isAuthenticated) {
    return <LandingPage onGetStarted={handleGetStarted} onLoginClick={handleLoginClick} />;
  }

  // Show hospital selection after landing or login click
  if (showHospitalSelection && !isAuthenticated) {
    return <HospitalSelection onHospitalSelect={handleHospitalSelect} onBackToHome={handleBackToHome} />;
  }

  // Show database login page after hospital selection
  if (!isAuthenticated && selectedHospitalType) {
    return <LoginPage />;
  }

  // Fallback: Show hospital selection if no hospital is selected
  if (!isAuthenticated) {
    return (
      <>
        {authError && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg shadow-lg max-w-md text-sm">
            {authError}
          </div>
        )}
        <HospitalSelection onHospitalSelect={handleHospitalSelect} onBackToHome={handleBackToHome} />
      </>
    );
  }


  // Tablet & phone devices get the touch edition; PC gets the full site.
  // Same URL for all — the device class (or the saved override) decides.
  if (shouldUseTabletEdition()) {
    return (
      <ThemeProvider>
        <BrowserRouter
          future={{
            v7_startTransition: true,
            v7_relativeSplatPath: true,
          }}
        >
          <Suspense
            fallback={
              <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500" />
              </div>
            }
          >
            <TabletApp />
          </Suspense>
        </BrowserRouter>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true
        }}
      >
        <SidebarProvider>
          {user && <RoleRedirect user={user} />}
          <div className="min-h-screen flex w-full">
            <AppSidebar {...counts} />
            <main className="flex-1 flex flex-col h-screen overflow-hidden">
              <div className="p-2 ml-4 flex-shrink-0 flex items-center gap-3">
                <SidebarTrigger />
                <button
                  type="button"
                  onClick={() => { setOverride('tablet'); window.location.assign('/'); }}
                  className="ml-auto mr-2 flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"
                >
                  <Tablet className="h-4 w-4" /> Tablet view
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-auto">
                <AppRoutes />
              </div>
              <FloatingFabs />
            </main>
          </div>
        </SidebarProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
};

const PUBLIC_ROUTES = ['/patient-portal', '/queue-tv'];

const App = () => {
  const isPublicRoute = PUBLIC_ROUTES.includes(window.location.pathname);

  if (isPublicRoute) {
    return (
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <BrowserRouter
              future={{
                v7_startTransition: true,
                v7_relativeSplatPath: true
              }}
            >
              <Suspense fallback={
                <div className="min-h-screen flex items-center justify-center">
                  <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500" />
                </div>
              }>
                <AppRoutes />
              </Suspense>
              <Toaster />
              <Sonner />
            </BrowserRouter>
          </TooltipProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthProvider>
            <Suspense fallback={
              <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500 mx-auto mb-4"></div>
                  <p className="text-gray-600">Loading application...</p>
                </div>
              </div>
            }>
              <Toaster />
              <Sonner />
              <ReloadPrompt />
              <AppContent />
            </Suspense>
          </AuthProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export default App;
