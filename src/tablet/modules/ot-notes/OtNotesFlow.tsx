import { useEffect, useState } from "react";
import { Loader2, Printer, Save, Search } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletInput } from "@/tablet/ui/TabletInput";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useImplantOptions, usePreauthCases } from "@/tablet/modules/preauth/usePreauthCases";
import type { PreauthCase } from "@/tablet/modules/preauth/types";
import { useDebounce } from "use-debounce";

function formatDateInput(value: string | null | undefined) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
}

function printNote(note: {
  patientName: string;
  patientId: string;
  visitId: string;
  date: string;
  procedure: string;
  surgeon: string;
  anaesthetist: string;
  anaesthesia: string;
  implant: string;
  description: string;
}) {
  const popup = window.open("", "_blank");
  if (!popup) return;
  popup.document.write(`
    <html>
      <head>
        <title>OT Notes - ${note.patientName}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
          h1 { margin: 0 0 8px; font-size: 24px; }
          .meta { margin-bottom: 20px; color: #4b5563; }
          .block { border: 1px solid #d1d5db; border-radius: 12px; padding: 16px; margin-bottom: 14px; }
          .label { color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
          .value { font-size: 15px; font-weight: 700; margin-top: 4px; }
          pre { white-space: pre-wrap; margin: 0; font-family: inherit; line-height: 1.5; }
        </style>
      </head>
      <body>
        <h1>OT Notes</h1>
        <div class="meta">${note.patientName} · ${note.patientId || "No ID"} · ${note.visitId || "No visit ID"}</div>
        <div class="block"><div class="label">Date</div><div class="value">${note.date}</div></div>
        <div class="block"><div class="label">Procedure</div><div class="value">${note.procedure}</div></div>
        <div class="block"><div class="label">Surgeon</div><div class="value">${note.surgeon || "—"}</div></div>
        <div class="block"><div class="label">Anaesthetist</div><div class="value">${note.anaesthetist || "—"}</div></div>
        <div class="block"><div class="label">Anaesthesia</div><div class="value">${note.anaesthesia || "—"}</div></div>
        <div class="block"><div class="label">Implant</div><div class="value">${note.implant || "—"}</div></div>
        <div class="block"><div class="label">Description</div><pre>${note.description || "—"}</pre></div>
      </body>
    </html>
  `);
  popup.document.close();
  popup.focus();
  popup.print();
  popup.close();
}

export default function OtNotesFlow() {
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch] = useDebounce(searchInput, 300);
  const [selected, setSelected] = useState<PreauthCase | null>(null);
  const [procedure, setProcedure] = useState("");
  const [surgeon, setSurgeon] = useState("");
  const [anaesthetist, setAnaesthetist] = useState("");
  const [anaesthesia, setAnaesthesia] = useState("");
  const [implant, setImplant] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(formatDateInput(null));
  const [packageName, setPackageName] = useState("");

  const cases = usePreauthCases(debouncedSearch);
  const implants = useImplantOptions();

  const existing = useQuery({
    queryKey: ["tablet-ot-notes", selected?.visitUuid],
    enabled: !!selected,
    staleTime: 1000 * 10,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ot_notes")
        .select("id, date, procedure_performed, surgeon, anaesthetist, anaesthesia, implant, description")
        .eq("visit_id", selected!.visitUuid)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  useEffect(() => {
    if (!selected) return;
    setPackageName(selected.packageName || "");
    setProcedure(selected.packageName || "");
    setSurgeon("");
    setAnaesthetist("");
    setAnaesthesia("");
    setImplant("");
    setDescription("");
    setDate(formatDateInput(selected.admissionDate || null));
  }, [selected]);

  useEffect(() => {
    if (!existing.data) return;
    setDate(formatDateInput(existing.data.date));
    setProcedure(existing.data.procedure_performed || selected?.packageName || "");
    setSurgeon(existing.data.surgeon || "");
    setAnaesthetist(existing.data.anaesthetist || "");
    setAnaesthesia(existing.data.anaesthesia || "");
    setImplant(existing.data.implant || "");
    setDescription(existing.data.description || "");
  }, [existing.data, selected?.packageName]);

  const save = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Select a patient first.");
      if (!procedure.trim()) throw new Error("Enter a procedure.");
      if (!surgeon.trim()) throw new Error("Enter surgeon name.");
      if (!date.trim()) throw new Error("Enter surgery date.");

      const { data: visitRecord, error: visitError } = await supabase
        .from("visits")
        .select("id, patient_id, patients(name)")
        .eq("id", selected.visitUuid)
        .single();
      if (visitError) throw visitError;

      const patientName = (visitRecord as any)?.patients?.name || selected.patientName;

      const { error: deleteError } = await supabase
        .from("ot_notes")
        .delete()
        .eq("visit_id", selected.visitUuid);
      if (deleteError) throw deleteError;

      const { error } = await supabase.from("ot_notes").insert({
        visit_id: selected.visitUuid,
        patient_id: selected.patientUuid || null,
        patient_name: patientName,
        date,
        procedure_performed: procedure.trim(),
        surgeon: surgeon.trim(),
        anaesthetist: anaesthetist.trim() || null,
        anaesthesia: anaesthesia.trim() || null,
        implant: implant.trim() || null,
        description: description.trim() || null,
        surgery_name: packageName.trim() || procedure.trim(),
        is_saved: true,
        saved_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
  });

  const handlePrint = () => {
    if (!selected) return;
    printNote({
      patientName: selected.patientName,
      patientId: selected.patientId,
      visitId: selected.visitId,
      date,
      procedure,
      surgeon,
      anaesthetist,
      anaesthesia,
      implant,
      description,
    });
  };

  return (
    <FlowScaffold
      heading="OT Notes"
      subheading="Create and print OT notes from the tablet"
      actions={
        selected ? (
          <>
            <TabletButton
              variant="outline"
              className="flex-1"
              onClick={() => setSelected(null)}
            >
              Change case
            </TabletButton>
            <TabletButton
              variant="outline"
              className="flex-1"
              onClick={handlePrint}
            >
              <Printer className="h-4 w-4" />
              Print
            </TabletButton>
            <TabletButton
              className="flex-1"
              onClick={() => save.mutate()}
              disabled={save.isPending}
            >
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </TabletButton>
          </>
        ) : (
          <TabletButton variant="outline" className="flex-1" onClick={() => setSearchInput("")}>
            Clear
          </TabletButton>
        )
      }
    >
      {!selected ? (
        <div className="space-y-4">
          <div className="flex gap-2">
            <TabletInput
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search patient, visit, or registration ID"
              className="min-w-0 flex-1"
            />
            <TabletButton className="shrink-0" onClick={() => setSearchInput((s) => s.trim())}>
              <Search className="h-5 w-5" />
            </TabletButton>
          </div>

          {cases.isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (cases.data || []).length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Search to choose a case for OT notes.
            </p>
          ) : (
            <div className="space-y-3">
              {(cases.data || []).map((item) => (
                <button
                  key={item.visitUuid}
                  type="button"
                  onClick={() => setSelected(item)}
                  className="w-full rounded-2xl border border-border bg-card p-4 text-left transition hover:border-primary/60 hover:bg-primary/5"
                >
                  <p className="font-semibold">{item.patientName}</p>
                  <p className="text-sm text-muted-foreground">
                    {item.patientId || "No patient ID"} · {item.visitId || "No visit ID"}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {item.packageName || "No package"} · Registration {item.registrationId || item.yojanaRegistrationId || "—"}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <TabletCard className="space-y-3">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Selected case
            </p>
            <h3 className="text-lg font-semibold">{selected.patientName}</h3>
            <p className="text-sm text-muted-foreground">
              {selected.patientId || "No ID"} · {selected.visitId || "No visit ID"}
            </p>
          </TabletCard>

          <TabletCard className="space-y-4">
            <div>
              <p className="mb-1.5 text-sm font-medium text-muted-foreground">Date</p>
              <TabletInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium text-muted-foreground">Procedure</p>
              <TabletInput value={procedure} onChange={(e) => setProcedure(e.target.value)} />
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium text-muted-foreground">Surgeon</p>
              <TabletInput value={surgeon} onChange={(e) => setSurgeon(e.target.value)} />
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium text-muted-foreground">Anaesthetist</p>
              <TabletInput value={anaesthetist} onChange={(e) => setAnaesthetist(e.target.value)} />
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium text-muted-foreground">Anaesthesia</p>
              <TabletInput value={anaesthesia} onChange={(e) => setAnaesthesia(e.target.value)} />
            </div>
            <div>
                <p className="mb-1.5 text-sm font-medium text-muted-foreground">Implant</p>
              <SearchableSelect
                options={implants.data || []}
                value={implant}
                onValueChange={setImplant}
                placeholder="Select implant..."
                searchPlaceholder="Search implant..."
                className="w-full"
              />
              <TabletInput
                className="mt-2"
                value={implant}
                onChange={(e) => setImplant(e.target.value)}
                placeholder="Implant used"
              />
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium text-muted-foreground">Description</p>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={6}
                className="w-full rounded-2xl border border-border bg-background p-3 text-sm outline-none ring-0 focus-visible:border-primary"
                placeholder="Operation note / OT description"
              />
            </div>
            {save.isError ? (
              <p className="text-sm text-destructive">
                {(save.error as Error)?.message || "Could not save OT notes."}
              </p>
            ) : null}
          </TabletCard>
        </div>
      )}
    </FlowScaffold>
  );
}
