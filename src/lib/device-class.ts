/**
 * Device-aware routing — decides whether a browser sees the desktop full site
 * or the touch (tablet) edition. Same URL for both; this is the only switch.
 *
 * Pure and synchronous so it can be called during render in App.tsx without a
 * flash. A manual override (localStorage) always wins over auto-detection.
 */

export type DeviceClass = "mobile" | "tablet" | "desktop";

/** localStorage key for the manual override: 'full' | 'tablet'. */
const OVERRIDE_KEY = "adamrit_ui_mode";

/**
 * Classify the current device from the userAgent OS only. Touch laptops (any
 * size, any DPI) classify as desktop by design — width and pointer type are
 * deliberately ignored so a laptop never auto-switches to the tablet edition;
 * the manual override covers anyone who wants the touch UI on such a device.
 */
export function classifyDevice(): DeviceClass {
  if (typeof window === "undefined") return "desktop";
  const ua = navigator.userAgent;

  // iPadOS 13+ reports a Mac userAgent — a real Mac has maxTouchPoints 0.
  // Older iPads (iOS <=12) report a literal "iPad" token instead.
  const isIpad =
    /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const isAndroidPhone = /Android/.test(ua) && /Mobile/.test(ua);
  const isAndroidTablet = /Android/.test(ua) && !/Mobile/.test(ua);
  const isIphone = /iPhone|iPod/.test(ua);

  // Tablet/mobile editions require a real mobile/tablet OS in the userAgent.
  // A laptop (Windows/macOS/Linux/ChromeOS) always lands on desktop, even when
  // it has a touchscreen (coarse pointer) or a high-DPI/narrow window — those
  // signals alone were previously misclassifying laptops as tablets.
  if (isIphone || isAndroidPhone) return "mobile";
  if (isIpad || isAndroidTablet) return "tablet";
  return "desktop";
}

/** Read the saved manual override, if any. */
export function readOverride(): "full" | "tablet" | null {
  try {
    const v = localStorage.getItem(OVERRIDE_KEY);
    return v === "full" || v === "tablet" ? v : null;
  } catch {
    return null;
  }
}

/** Save (or clear) the manual override. Pass null to return to auto-detection. */
export function setOverride(mode: "full" | "tablet" | null): void {
  try {
    if (mode) localStorage.setItem(OVERRIDE_KEY, mode);
    else localStorage.removeItem(OVERRIDE_KEY);
  } catch {
    /* localStorage unavailable — fall back to auto-detection */
  }
}

/** Device class with the manual override applied. */
export function getEffectiveDeviceClass(): DeviceClass {
  const o = readOverride();
  if (o === "full") return "desktop";
  if (o === "tablet") return "tablet";
  return classifyDevice();
}

/** True when this device should see the touch (tablet) edition. */
export function shouldUseTabletEdition(): boolean {
  return getEffectiveDeviceClass() !== "desktop";
}
