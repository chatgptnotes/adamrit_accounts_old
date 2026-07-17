import { useNavigate } from "react-router-dom";
import { Receipt, ScanLine } from "lucide-react";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletCard } from "@/tablet/ui/TabletCard";

const CHILD_MODULES = [
  {
    id: "implant-bill",
    label: "Implant Bill",
    description: "Open the existing implant vendor invoice flow.",
    icon: Receipt,
    tint: "from-rose-400 to-red-600",
  },
  {
    id: "implant-sticker",
    label: "Implant Sticker",
    description: "Open the existing implant pouch cover sheet flow.",
    icon: ScanLine,
    tint: "from-cyan-400 to-blue-600",
  },
] as const;

export default function ImplantServeshFlow() {
  const navigate = useNavigate();

  return (
    <FlowScaffold
      heading="Implant Servesh"
      subheading="Choose the implant tool you want to open."
    >
      <div className="grid gap-3">
        {CHILD_MODULES.map((module) => {
          const Icon = module.icon;

          return (
            <button
              key={module.id}
              type="button"
              onClick={() => navigate(`/${module.id}`, { viewTransition: true })}
              className="w-full text-left"
            >
              <TabletCard className="flex items-center gap-4 transition hover:border-primary/60 hover:bg-primary/5">
                <div className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${module.tint} shadow-lg`}>
                  <Icon className="h-6 w-6 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-semibold text-foreground">{module.label}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{module.description}</p>
                </div>
              </TabletCard>
            </button>
          );
        })}
      </div>
    </FlowScaffold>
  );
}
