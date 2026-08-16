import { useEffect, useRef, useState } from "react";
import { Mic, Square, Trash2, Loader2 } from "lucide-react";
import { TabletLabel } from "@/tablet/ui/TabletInput";

/**
 * A spoken explanation for a cash difference, recorded at the counter.
 *
 * WHY THIS EXISTS. The variance reason is the one thing a cashier must produce
 * when the drawer disagrees with the software. Typed on a tablet, in a second
 * language, with a queue waiting, it comes out as "short" or "paid out" --
 * which explains nothing to whoever reads the register a month later. Spoken,
 * the same cashier gives the whole story in fifteen seconds.
 *
 * IT DOES NOT REPLACE THE TEXT BOX. Both are offered, and either satisfies the
 * requirement. An accountant scanning a hundred rows needs something readable;
 * a cashier who cannot easily write one needs to speak. Forcing either group
 * through the other's tool is how the field ends up meaningless.
 *
 * The recording is held in memory and uploaded only after the handover is
 * recorded, exactly like the photographs: the handover is the thing that must
 * not be lost, and a failed upload should leave a correct handover with missing
 * evidence rather than the other way round.
 */

/** Kept small: a spoken reason is seconds long, and the tablet is on hospital wifi. */
const MAX_SECONDS = 120;

/** Whatever this browser will actually produce, best first. */
const pickMimeType = (): string | undefined => {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported?.(t));
};

const mmss = (total: number) =>
  `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;

export function VoiceReasonRecorder({
  file,
  onChange,
  disabled,
}: {
  file: File | null;
  onChange: (next: File | null) => void;
  disabled?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // A blob URL is a live handle on memory; letting the browser collect it when
  // the clip is replaced or the screen closes matters on a tablet left open all
  // day.
  useEffect(() => {
    if (!file) {
      setPlaybackUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPlaybackUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const stopTicking = () => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
  };

  // The microphone stays on until it is explicitly released. Leaving it live
  // after the screen closes puts a recording indicator on the tablet for the
  // rest of the shift.
  const releaseMic = () => {
    recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
  };

  useEffect(() => () => { stopTicking(); releaseMic(); }, []);

  const stop = () => {
    // onstop does the work; this only asks for it.
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  };

  const start = async () => {
    setError(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("This tablet's browser cannot record audio. Type the reason instead.");
      return;
    }
    setStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stopTicking();
        const type = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        releaseMic();
        setRecording(false);
        // A blob with no bytes means the microphone produced nothing --
        // permission granted but muted, on some tablets. Saying so beats
        // attaching silence to a cash difference.
        if (blob.size === 0) {
          setError("Nothing was recorded. Check the microphone, or type the reason.");
          onChange(null);
          return;
        }
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        onChange(
          new File([blob], `variance-reason-${Date.now()}.${ext}`, { type }),
        );
      };

      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setSeconds(0);
      stopTicking();
      tickRef.current = setInterval(() => {
        setSeconds((s) => {
          // Hard stop rather than an unbounded upload from a tablet somebody
          // put down while it was still recording.
          if (s + 1 >= MAX_SECONDS) stop();
          return s + 1;
        });
      }, 1000);
    } catch (e) {
      releaseMic();
      setRecording(false);
      setError(
        e instanceof Error && e.name === "NotAllowedError"
          ? "Microphone permission was refused. Allow it in the browser, or type the reason."
          : "Could not start recording. Type the reason instead.",
      );
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="rounded-xl border border-dashed p-3">
      <TabletLabel>Or say it out loud</TabletLabel>
      <p className="mt-1 text-xs text-muted-foreground">
        Easier than typing at the counter, and it explains far more. Either the
        typed reason or a recording is enough.
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!recording ? (
          <button
            type="button"
            disabled={disabled || starting}
            onClick={start}
            className="inline-flex min-h-14 flex-1 items-center justify-center gap-2 rounded-xl border bg-background px-4 text-sm font-semibold active:scale-[0.98] disabled:opacity-60"
          >
            {starting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mic className="h-5 w-5" />}
            {file ? "Record again" : "Record the reason"}
          </button>
        ) : (
          <button
            type="button"
            onClick={stop}
            className="inline-flex min-h-14 flex-1 items-center justify-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 text-sm font-semibold text-rose-900 active:scale-[0.98]"
          >
            <Square className="h-4 w-4 fill-current" />
            Stop — {mmss(seconds)}
          </button>
        )}

        {file && !recording && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => { onChange(null); setError(null); }}
            aria-label="Delete the recording"
            className="inline-flex h-14 w-14 items-center justify-center rounded-xl border active:scale-95 disabled:opacity-60"
          >
            <Trash2 className="h-5 w-5" />
          </button>
        )}
      </div>

      {recording && (
        <p className="mt-2 text-xs text-muted-foreground">
          Recording — say what happened to the money. Stops on its own at{" "}
          {mmss(MAX_SECONDS)}.
        </p>
      )}

      {/* Playing it back before submitting is the whole point: a recording
          nobody checked is worth no more than an empty box. */}
      {playbackUrl && !recording && (
        <div className="mt-2">
          <audio src={playbackUrl} controls className="w-full" />
          <p className="mt-1 text-xs text-muted-foreground">
            Listen before you submit. It is attached once the handover is recorded.
          </p>
        </div>
      )}

      {error && <p className="mt-2 text-xs font-medium text-rose-700">{error}</p>}
    </div>
  );
}
