import { useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, FileImage, Loader2, NotebookPen, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import {
  deleteVasooliListPhoto,
  fetchVasooliListPhotos,
  uploadVasooliListPhoto,
  type VasooliListPhoto,
} from "@/tablet/lib/vasooliListPhotos";

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
      })
    : "—";

/**
 * Gaurav photographs his handwritten collection list; Avani types it in.
 *
 * The sheet is the day's work before any of it is in the system. Keeping it
 * here rather than on WhatsApp means Avani is always typing from the current
 * one, it carries the time it was taken and who took it, and a disputed amount
 * can be read back against the paper months later.
 *
 * Opening a sheet expands it in place instead of over the screen. Avani is
 * copying names and amounts off it into the fields below, and a dialog that
 * covers the fields would have to be closed for every single line.
 */
export function CollectionListSheets({ hospital }: { hospital: string | null }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);

  const sheets = useQuery({
    queryKey: ["vasooli-list-photos", hospital ?? "all"],
    queryFn: () => fetchVasooliListPhotos(hospital),
    staleTime: 15_000,
  });

  // Who took each sheet. The id is on the row; the name is what Avani needs to
  // know she is reading today's list from the person who walked the ward.
  const uploaderIds = [...new Set((sheets.data ?? []).map((s) => s.uploadedBy).filter(Boolean))] as string[];
  const uploaders = useQuery({
    queryKey: ["vasooli-list-uploaders", uploaderIds.join(",")],
    enabled: uploaderIds.length > 0,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("User").select("id, full_name, email").in("id", uploaderIds);
      return Object.fromEntries(
        (data ?? []).map((u: any) => [u.id, u.full_name || u.email || "Unknown"]),
      ) as Record<string, string>;
    },
  });

  // Deleting is two taps, not one. This is the sheet the day's collection is
  // being typed from, and it is sitting under a thumb on a tablet.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => deleteVasooliListPhoto({ id, userId: user?.id ?? null }),
    onSuccess: (_data, id) => {
      toast.success("List photo removed.");
      setConfirmingId(null);
      if (openId === id) setOpenId(null);
      qc.invalidateQueries({ queryKey: ["vasooli-list-photos"] });
    },
    onError: (e) => {
      setConfirmingId(null);
      toast.error(e instanceof Error ? e.message : "Could not remove the photo");
    },
  });

  const upload = useMutation({
    mutationFn: (file: File) =>
      uploadVasooliListPhoto({ file, hospital, uploadedBy: user?.id ?? null }),
    onSuccess: () => {
      toast.success("List saved. Avani can type from it now.");
      qc.invalidateQueries({ queryKey: ["vasooli-list-photos"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Could not save the photo"),
  });

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared so the same photo can be chosen twice running — a retake of a
    // blurred sheet has the same file name and would otherwise do nothing.
    event.target.value = "";
    if (file) upload.mutate(file);
  };

  const rows = sheets.data ?? [];
  const open = rows.find((s) => s.id === openId) ?? null;

  return (
    <TabletCard variant="flat" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <NotebookPen className="h-5 w-5 text-amber-600" />
        <h3 className="text-lg font-bold">Gaurav's handwritten list</h3>
        <span className="text-sm text-muted-foreground">
          Photograph the sheet; Avani fills the fields from it.
        </span>

        <div className="ml-auto flex flex-wrap gap-2">
          <label
            className={`inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border bg-background px-4 text-sm font-semibold transition-all active:scale-[0.98] ${
              upload.isPending ? "pointer-events-none opacity-60" : ""
            }`}
          >
            {upload.isPending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Camera className="h-5 w-5" />
            )}
            Take a photo
            {/* capture opens the rear camera straight away on the tablet, which
                is the whole point: Gaurav is standing in the ward holding the
                sheet, not hunting through a gallery. */}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={pick}
              disabled={upload.isPending}
            />
          </label>

          <label
            className={`inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border bg-background px-4 text-sm font-semibold transition-all active:scale-[0.98] ${
              upload.isPending ? "pointer-events-none opacity-60" : ""
            }`}
          >
            <FileImage className="h-5 w-5" />
            Upload
            <input
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={pick}
              disabled={upload.isPending}
            />
          </label>
        </div>
      </div>

      {sheets.isLoading ? (
        <div className="flex min-h-20 items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading the sheets
        </div>
      ) : sheets.isError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {(sheets.error as Error)?.message || "Could not load the sheets."}
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
          No list photographed yet. Take a photo of the sheet and it will show here.
        </p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {rows.map((sheet) => (
            <Thumb
              key={sheet.id}
              sheet={sheet}
              by={sheet.uploadedBy ? uploaders.data?.[sheet.uploadedBy] : null}
              active={sheet.id === openId}
              onOpen={() => setOpenId(sheet.id === openId ? null : sheet.id)}
            />
          ))}
        </div>
      )}

      {open && (
        <div className="rounded-xl border bg-background">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <span className="text-sm font-semibold">Taken {when(open.uploadedAt)}</span>
            {open.uploadedBy && uploaders.data?.[open.uploadedBy] && (
              <span className="text-sm text-muted-foreground">
                by {uploaders.data[open.uploadedBy]}
              </span>
            )}
            <a
              href={open.fileUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-sm font-semibold text-primary underline"
            >
              Open full size
            </a>

            {/* Only the person who took it. The database refuses anyone else
                regardless, so this hides an action that would fail rather
                than being the check itself. */}
            {!!user?.id && open.uploadedBy === user.id && (
              confirmingId === open.id ? (
                <>
                  <TabletButton
                    variant="outline"
                    className="min-h-9 border-red-300 px-3 text-sm text-red-700"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(open.id)}
                  >
                    {remove.isPending ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="mr-1 h-4 w-4" />
                    )}
                    Tap again to delete
                  </TabletButton>
                  <TabletButton
                    variant="outline"
                    className="min-h-9 px-3 text-sm"
                    onClick={() => setConfirmingId(null)}
                  >
                    Keep
                  </TabletButton>
                </>
              ) : (
                <TabletButton
                  variant="outline"
                  className="min-h-9 px-3 text-sm text-red-700"
                  title="Delete this photo"
                  onClick={() => setConfirmingId(open.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </TabletButton>
              )
            )}

            <TabletButton variant="outline" className="min-h-9 px-3" onClick={() => setOpenId(null)}>
              <X className="h-4 w-4" />
            </TabletButton>
          </div>
          {open.fileType === "application/pdf" ? (
            <iframe title={open.fileName} src={open.fileUrl} className="h-[70vh] w-full rounded-b-xl" />
          ) : (
            // Tall on purpose. It is being read off, not glanced at, and
            // handwriting at thumbnail size is not readable.
            <img
              src={open.fileUrl}
              alt={`Collection list taken ${when(open.uploadedAt)}`}
              className="max-h-[70vh] w-full rounded-b-xl object-contain"
            />
          )}
        </div>
      )}
    </TabletCard>
  );
}

function Thumb({
  sheet, by, active, onOpen,
}: {
  sheet: VasooliListPhoto;
  by: string | null | undefined;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-36 shrink-0 overflow-hidden rounded-xl border text-left transition-all active:scale-[0.98] ${
        active ? "ring-2 ring-primary" : ""
      }`}
    >
      {sheet.fileType === "application/pdf" ? (
        <span className="flex h-24 items-center justify-center bg-muted text-xs font-semibold text-muted-foreground">
          PDF
        </span>
      ) : (
        <img
          src={sheet.fileUrl}
          alt={`Collection list taken ${when(sheet.uploadedAt)}`}
          className="h-24 w-full bg-muted object-cover"
          loading="lazy"
        />
      )}
      <span className="block px-2 py-1">
        <span className="block truncate text-xs font-semibold">{when(sheet.uploadedAt)}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{by || "—"}</span>
      </span>
    </button>
  );
}
