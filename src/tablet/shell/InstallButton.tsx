import { useState } from "react";
import { Download, Share, X } from "lucide-react";
import { useInstallPrompt } from "@/tablet/hooks/useInstallPrompt";

/**
 * One-tap "Install app" button for the tablet top bar.
 * - Chromium (HTTPS): triggers the native install dialog directly.
 * - iOS Safari: shows a short Share → Add to Home Screen hint.
 * - Any other browser (no native prompt yet): shows a browser-menu hint.
 * - Hidden only when the app is already running installed/standalone.
 */
export function InstallButton() {
  const { canInstall, isIOS, isStandalone, promptInstall } = useInstallPrompt();
  const [showHint, setShowHint] = useState(false);

  // Show the install affordance whenever we're in a browser (not installed).
  if (isStandalone) return null;

  const btnClass =
    "flex h-11 items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 text-sm font-semibold text-emerald-300 transition-all hover:bg-emerald-500/25 active:scale-95";

  if (canInstall) {
    return (
      <button
        type="button"
        onClick={promptInstall}
        aria-label="Install app"
        className={btnClass}
      >
        <Download className="h-4 w-4" />
        <span className="hidden sm:inline">INSTALL</span>
      </button>
    );
  }

  // No native prompt available — guide the user through the manual install.
  // iOS Safari uses Share → Add to Home Screen; every other browser exposes
  // an "Install app" / "Add to Home screen" item in its main (⋮) menu.
  return (
    <>
      <button
        type="button"
        onClick={() => setShowHint(true)}
        aria-label="How to install app"
        className={btnClass}
      >
        <Download className="h-4 w-4" />
        <span className="hidden sm:inline">INSTALL</span>
      </button>

      {showHint ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowHint(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 text-foreground shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">
                {isIOS ? "Install on iPhone / iPad" : "Install Adamrit"}
              </h2>
              <button
                type="button"
                onClick={() => setShowHint(false)}
                aria-label="Close"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-secondary active:scale-95"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <ol className="space-y-3 text-sm text-muted-foreground">
              {isIOS ? (
                <>
                  <li className="flex items-center gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary font-bold text-foreground">
                      1
                    </span>
                    <span className="flex items-center gap-1">
                      Tap the Share icon
                      <Share className="inline h-4 w-4" />
                      in Safari's toolbar.
                    </span>
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary font-bold text-foreground">
                      2
                    </span>
                    <span>
                      Choose <strong className="text-foreground">Add to Home Screen</strong>.
                    </span>
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary font-bold text-foreground">
                      3
                    </span>
                    <span>
                      Tap <strong className="text-foreground">Add</strong> — the app opens fullscreen.
                    </span>
                  </li>
                </>
              ) : (
                <>
                  <li className="flex items-center gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary font-bold text-foreground">
                      1
                    </span>
                    <span>
                      Open your browser&apos;s menu (<strong className="text-foreground">⋮</strong> or <strong className="text-foreground">⋯</strong>).
                    </span>
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary font-bold text-foreground">
                      2
                    </span>
                    <span>
                      Choose <strong className="text-foreground">Install app</strong> or <strong className="text-foreground">Add to Home screen</strong>.
                    </span>
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary font-bold text-foreground">
                      3
                    </span>
                    <span>
                      Confirm <strong className="text-foreground">Install</strong> — the app opens fullscreen.
                    </span>
                  </li>
                </>
              )}
            </ol>
          </div>
        </div>
      ) : null}
    </>
  );
}
