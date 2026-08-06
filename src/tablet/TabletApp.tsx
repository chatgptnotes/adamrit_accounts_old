import "./styles/tablet.css";
import { Route, Routes } from "react-router-dom";
import { cn } from "@/lib/utils";
import { TabletShell } from "./shell/TabletShell";
import { TabletHome } from "./screens/TabletHome";
import { TabletModuleHost } from "./screens/TabletModuleHost";
import { TabletFinalBill } from "./screens/TabletFinalBill";
import { TabletGatePass } from "./screens/TabletGatePass";
import { TabletThemeProvider, useTabletTheme } from "./theme/TabletTheme";

/** Routed shell — applies the active theme class to the `.tablet-root` scope. */
function TabletAppShell() {
  const { theme } = useTabletTheme();
  return (
    <div className={cn("tablet-root", theme === "light" && "tablet-light")}>
      <Routes>
        <Route element={<TabletShell />}>
          <Route index element={<TabletHome />} />
          {/* Ahead of :moduleId — desktop pages the tiles link to, not
              tablet modules. Without them the tile's navigate() matched
              :moduleId and redirected straight back to the home screen. */}
          <Route path="final-bill/:visitId" element={<TabletFinalBill />} />
          <Route path="gate-pass/:visitId" element={<TabletGatePass />} />
          <Route path=":moduleId/*" element={<TabletModuleHost />} />
        </Route>
      </Routes>
    </div>
  );
}

/**
 * Tablet Edition entry point. App.tsx renders this — on the same URL as the
 * desktop site, no `/t` path — for tablet/phone devices (or the saved "tablet"
 * override). The user is already signed in via the main AuthContext before
 * this mounts, so there is no separate tablet login.
 */
export default function TabletApp() {
  return (
    <TabletThemeProvider>
      <TabletAppShell />
    </TabletThemeProvider>
  );
}
