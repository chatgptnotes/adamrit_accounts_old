import { useEffect } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { toast } from "sonner";

/**
 * Surfaces a "new version available" toast when an updated service worker is
 * waiting (registerType: "prompt"). Tapping Reload activates the new SW and
 * reloads. Renders nothing itself. Mount once near the app root.
 */
export function ReloadPrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // Idle tabs may not check for a new service worker for up to ~24h after
      // a deploy, leaving them running stale code (and stale bugs) all day.
      // Check every hour and whenever the tab becomes visible again.
      setInterval(() => registration.update(), 60 * 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update();
      });
    },
  });

  useEffect(() => {
    if (!needRefresh) return;
    toast("New version available", {
      description: "Reload to get the latest update.",
      duration: Infinity,
      action: {
        label: "Reload",
        onClick: () => updateServiceWorker(true),
      },
    });
  }, [needRefresh, updateServiceWorker]);

  return null;
}
