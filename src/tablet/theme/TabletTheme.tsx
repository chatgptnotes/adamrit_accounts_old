import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type TabletTheme = "dark" | "light";

const STORAGE_KEY = "tablet-theme";

/* Status-bar (theme-color) tone per theme — matched to the top of the branded
   `.tablet-topbar` gradient so the OS status strip blends into the header. */
const META_THEME_COLOR = { dark: "#13211b", light: "#eef4f1" } as const;

interface TabletThemeValue {
  theme: TabletTheme;
  toggleTheme: () => void;
}

const TabletThemeContext = createContext<TabletThemeValue | null>(null);

/**
 * Theme state for the tablet edition (dark default, light opt-in).
 * The choice is persisted to localStorage so it survives reloads. The actual
 * palette swap is a CSS class (`tablet-light`) applied on the `.tablet-root`
 * element — scoped, so the desktop site is never affected.
 */
export function TabletThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<TabletTheme>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* storage unavailable — keep the choice in memory only */
    }
    // Match the OS status bar to the branded header. Reverted to the static
    // index.html value on full reload when leaving the tablet edition.
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", META_THEME_COLOR[theme]);
  }, [theme]);

  const toggleTheme = useCallback(
    () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    [],
  );

  return (
    <TabletThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </TabletThemeContext.Provider>
  );
}

export function useTabletTheme(): TabletThemeValue {
  const ctx = useContext(TabletThemeContext);
  if (!ctx) {
    throw new Error("useTabletTheme must be used within a TabletThemeProvider");
  }
  return ctx;
}
