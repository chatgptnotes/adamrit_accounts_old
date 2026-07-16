import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTileAccess } from "@/hooks/useTileAccess";
import { cn } from "@/lib/utils";
import { modulesForUser } from "@/tablet/config/modules";
import { TabletWatermark } from "@/tablet/components/TabletWatermark";

/** Home dashboard — gradient-iconed module tiles, role-filtered. */
export function TabletHome() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { canSeeTile } = useTileAccess();
  const modules = modulesForUser(user ?? undefined, canSeeTile);

  return (
    <div className="relative isolate h-full">
      <TabletWatermark />
      <div className="tablet-no-scrollbar h-full overflow-y-auto p-4 sm:p-6 lg:p-8">
        {/* Centring guard rail — caps width so the dashboard never
            over-stretches on large desktop / 4K monitors. */}
        <div className="mx-auto w-full max-w-7xl">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
            {modules.map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => navigate(`/${m.id}`, { viewTransition: true })}
                  className="tablet-tile tablet-glass flex flex-col gap-3 rounded-2xl p-4 text-left sm:p-5"
                >
                  <span
                    className={cn(
                      "inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br shadow-lg",
                      m.tint,
                    )}
                  >
                    <Icon className="h-6 w-6 text-white" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold leading-tight text-foreground">
                      {m.label}
                    </span>
                    <span className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm leading-snug text-muted-foreground">
                      {m.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
