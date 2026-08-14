import { type ChangeEvent } from "react";
import { Camera, FileImage, X } from "lucide-react";
import { TabletLabel } from "@/tablet/ui/TabletInput";
import { HANDOVER_PHOTO_KINDS, type HandoverPhotoKind } from "@/lib/cashHandover";

export interface PendingPhoto {
  /** Stable key for the list; the File itself is not a reliable identity. */
  key: string;
  file: File;
  kind: HandoverPhotoKind;
}

/**
 * Photographs taken while the drawer is being counted.
 *
 * They are held here and uploaded only once the handover has been recorded,
 * because the handover is the thing that must not be lost: a failed upload
 * should leave a correct handover with missing evidence, never a photograph
 * belonging to nothing.
 *
 * Many, not one. A register page, a signed slip and a second page of
 * denominations are three different pieces of evidence, and one attachment
 * slot means two of them never get taken. Each is labelled with what it shows,
 * so a director opening a disputed handover months later knows which is which
 * without opening all of them.
 */
export function HandoverPhotoCapture({
  photos,
  onChange,
  disabled,
}: {
  photos: PendingPhoto[];
  onChange: (next: PendingPhoto[]) => void;
  disabled?: boolean;
}) {
  const add = (event: ChangeEvent<HTMLInputElement>, kind: HandoverPhotoKind) => {
    const chosen = Array.from(event.target.files ?? []);
    // Cleared so the same photo can be picked again after a retake — a second
    // shot of a blurred register page has the same file name.
    event.target.value = "";
    if (!chosen.length) return;
    onChange([
      ...photos,
      ...chosen.map((file) => ({
        key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        kind,
      })),
    ]);
  };

  const setKind = (key: string, kind: HandoverPhotoKind) =>
    onChange(photos.map((p) => (p.key === key ? { ...p, kind } : p)));

  const drop = (key: string) => onChange(photos.filter((p) => p.key !== key));

  return (
    <div>
      <TabletLabel>Photos of the register and the signed note</TabletLabel>
      <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label
          className={`inline-flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed bg-background px-4 text-sm font-semibold active:scale-[0.98] ${
            disabled ? "pointer-events-none opacity-60" : ""
          }`}
        >
          <Camera className="h-5 w-5" />
          Take a photo
          {/* capture opens the rear camera on the tablet: the cashier is
              standing at the drawer with the register open, not browsing. */}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            disabled={disabled}
            onChange={(e) => add(e, "cash_register")}
          />
        </label>

        <label
          className={`inline-flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed bg-background px-4 text-sm font-semibold active:scale-[0.98] ${
            disabled ? "pointer-events-none opacity-60" : ""
          }`}
        >
          <FileImage className="h-5 w-5" />
          Choose photos
          <input
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="hidden"
            disabled={disabled}
            onChange={(e) => add(e, "other")}
          />
        </label>
      </div>

      {photos.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Optional, but a disputed count months later has nothing to go back to
          without them. Add as many as you need.
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {photos.map((p) => (
            <div key={p.key} className="flex items-center gap-2 rounded-xl border p-2">
              {p.file.type.startsWith("image/") ? (
                <img
                  src={URL.createObjectURL(p.file)}
                  alt={p.file.name}
                  className="h-12 w-12 flex-shrink-0 rounded object-cover"
                />
              ) : (
                <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded bg-muted text-[10px] font-semibold">
                  PDF
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{p.file.name}</p>
                <select
                  value={p.kind}
                  disabled={disabled}
                  onChange={(e) => setKind(p.key, e.target.value as HandoverPhotoKind)}
                  className="mt-1 w-full rounded-lg border bg-background px-2 py-1 text-xs"
                >
                  {HANDOVER_PHOTO_KINDS.map((k) => (
                    <option key={k.key} value={k.key}>{k.label}</option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                disabled={disabled}
                onClick={() => drop(p.key)}
                aria-label={`Remove ${p.file.name}`}
                className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border active:scale-95"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            {photos.length} photo{photos.length === 1 ? "" : "s"} will be attached once
            the handover is recorded.
          </p>
        </div>
      )}
    </div>
  );
}
