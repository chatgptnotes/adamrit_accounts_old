import { useState } from "react";
import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpeechToText } from "@/tablet/hooks/useSpeechToText";

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Append a dictated chunk, tidying spaces and capitalising sentence starts. */
function appendText(existing: string, chunk: string): string {
  const c = chunk.trim();
  if (!c) return existing;
  const e = existing.replace(/\s+$/, "");
  if (!e) return capitalize(c);
  return `${e} ${/[.!?]$/.test(e) ? capitalize(c) : c}`;
}

interface DictationTextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  id?: string;
  className?: string;
}

/**
 * Textarea with voice dictation. The mic floats as a round button in the
 * lower-right corner of the field. One automatic mode (Indian-English, handles
 * English + Hinglish); live transcription shows words as they're spoken and
 * finalised speech is appended with sentence capitalisation. Degrades to a
 * plain textarea where the browser has no speech support.
 */
export function DictationTextarea({
  value,
  onChange,
  placeholder,
  rows = 3,
  id,
  className,
}: DictationTextareaProps) {
  const [interim, setInterim] = useState("");
  const [speechError, setSpeechError] = useState<string | null>(null);

  const speech = useSpeechToText({
    lang: "en-IN",
    onFinal: (text) => {
      setSpeechError(null);
      onChange(appendText(value, text));
    },
    onInterim: setInterim,
    onError: setSpeechError,
  });

  // Live preview — committed value plus the not-yet-final words.
  const displayValue = interim
    ? `${value.replace(/\s+$/, "")}${value.trim() ? " " : ""}${interim}`
    : value;

  return (
    <div className={cn("relative", className)}>
      <textarea
        id={id}
        value={displayValue}
        onChange={(e) => {
          if (!speech.listening) onChange(e.target.value);
        }}
        rows={rows}
        placeholder={placeholder}
        className={cn(
          "w-full rounded-xl border bg-background p-3 text-lg",
          speech.supported && "pb-16",
        )}
      />
      {speech.supported ? (
        <button
          type="button"
          onClick={() => (speech.listening ? speech.stop() : speech.start())}
          aria-label={speech.listening ? "Stop dictation" : "Dictate"}
          title={speech.listening ? "Listening — tap to stop" : "Dictate"}
          className={cn(
            "absolute bottom-3 right-3 flex h-12 w-12 items-center justify-center rounded-full shadow-md transition-colors",
            speech.listening
              ? "animate-pulse bg-rose-600 text-white"
              : "bg-primary text-primary-foreground",
          )}
        >
          <Mic className="h-5 w-5" />
        </button>
      ) : null}
      {speechError ? (
        <p className="mt-1 text-xs font-medium text-destructive">{speechError}</p>
      ) : null}
    </div>
  );
}
