import { useCallback, useEffect, useState } from "react";

/**
 * Web Push opt-in state for the current device.
 *
 * "supported" — this browser can do push at all. On iOS Safari that is only
 * true once the app runs from a Home Screen icon (iOS 16.4+); in the plain
 * Safari tab, PushManager does not exist, which is why the enable card shows
 * Add-to-Home-Screen instructions there instead of an Allow button.
 *
 * enable() must be called from a real user tap — browsers (iOS especially)
 * refuse Notification.requestPermission() outside a user gesture.
 */

type PushStatus =
  | "unsupported"
  | "idle" // supported, not yet subscribed
  | "subscribing"
  | "subscribed"
  | "denied"; // user blocked notifications in the browser

// The VAPID applicationServerKey must be an ArrayBuffer-backed key, not the
// base64url string the env var holds.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

const pushSupported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

export function usePushNotifications() {
  const [status, setStatus] = useState<PushStatus>(
    pushSupported() ? "idle" : "unsupported",
  );
  const [error, setError] = useState<string | null>(null);

  // On mount, find out whether this device is already subscribed.
  useEffect(() => {
    if (!pushSupported()) return;
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (!cancelled && subscription) setStatus("subscribed");
      } catch {
        // stay "idle" — the enable button will surface any real problem
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    if (!pushSupported()) return;
    setError(null);
    setStatus("subscribing");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "idle");
        return;
      }

      const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
      if (!vapidKey) throw new Error("VITE_VAPID_PUBLIC_KEY is not configured");

      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        }));

      const response = await fetch("/api/push-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!response.ok) throw new Error(`subscribe failed (${response.status})`);

      setStatus("subscribed");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus(pushSupported() ? "idle" : "unsupported");
    }
  }, []);

  const disable = useCallback(async () => {
    if (!pushSupported()) return;
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push-subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
    } finally {
      setStatus("idle");
    }
  }, []);

  return { status, error, enable, disable };
}
