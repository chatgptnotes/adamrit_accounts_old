
import React, { Suspense, useEffect, useRef, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, useNavigate, useLocation } from "react-router-dom";
import { SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { AppRoutes } from "@/components/AppRoutes";
import { useCounts } from "@/hooks/useCounts";
import { usePendingPrescriptionCount } from "@/hooks/usePendingPrescriptions";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import LoginPage from "@/components/LoginPage";
import LandingPage from "@/components/LandingPage";
import HospitalSelection from "@/components/HospitalSelection";
import { FloatingCameraFAB } from "@/components/CameraUpload";
import ChatWidget from '@/components/ChatWidget';
import { ReloadPrompt } from "@/pwa/ReloadPrompt";
import { useToast } from "@/hooks/use-toast";
import { toast } from "sonner";
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

// Routes that suppress the global FAB pair (exact path match).
const ROUTES_WITHOUT_FLOATERS = new Set<string>([]);
const isTallyRoute = (pathname: string): boolean =>
  pathname.startsWith('/accounting') || pathname.startsWith('/tally');

const FloatingFabs: React.FC = () => {
  const { pathname } = useLocation();
  // The Tally replica is full-bleed — no floating HMIS widgets over it
  if (ROUTES_WITHOUT_FLOATERS.has(pathname) || isTallyRoute(pathname)) return null;
  return (
    <>
      <FloatingCameraFAB />
      <ChatWidget />
    </>
  );
};

// Slim HMIS header (sidebar trigger + tablet switch) — hidden on the
// Tally replica so the accounting module is full-bleed like Tally Prime.
const AppHeaderRow: React.FC = () => {
  const { pathname } = useLocation();
  if (isTallyRoute(pathname)) return null;
  return (
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
  );
};

// Auto-collapse the main sidebar on accounting/Tally screens for a
// full-width Tally look; restore it when navigating elsewhere. The
// SidebarTrigger still lets the user re-open it manually at any time.
const TALLY_LOOK_ROUTES = ['/accounting', '/tally'];
const AutoCollapseSidebar: React.FC = () => {
  const { setOpen } = useSidebar();
  const location = useLocation();
  const wasTallyLook = useRef(false);

  useEffect(() => {
    const isTallyLook = TALLY_LOOK_ROUTES.some((r) => location.pathname.startsWith(r));
    if (isTallyLook !== wasTallyLook.current) {
      setOpen(!isTallyLook);
      wasTallyLook.current = isTallyLook;
    }
  }, [location.pathname, setOpen]);

  return null;
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
      // Tier 0 — do NOT retry failed reads. At a low DB success rate, a retry
      // just doubles load precisely when the database is collapsing (retry
      // death-spiral). A failed read shows stale/empty and self-heals on the
      // next natural fetch; no data is corrupted. Queries that genuinely need a
      // retry can still set their own `retry` (per-query overrides this default),
      // and mutations are unaffected (React Query defaults mutations to retry 0).
      retry: 0,
      refetchOnWindowFocus: false,
      // Tier 1 — stop background/reconnect refetch storms and keep cache longer
      // so navigation reuses it instead of re-hitting the DB. Interval polling
      // (refetchInterval) pauses on hidden tabs via refetchIntervalInBackground.
      refetchOnReconnect: false,
      refetchIntervalInBackground: false,
      staleTime: 1000 * 60 * 5, // 5 minutes - prevent rapid refetching
      gcTime: 1000 * 60 * 30, // keep cached data 30 min after last use
    },
  },
});

// Auto-recover from stale code chunks after a deploy. When a new build replaces
// the hashed JS/CSS chunk filenames, a tab still running the old index.html
// fails to import a lazily-loaded route and would otherwise land on the error
// boundary ("Something went wrong"). We reload once to pull the fresh
// index.html and its new chunk hashes — guarded so a genuinely missing chunk
// can't loop forever.
const CHUNK_RELOAD_KEY = 'app:chunk-reload-at';
const isChunkLoadError = (error: unknown): boolean => {
  const msg = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
  return (
    msg.includes('failed to fetch dynamically imported module') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('importing a module script failed') ||
    msg.includes('loading chunk') ||
    msg.includes('loading css chunk')
  );
};
// Reload once for a chunk error. Returns true if a reload was triggered, so the
// caller can suppress the error UI while the page is on its way out.
const reloadOnceForChunkError = (error: unknown): boolean => {
  if (!isChunkLoadError(error)) return false;
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
    // If we already reloaded for a chunk error in the last 10s, the chunk is
    // genuinely gone — stop, and let the normal error UI show instead of looping.
    if (Date.now() - last < 10_000) return false;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {
    /* sessionStorage blocked (private mode) — fall through and reload anyway */
  }
  window.location.reload();
  return true;
};

// Vite emits this when a dynamically-imported chunk fails to preload — the most
// common stale-deploy symptom. Recover before it ever reaches the boundary.
window.addEventListener('vite:preloadError', (e) => {
  if (reloadOnceForChunkError((e as unknown as { payload?: unknown }).payload)) {
    e.preventDefault();
  }
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
    // Stale-chunk errors self-heal with a one-time reload; only log the rest.
    if (reloadOnceForChunkError(error)) return;
    console.error('App Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // A chunk error reload is in flight — show a neutral "updating" message
      // rather than the alarming error screen for the split second before the
      // page navigates away.
      if (isChunkLoadError(this.state.error)) {
        return (
          <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div className="text-center p-8 text-gray-600">Updating to the latest version…</div>
          </div>
        );
      }
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center p-8 max-w-2xl w-full">
            <h1 className="text-2xl font-bold text-red-600 mb-4">Something went wrong</h1>
            <p className="text-gray-600 mb-4">The application encountered an error. Please refresh the page.</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Refresh Page
            </button>
            {import.meta.env.DEV && this.state.error && (
              <pre style={{ textAlign: 'left', overflow: 'auto', maxHeight: 300, background: '#fee2e2', padding: 12, fontSize: 12, marginTop: 16, borderRadius: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {this.state.error.message}{'\n\n'}{this.state.error.stack}
              </pre>
            )}
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
  const userRole = user?.role?.toLowerCase().trim() || '';
  const canSeePharmacy = ['superadmin', 'super_admin', 'admin', 'pharmacy', 'pharmacist'].includes(userRole);
  const pendingPrescriptionsCount = usePendingPrescriptionCount(isAuthenticated && canSeePharmacy);
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
        <SidebarProvider defaultOpen={true}>
          <AutoCollapseSidebar />
          {user && <RoleRedirect user={user} />}
          <div className="min-h-screen flex w-full">
            <AppSidebar {...counts} pendingPrescriptionsCount={pendingPrescriptionsCount} />
            <main className="flex-1 flex flex-col h-screen overflow-hidden">
              <AppHeaderRow />
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
const SW_RELOAD_GUARD_KEY = 'app:service-worker-reload-at';
const SW_RELOAD_GUARD_MS = 5 * 60 * 1000;

const App = () => {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let refreshing = false;
    let reloadTimer: number | undefined;

    const onControllerChange = () => {
      if (refreshing) return;

      try {
        const lastReloadAt = Number(localStorage.getItem(SW_RELOAD_GUARD_KEY) || 0);
        if (Date.now() - lastReloadAt < SW_RELOAD_GUARD_MS) return;
        localStorage.setItem(SW_RELOAD_GUARD_KEY, String(Date.now()));
      } catch {
        // If storage is unavailable, keep the in-memory guard for this page.
      }

      refreshing = true;
      toast.success('Updating to latest version shortly…');
      // Random 3-60s delay so a deploy doesn't reload every open device in the
      // same second (each boot re-fires the sidebar counts etc. — a
      // synchronized stampede on the tiny DB).
      const jitterMs = 3000 + Math.random() * 57000;
      reloadTimer = window.setTimeout(() => window.location.reload(), jitterMs);
    };

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      if (reloadTimer !== undefined) window.clearTimeout(reloadTimer);
    };
  }, []);

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
