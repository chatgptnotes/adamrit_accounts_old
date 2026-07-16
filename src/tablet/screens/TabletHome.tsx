import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { modulesForUser } from "@/tablet/config/modules";
import { TabletWatermark } from "@/tablet/components/TabletWatermark";

/** Home dashboard — gradient-iconed module tiles, role-filtered. */
export function TabletHome() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const modules = modulesForUser(user ?? undefined);

  return (
    <div className="relative isolate h-full">
      <TabletWatermark />
      <div className="tablet-no-scrollbar h-full overflow-y-auto p-4 sm:p-6 lg:p-8">
        {/* Centring guard rail — caps width so the dashboard never
            over-stretches on large desktop / 4K monitors. */}
        <div className="mx-auto w-full max-w-[1800px]">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
            {modules.map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => navigate(`/${m.id}`, { viewTransition: true })}
                  className="tablet-tile tablet-glass flex min-h-[148px] flex-col gap-2 rounded-2xl p-4 text-left sm:min-h-[156px] sm:p-5"
                >
                  <span
                    className={cn(
                      "inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br shadow-lg sm:h-12 sm:w-12",
                      m.tint,
                    )}
                  >
                    <Icon className="h-5 w-5 text-white sm:h-6 sm:w-6" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[1.05rem] font-semibold leading-tight text-foreground">
                      {m.label}
                    </span>
                    <span className="mt-1 line-clamp-2 min-h-[2.25rem] text-[0.92rem] leading-snug text-muted-foreground">
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
