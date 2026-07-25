import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import type { HospitalType } from "@/types/hospital";

const REDIRECT_KEY = "director-drill-redirect";

/**
 * Drill from a per-hospital tile into a hospital-scoped detail page.
 *
 * The detail pages (Today's OPD/IPD, payment allocation, occupancy) read the
 * logged-in hospital from context — many of their queries don't key on it — so
 * showing another hospital means switching context, which forces a reload.
 * We stash the intended path first and replay it once the director view remounts
 * after the reload. When the tile's hospital is already active, we just navigate.
 */
export function useDirectorDrill() {
  const navigate = useNavigate();
  const { user, switchHospital } = useAuth();
  const current = user?.hospitalType;

  // Replay a pending drill after switchHospital's reload lands us back here.
  useEffect(() => {
    const target = sessionStorage.getItem(REDIRECT_KEY);
    if (target) {
      sessionStorage.removeItem(REDIRECT_KEY);
      navigate(target);
    }
  }, [navigate]);

  return (hospital: HospitalType, path: string) => {
    if (hospital === current) {
      navigate(path);
      return;
    }
    sessionStorage.setItem(REDIRECT_KEY, path);
    switchHospital(hospital); // reloads /director, then the effect above replays
  };
}
