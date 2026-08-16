import { NavLink } from "react-router-dom";
import { Home } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { BOTTOM_NAV_IDS, modulesForUser } from "@/tablet/config/modules";
import { useCashHandoverAccess } from "@/tablet/hooks/useCashHandoverAccess";
import { haptics } from "@/tablet/lib/haptics";

/** Short labels so the fixed bottom bar stays single-line on phones. */
const SHORT_LABEL: Record<string, string> = {
  register: "Register",
  billing: "Billing",
  "doctor-notes": "Notes",
  "medication-round": "Meds",
};

function navClass({ isActive }: { isActive: boolean }) {
  return cn(
    "flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[0.65rem] font-medium leading-none transition-colors active:scale-95",
    isActive ? "text-primary" : "text-muted-foreground",
  );
}

/**
 * Native-style bottom tab bar for the tablet edition. Home plus the primary
 * modules the current user can access. Rendered by TabletShell as a fixed,
 * safe-area-aware footer; `viewTransition` animates the route swap.
 */
export function TabletBottomNav() {
  const { user } = useAuth();
  const { allowed: handlesCash } = useCashHandoverAccess();
  const visible = modulesForUser(user ?? undefined, undefined, handlesCash);
  const tabs = BOTTOM_NAV_IDS.map((id) =>
    visible.find((m) => m.id === id),
  ).filter((m): m is NonNullable<typeof m> => Boolean(m));

  return (
    <nav className="tablet-safe-bottom tablet-elevate z-10 flex-shrink-0 border-t border-border bg-card/95 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-7xl items-stretch">
        <NavLink
          to="/"
          end
          viewTransition
          onClick={() => haptics.tap()}
          className={navClass}
          aria-label="Home"
        >
          <Home className="h-6 w-6" />
          <span>Home</span>
        </NavLink>

        {tabs.map((m) => {
          const Icon = m.icon;
          return (
            <NavLink
              key={m.id}
              to={`/${m.id}`}
              viewTransition
              onClick={() => haptics.tap()}
              className={navClass}
              aria-label={m.label}
            >
              <Icon className="h-6 w-6" />
              <span className="max-w-[5.5rem] truncate">
                {SHORT_LABEL[m.id] ?? m.label}
              </span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
