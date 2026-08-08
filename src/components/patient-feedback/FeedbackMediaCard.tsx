import { useState } from "react";
import { format } from "date-fns";
import { Play } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  isFeedbackImage,
  isFeedbackVideo,
  type PatientFeedbackItem,
} from "@/hooks/usePatientFeedback";

interface FeedbackMediaCardProps {
  item: PatientFeedbackItem;
  /** Show whose feedback this is — used by the combined "All feedback" view. */
  showPatientName?: boolean;
}

/**
 * One feedback photo or video with its caption. Opens full size in place
 * rather than in a new tab, the same way a payment proof does.
 */
export function FeedbackMediaCard({ item, showPatientName }: FeedbackMediaCardProps) {
  const [open, setOpen] = useState(false);
  const isVideo = isFeedbackVideo(item.fileType);
  const isImage = isFeedbackImage(item.fileType);

  const stamp = item.createdAt
    ? format(new Date(item.createdAt), "dd MMM yyyy hh:mm a")
    : null;

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="relative block h-40 w-full bg-muted"
          aria-label={`Open ${item.fileName} full size`}
        >
          {isImage ? (
            <img
              src={item.fileUrl}
              alt={item.caption || item.fileName}
              className="h-40 w-full object-cover"
              loading="lazy"
            />
          ) : isVideo ? (
            <>
              <video
                src={item.fileUrl}
                className="h-40 w-full object-cover"
                preload="metadata"
                muted
                playsInline
              />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="rounded-full bg-black/60 p-3">
                  <Play className="h-6 w-6 fill-white text-white" />
                </span>
              </span>
            </>
          ) : (
            <span className="flex h-40 w-full items-center justify-center px-2 text-center text-xs text-muted-foreground">
              {item.fileName}
            </span>
          )}
        </button>

        <div className="space-y-1 p-3">
          {showPatientName && item.patientName ? (
            <p className="truncate text-sm font-semibold text-foreground">
              {item.patientName}
            </p>
          ) : null}
          {item.caption ? (
            <p className="whitespace-pre-wrap text-sm text-foreground">{item.caption}</p>
          ) : (
            <p className="text-sm italic text-muted-foreground">No caption</p>
          )}
          <p className="text-[11px] text-muted-foreground">{stamp || "—"}</p>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="truncate">
              {item.patientName || "Patient feedback"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {isVideo ? (
              <video
                src={item.fileUrl}
                controls
                preload="metadata"
                playsInline
                className="mx-auto max-h-[60vh] w-full rounded-md border bg-black"
              />
            ) : isImage ? (
              <img
                src={item.fileUrl}
                alt={item.caption || item.fileName}
                className="mx-auto max-h-[60vh] w-auto rounded-md border"
              />
            ) : null}
            {item.caption ? (
              <p className="whitespace-pre-wrap text-center text-sm text-foreground">
                {item.caption}
              </p>
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{stamp || "—"}</span>
              <Button variant="outline" size="sm" asChild>
                <a href={item.fileUrl} target="_blank" rel="noreferrer">
                  Open full size
                </a>
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface FeedbackGridProps {
  items: PatientFeedbackItem[];
  showPatientName?: boolean;
  emptyMessage?: string;
}

export function FeedbackGrid({ items, showPatientName, emptyMessage }: FeedbackGridProps) {
  if (items.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {emptyMessage || "No feedback uploaded yet."}
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <FeedbackMediaCard key={item.id} item={item} showPatientName={showPatientName} />
      ))}
    </div>
  );
}
