import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { HOSPITAL_CONFIGS, type HospitalType } from '@/types/hospital';
import { useCompanies } from '@/hooks/useCompanies';
import { useAccountingCompanyOptional } from '../AccountingCompanyContext';
import { companyKey } from '@/lib/tallyCompanyMatch';
import { dayLabel, periodLabel as labelOfPeriod, useAccountingPeriodOptional } from './PeriodContext';

/**
 * Shared Tally Prime chrome for the accounting module:
 *  - TallyTopBar: dark-blue header with script logo, centred Alt+F search
 *    (jump to any accounting screen) and the K/Y/Z/G/O/E/M/P menu row
 *  - TallyScreen: per-screen frame — light-blue title strip with company
 *    name and ✕, right-side F-key button rail, optional bottom action bar
 *
 * Menu/rail items without a real action render greyed-out, exactly like
 * Tally greys inapplicable actions.
 */

// F12: Configure — persisted preferences applied across report screens
export const getTallyConfig = (): { defaultDetailed: boolean; dayBookMonth: boolean } => {
  try {
    return { defaultDetailed: false, dayBookMonth: false, ...JSON.parse(localStorage.getItem('tally-config') || '{}') };
  } catch {
    return { defaultDetailed: false, dayBookMonth: false };
  }
};

// Tally's classic UI is small, tight sans-serif.
export const TALLY_FONT = { fontFamily: 'Verdana, "Segoe UI", Tahoma, Arial, sans-serif' } as const;

/** Modifier a hotkey needs, so two buttons can share a letter (F / Ctrl+F). */
export type HotkeyMod = 'alt' | 'ctrl';

/**
 * Extra key combinations that fire the same action but are not drawn on the
 * button. Tally labels a report key "Ctrl+B"; this module shipped the bare
 * letter first, so the bare letter stays bound as an alias and nobody's muscle
 * memory breaks when the label catches up with Tally.
 */
export interface HotkeyAlias {
  hotkey: string;
  mod?: HotkeyMod;
}

export interface RailItem {
  /** Shortcut label shown in blue, e.g. "F5" or "A" */
  hotkey?: string;
  /** Modifier the hotkey needs — shown as "Ctrl+F" / "Alt+F12" */
  mod?: HotkeyMod;
  /** Unlabelled key combinations that fire the same action */
  aliases?: HotkeyAlias[];
  label: string;
  onClick?: () => void;
  active?: boolean;
  /** Renders greyed like Tally's inapplicable actions */
  disabled?: boolean;
  /** Adds a gap above this item (Tally groups rail buttons) */
  gapBefore?: boolean;
}
export interface BottomBarItem {
  hotkey: string;
  mod?: HotkeyMod;
  aliases?: HotkeyAlias[];
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}

/**
 * The key bar Tally shows under a voucher-listing report (Day Book, Registers,
 * Ledger Vouchers), in Tally's own order. A handler left out renders greyed,
 * the way Tally greys an action that does not apply to the highlighted line.
 *
 * Remove / Restore Line are view-only in Tally — they hide a line from the
 * report, they never touch the voucher.
 */
export const voucherBottomBar = (handlers: {
  onQuit?: () => void;
  onAlter?: () => void;
  onSelect?: () => void;
  onAdd?: () => void;
  onDuplicate?: () => void;
  onInsert?: () => void;
  onDelete?: () => void;
  onCancelVch?: () => void;
  onRemoveLine?: () => void;
  onRestoreLine?: () => void;
}): BottomBarItem[] => [
  { hotkey: 'Q', label: 'Quit', onClick: handlers.onQuit },
  // Tally alters the highlighted voucher with Ctrl+Enter; bare Enter is how the
  // row cursor has always drilled here, so both are bound.
  { hotkey: 'Enter', mod: 'ctrl', label: 'Alter', aliases: [{ hotkey: 'Enter' }], onClick: handlers.onAlter },
  { hotkey: 'Space', label: 'Select', onClick: handlers.onSelect },
  { hotkey: 'A', mod: 'alt', label: 'Add Vch', aliases: [{ hotkey: 'A' }], onClick: handlers.onAdd },
  { hotkey: '2', mod: 'alt', label: 'Duplicate Vch', aliases: [{ hotkey: '2' }], onClick: handlers.onDuplicate },
  { hotkey: 'I', mod: 'alt', label: 'Insert Vch', aliases: [{ hotkey: 'I' }], onClick: handlers.onInsert },
  { hotkey: 'D', mod: 'alt', label: 'Delete', aliases: [{ hotkey: 'D' }], onClick: handlers.onDelete },
  { hotkey: 'X', mod: 'alt', label: 'Cancel Vch', aliases: [{ hotkey: 'X' }], onClick: handlers.onCancelVch },
  { hotkey: 'R', mod: 'alt', label: 'Remove Line', aliases: [{ hotkey: 'R' }], onClick: handlers.onRemoveLine },
  { hotkey: 'U', mod: 'alt', label: 'Restore Line', aliases: [{ hotkey: 'U' }], onClick: handlers.onRestoreLine },
];

/** "F" + ctrl -> "Ctrl+F"; the text shown in the blue key prefix. */
export const hotkeyLabel = (hotkey: string, mod?: HotkeyMod): string =>
  mod === 'ctrl' ? `Ctrl+${hotkey}` : mod === 'alt' ? `Alt+${hotkey}` : hotkey;

/**
 * Pop-ups (Change Period, Basis of Values, …) register while they are open so
 * the screen behind them stops answering its own hotkeys — Tally's modal
 * pop-ups own the keyboard until they are accepted or quit.
 */
let openModalCount = 0;
export const tallyModalIsOpen = (): boolean => openModalCount > 0;
export const useTallyModal = (): void => {
  useEffect(() => {
    openModalCount += 1;
    return () => {
      openModalCount -= 1;
    };
  }, []);
};

/**
 * An open top-bar drop-down owns the keyboard too, but it must not silence its
 * own handler — so it is counted separately from the modal pop-ups. Only the
 * screen behind it steps aside.
 */
let openTopMenuCount = 0;
export const tallyTopMenuIsOpen = (): boolean => openTopMenuCount > 0;
const useTopMenuOwnsKeyboard = (open: boolean): void => {
  useEffect(() => {
    if (!open) return;
    openTopMenuCount += 1;
    return () => {
      openTopMenuCount -= 1;
    };
  }, [open]);
};

/** True when the event landed in a field the user is typing into. */
export const isTypingTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

/**
 * Does this keydown match the item's hotkey (and only its modifier)?
 *
 * Tally is a Windows product, so its modifier is Ctrl. macOS Cmd (metaKey) is
 * deliberately NOT accepted as Ctrl — treating them as the same key made
 * Cmd+F hijack the browser's own Find, and the same for Cmd+A / Cmd+P.
 */
export const hotkeyMatches = (e: KeyboardEvent, hotkey: string, mod: HotkeyMod | undefined): boolean => {
  // "Esc" and "Space" are how Tally labels them; the browser calls the same
  // keys "Escape" and " ".
  const hk = hotkey.toUpperCase() === 'ESC' ? 'ESCAPE' : hotkey.toUpperCase();
  const pressed = e.key === ' ' ? 'SPACE' : e.key.toUpperCase();
  if (pressed !== hk) return false;
  if (mod === 'ctrl') return e.ctrlKey && !e.altKey && !e.metaKey;
  if (mod === 'alt') return e.altKey && !e.ctrlKey && !e.metaKey;
  return !e.altKey && !e.ctrlKey && !e.metaKey;
};

/** The item's own hotkey, plus any unlabelled aliases. */
export const itemMatches = (
  e: KeyboardEvent,
  item: { hotkey?: string; mod?: HotkeyMod; aliases?: HotkeyAlias[] },
): boolean => {
  if (item.hotkey && hotkeyMatches(e, item.hotkey, item.mod)) return true;
  return (item.aliases ?? []).some((a) => hotkeyMatches(e, a.hotkey, a.mod));
};

interface TallyTopBarProps {
  /** Section names for the Alt+F / Go To jump list */
  sections: { id: string; label: string }[];
  onGoTo: (id: string) => void;
}

/** One button in the top menu row — either a direct action or a drop-down. */
interface TopMenu {
  key: string;
  label: string;
  action?: () => void;
  items?: { label: string; onClick?: () => void }[];
}

/**
 * Pulls the latest ledgers for the selected company from Tally. Tally keeps
 * data exchange on the Z: Exchange menu, so this hangs off there rather than
 * on a button of its own.
 */
const useTallyQuickSync = (): { syncLatest: () => Promise<void>; syncing: boolean; enabled: boolean } => {
  const queryClient = useQueryClient();
  const accountingCompany = useAccountingCompanyOptional();
  const selectedCompanyId = accountingCompany?.selectedCompanyId || '';
  const selectedCompany = accountingCompany?.companies.find((company) => company.id === selectedCompanyId);
  const [syncing, setSyncing] = useState(false);

  const { data: tallyConfigs = [] } = useQuery({
    queryKey: ['tally_configs_for_accounting'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('tally_config')
        .select('id, server_url, company_name, is_active, auto_sync_enabled, last_sync_at')
        .eq('is_active', true);
      if (error) throw error;
      return data || [];
    },
  });

  const selectedTallyConfig = useMemo(() => {
    if (!selectedCompany?.company_name) return null;
    const matches = tallyConfigs.filter((config: any) => companyKey(config.company_name) === companyKey(selectedCompany.company_name));
    return matches.length === 1 ? matches[0] : null;
  }, [selectedCompany, tallyConfigs]);

  const syncLatest = useCallback(async () => {
    if (selectedTallyConfig?.auto_sync_enabled !== true) {
      toast.info('Incoming Tally sync is disabled for the fresh manual ledger master');
      return;
    }
    if (!selectedCompanyId || !selectedTallyConfig?.id || !selectedTallyConfig.server_url || !selectedTallyConfig.company_name) {
      toast.error('No matching Tally configuration found for the selected Accounting company');
      return;
    }

    setSyncing(true);
    try {
      const today = new Date();
      const fallbackFrom = new Date(today);
      fallbackFrom.setDate(fallbackFrom.getDate() - 30);
      const lastSync = selectedTallyConfig.last_sync_at ? new Date(selectedTallyConfig.last_sync_at) : fallbackFrom;
      lastSync.setDate(lastSync.getDate() - 1);
      const isoDate = (date: Date) => date.toISOString().slice(0, 10);
      const response = await fetch('/api/tally-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: 'sync',
          action: 'ledgers',
          serverUrl: selectedTallyConfig.server_url,
          companyName: selectedTallyConfig.company_name,
          companyId: selectedTallyConfig.id,
          accountingCompanyId: selectedCompanyId,
          dateRange: { from: isoDate(lastSync), to: isoDate(today) },
        }),
      });
      const result = await response.json();
      if (!response.ok || result.error || result.success === false || result.errors?.length) {
        throw new Error(result.error || result.message || 'Latest Tally sync failed');
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['chart_of_accounts_leaves', selectedCompanyId] }),
        queryClient.invalidateQueries({ queryKey: ['tb_merged', selectedCompanyId] }),
        queryClient.invalidateQueries({ queryKey: ['balance_sheet_merged'] }),
        queryClient.invalidateQueries({ queryKey: ['profit_loss_merged'] }),
        queryClient.invalidateQueries({ queryKey: ['daybook_tally', selectedCompanyId] }),
        queryClient.invalidateQueries({ queryKey: ['voucher_register_tally'] }),
        queryClient.invalidateQueries({ queryKey: ['ledger_tally'] }),
        queryClient.invalidateQueries({ queryKey: ['tally_configs_for_accounting'] }),
      ]);
      toast.success(`All ledgers saved for ${selectedTallyConfig.company_name} (${result.recordsSynced ?? 0} records)`);
    } catch (error: any) {
      toast.error(error?.message || 'Latest Tally sync failed');
    } finally {
      setSyncing(false);
    }
  }, [queryClient, selectedCompanyId, selectedTallyConfig]);

  return { syncLatest, syncing, enabled: selectedTallyConfig?.auto_sync_enabled === true };
};

export const TallyTopBar: React.FC<TallyTopBarProps> = ({ sections, onGoTo }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [featuresOpen, setFeaturesOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [menuHighlight, setMenuHighlight] = useState(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const { user, switchHospital, hospitalConfig } = useAuth();
  const { data: companies = [] } = useCompanies();
  const { syncLatest, syncing, enabled: syncEnabled } = useTallyQuickSync();

  const otherHospital = (Object.keys(HOSPITAL_CONFIGS) as HospitalType[]).find((h) => h !== user?.hospitalType);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? sections.filter((s) => s.label.toLowerCase().includes(q)) : sections;
  }, [sections, query]);

  const go = (id: string) => {
    onGoTo(id);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  // Tally Prime's top-bar buttons: each is either a direct action or a menu of
  // destinations. Held as data so the keyboard can drive them too.
  const menus: TopMenu[] = useMemo(
    () => [
      {
        key: 'K',
        label: 'Company',
        items: [
          {
            label: otherHospital ? `Switch to ${HOSPITAL_CONFIGS[otherHospital].fullName}` : 'Switch hospital',
            onClick: otherHospital
              ? () => {
                  switchHospital(otherHospital);
                  toast.success(`Switched to ${HOSPITAL_CONFIGS[otherHospital].fullName}`);
                }
              : undefined,
          },
          { label: `Current: ${hospitalConfig.name} Hospital` },
          ...companies.map((c: any) => ({ label: `· ${c.company_name}` })),
          { label: 'Gateway of Tally', onClick: () => onGoTo('gateway') },
        ],
      },
      {
        key: 'Y',
        label: 'Data',
        items: [
          { label: 'Import / Export (Tally XML)', onClick: () => onGoTo('tally-import-export') },
          { label: 'Statistics', onClick: () => onGoTo('statistics') },
          { label: 'Edit Log (audit trail)', onClick: () => onGoTo('edit-log') },
          { label: 'Exception Reports', onClick: () => onGoTo('exception-reports') },
        ],
      },
      {
        key: 'Z',
        label: 'Exchange',
        items: [
          {
            label: syncing ? 'Syncing latest from Tally…' : 'Sync latest from Tally',
            onClick: syncEnabled && !syncing ? () => void syncLatest() : undefined,
          },
          { label: 'Tally Live (gateway sync)', onClick: () => onGoTo('tally-live') },
          { label: 'Export vouchers to Tally', onClick: () => onGoTo('tally-import-export') },
          { label: 'Import masters from Tally', onClick: () => onGoTo('tally-import-export') },
        ],
      },
      { key: 'O', label: 'Import', action: () => onGoTo('tally-import-export') },
      { key: 'E', label: 'Export', action: () => onGoTo('tally-import-export') },
      {
        key: 'M',
        label: 'Share',
        action: () => {
          navigator.clipboard
            .writeText(window.location.href)
            .then(() => toast.success('Link copied — share it with your team'))
            .catch(() => toast.error('Could not copy the link'));
        },
      },
      { key: 'P', label: 'Print', action: () => window.print() },
      { key: 'F1', label: 'Help', action: () => setHelpOpen(true) },
      { key: 'F12', label: 'Configure', action: () => setConfigOpen(true) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [otherHospital, hospitalConfig.name, companies, onGoTo, switchHospital, syncLatest, syncing, syncEnabled],
  );

  const activeMenu = menus.find((m) => m.key === openMenu);
  const activeItems = activeMenu?.items?.filter((it) => it.onClick) ?? [];

  const openTopMenu = (key: string) => {
    setOpenMenu((m) => (m === key ? null : key));
    setMenuHighlight(0);
  };

  // While a drop-down is open the screen behind it stops answering its hotkeys
  useTopMenuOwnsKeyboard(openMenu !== null);

  // Alt+F focuses the finder; the top-bar letters open their menus; an open
  // menu is walked with the arrow keys — Tally never needs the mouse here.
  useEffect(() => {
    const onHelp = () => setHelpOpen(true);
    const onConfigure = () => setConfigOpen(true);
    const onFeatures = () => setFeaturesOpen(true);
    window.addEventListener('tally-help', onHelp);
    window.addEventListener('tally-configure', onConfigure);
    window.addEventListener('tally-features', onFeatures);
    const onKey = (e: KeyboardEvent) => {
      if (tallyModalIsOpen()) return;
      if (e.altKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
      // F12 with or without Alt — Chrome keeps F12 for DevTools, Alt+F12 is ours
      if (e.key === 'F12') {
        e.preventDefault();
        setConfigOpen(true);
        return;
      }
      // F11: Features — Tally's company feature switches
      if (e.key === 'F11') {
        e.preventDefault();
        setFeaturesOpen(true);
        return;
      }
      if (openMenu) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          setMenuHighlight((h) =>
            Math.max(0, Math.min(activeItems.length - 1, h + (e.key === 'ArrowDown' ? 1 : -1))),
          );
          return;
        }
        if (e.key === 'Enter' && activeItems[menuHighlight]) {
          e.preventDefault();
          setOpenMenu(null);
          activeItems[menuHighlight].onClick?.();
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setOpenMenu(null);
          return;
        }
      }
      if (isTypingTarget(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
      // The screen in front owns its letters. TallyScreen binds in the capture
      // phase and preventDefaults whatever it claims, so without this guard a
      // screen key that happens to collide with a top-bar letter fired both:
      // on the Gateway, "P" opened Profit & Loss *and* the print dialog, and
      // "M"/"K"/"E"/"O" misfired the same way.
      if (e.defaultPrevented) return;
      // Every top-bar button answers its key — the drop-downs (K/Y/Z) open,
      // and the direct actions (O/E/M/P/F1) just run. Previously only the
      // drop-downs were bound, which left P: Print and F1: Help unreachable.
      const hit = menus.find((m) => m.key.toUpperCase() === e.key.toUpperCase());
      if (hit) {
        e.preventDefault();
        if (hit.items) openTopMenu(hit.key);
        else hit.action?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('tally-help', onHelp);
      window.removeEventListener('tally-configure', onConfigure);
      window.removeEventListener('tally-features', onFeatures);
    };
  }, [menus, openMenu, menuHighlight, activeItems]);

  const menu = ({ key, label, action, items }: TopMenu) => (
    <div key={key} className="relative">
      <button
        type="button"
        onClick={() => (items ? openTopMenu(key) : action?.())}
        disabled={!action && !items}
        className={`px-4 py-0.5 text-[13px] ${
          action || items ? 'text-white hover:bg-[#1d5aa8]' : 'cursor-default text-[#9db8d8]'
        } ${openMenu === key ? 'bg-[#1d5aa8]' : ''}`}
      >
        <span className="underline">{key}</span>: {label}
      </button>
      {items && openMenu === key && (
        <div className="absolute left-0 z-50 min-w-[220px] border border-[#0d2f5c] bg-[#eef3fa] shadow-lg">
          {items.map((it, i) => {
            const activeIndex = activeItems.indexOf(it);
            return (
              <button
                key={i}
                type="button"
                disabled={!it.onClick}
                onMouseEnter={() => activeIndex >= 0 && setMenuHighlight(activeIndex)}
                onClick={() => {
                  setOpenMenu(null);
                  it.onClick?.();
                }}
                className={`block w-full px-3 py-1 text-left text-[13px] ${
                  it.onClick
                    ? `text-black hover:bg-[#fdd835] ${activeIndex === menuHighlight ? 'bg-[#fdd835]' : ''}`
                    : 'cursor-default text-gray-400'
                }`}
              >
                {it.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div style={TALLY_FONT} className="overflow-x-hidden bg-[#16437e] print:hidden">
      {/* Row 1: logo + centred finder */}
      <div className="relative flex items-center px-3 pt-1">
        <button
          type="button"
          onClick={() => onGoTo('gateway')}
          title="Gateway of Tally"
          className="text-left leading-none text-white"
        >
          <div className="text-xl italic" style={{ fontFamily: '"Brush Script MT", "Snell Roundhand", cursive' }}>
            Adamrit
          </div>
          <div className="text-[11px] tracking-wide">
            Prime <span className="font-bold text-[#e8b923]">ACCOUNTS</span>
          </div>
        </button>
        <div className="absolute left-1/2 top-1 w-[440px] -translate-x-1/2">
          <div className="relative">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
                setHighlight(0);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setHighlight((h) => Math.min(h + 1, matches.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setHighlight((h) => Math.max(h - 1, 0));
                } else if (e.key === 'Enter' && matches[highlight]) {
                  e.preventDefault();
                  go(matches[highlight].id);
                } else if (e.key === 'Escape') {
                  setOpen(false);
                  inputRef.current?.blur();
                }
              }}
              placeholder="🔍  Find details entered in masters and transactions. (Alt+F)"
              className="h-7 w-full border border-[#0d2f5c] bg-[#e9f0fa] px-3 text-center text-[13px] text-[#16437e] placeholder:text-[#16437e] focus:bg-white focus:outline-none"
            />
            {open && query.trim() && matches.length > 0 && (
              <div className="absolute z-50 mt-0.5 max-h-72 w-full overflow-y-auto border bg-[#eef3fa] shadow-lg">
                {matches.map((m, i) => (
                  <button
                    key={m.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => go(m.id)}
                    onMouseEnter={() => setHighlight(i)}
                    className={`block w-full px-3 py-1 text-left text-[13px] ${i === highlight ? 'bg-[#fdf6d8]' : ''}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Row 2: menu */}
      <div className="flex items-center justify-center pb-0.5 pt-1" onMouseLeave={() => setOpenMenu(null)}>
        {menus.slice(0, 3).map(menu)}
        <span className="mx-2 border border-[#0d2f5c] bg-[#e9f0fa] px-4 py-0.5 text-[13px] font-semibold text-[#16437e]">
          <button type="button" onClick={() => inputRef.current?.focus()}>
            <span className="underline">G</span>: Go To
          </button>
        </span>
        {menus.slice(3).map(menu)}
      </div>
      {helpOpen && <TallyHelp onClose={() => setHelpOpen(false)} />}
      {configOpen && <TallyConfigure onClose={() => setConfigOpen(false)} />}
      {featuresOpen && <TallyFeatures onClose={() => setFeaturesOpen(false)} />}
    </div>
  );
};

/** F1 — the Tally shortcut reference. */
const SHORTCUTS: [string, string][] = [
  ['Alt+F', 'Go To — find and open any screen'],
  ['↑ ↓', 'Move the row cursor · PgUp/PgDn, Home/End jump'],
  ['Enter', 'Drill into the highlighted row'],
  ['Esc', 'Back one screen (or to the Gateway of Tally)'],
  ['F2', 'Date / Period'],
  ['F3', 'Switch company'],
  ['F4', 'The screen\'s main filter (group, ledger, party, voucher type)'],
  ['F5', 'The screen\'s second filter / Ledger-wise toggle'],
  ['F6 – F10', 'Screen actions, then quick jumps to the other reports'],
  ['F11', 'Features — company-level switches'],
  ['Ctrl+B', 'Basis of Values — scale, paise, hide zero / small balances'],
  ['Ctrl+H', 'Change View — Detailed / Condensed and related reports'],
  ['Ctrl+J', 'Exception Reports'],
  ['Ctrl+L', 'Save View — open the module here next time'],
  ['F', 'Apply Filter'],
  ['Ctrl+F', 'Filter Details — see and clear active filters'],
  ['Alt+C', 'New Column — compare with another period'],
  ['Alt+A', 'Alter Column — change the last column\'s period'],
  ['Alt+D', 'Delete Column'],
  ['Alt+N', 'Auto Column — monthly / quarterly / yearly breakup'],
  ['Space', 'Select the highlighted line'],
  ['Alt+R / Alt+U', 'Remove / restore a line'],
  ['Ctrl+Enter', 'Alter the highlighted voucher'],
  ['Alt+A / Alt+2 / Alt+I', 'Add / duplicate / insert a voucher'],
  ['Q', 'Quit / clear the form'],
  ['Alt+X', 'Cancel voucher (in alteration)'],
  ['E', 'Export (Excel, where available)'],
  ['P', 'Print — clean report / formal A4 voucher'],
  ['Alt+F12', 'Configure — report options for the screen you are on'],
];

const TallyHelp: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useTallyModal();
  // Esc closes the overlay before any screen-level Esc handling runs
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
  <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={onClose}>
    <div
      style={TALLY_FONT}
      className="max-h-[80vh] w-[520px] overflow-y-auto border border-[#9db8d8] bg-[#fffefb] shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center bg-[#16437e] px-3 py-1 text-[13px] font-semibold text-white">
        Help — Tally Shortcuts
        <button type="button" onClick={onClose} className="ml-auto px-1 font-bold hover:text-red-300">
          ✕
        </button>
      </div>
      <div className="p-3 text-[13px]">
        {SHORTCUTS.map(([key, what]) => (
          <div key={key} className="flex border-b border-dashed border-gray-200 py-0.5">
            <div className="w-20 shrink-0 font-mono font-bold text-[#16437e]">{key}</div>
            <div>{what}</div>
          </div>
        ))}
        <div className="pt-2 text-[11px] italic text-gray-500">
          Buttons on the right rail show their shortcut before the label — press the key or click.
          <br />
          The bare letters (B, H, J, L, C, A, D, N, A, 2, I, X, R, U) still work as before, so
          nothing you already know has changed.
          <br />
          Chrome keeps F12 for its developer tools and will not release it: use Alt+F12 (or the
          F12: Configure button) for Configure.
        </div>
      </div>
    </div>
  </div>
  );
};

const TallyConfigure: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useTallyModal();
  const [cfg, setCfg] = useState(getTallyConfig());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const set = (patch: Partial<typeof cfg>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    localStorage.setItem('tally-config', JSON.stringify(next));
  };

  const yn = (v: boolean, onToggle: () => void) => (
    <button type="button" onClick={onToggle} className="min-w-[44px] border-b border-dashed border-gray-400 px-2 text-left font-semibold hover:bg-[#fdf6d8]">
      {v ? 'Yes' : 'No'}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        style={TALLY_FONT}
        className="w-[440px] border border-[#9db8d8] bg-[#fffefb] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center bg-[#16437e] px-3 py-1 text-[13px] font-semibold text-white">
          F12: Configure
          <button type="button" onClick={onClose} className="ml-auto px-1 font-bold hover:text-red-300">✕</button>
        </div>
        <div className="space-y-1 p-3 text-[13px]">
          <div className="flex items-center justify-between gap-4">
            <span>Open reports in Detailed mode</span>
            {yn(cfg.defaultDetailed, () => set({ defaultDetailed: !cfg.defaultDetailed }))}
          </div>
          <div className="flex items-center justify-between gap-4">
            <span>Day Book shows the whole month (not just today)</span>
            {yn(cfg.dayBookMonth, () => set({ dayBookMonth: !cfg.dayBookMonth }))}
          </div>
          <div className="pt-2 text-[11px] italic text-gray-500">
            Applies when a report opens next. Settings are saved on this device.
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * F11: Features — Tally's company-level switches. Only the switches this
 * module can actually honour are listed; Tally greys the rest the same way.
 */
export interface TallyFeatureFlags {
  billWise: boolean;
  costCentres: boolean;
  postDated: boolean;
  auditTrail: boolean;
}

const DEFAULT_FEATURES: TallyFeatureFlags = {
  billWise: true,
  costCentres: true,
  postDated: true,
  auditTrail: true,
};

export const getTallyFeatures = (): TallyFeatureFlags => {
  try {
    return { ...DEFAULT_FEATURES, ...JSON.parse(localStorage.getItem('tally-features') || '{}') };
  } catch {
    return { ...DEFAULT_FEATURES };
  }
};

const TallyFeatures: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useTallyModal();
  const [flags, setFlags] = useState(getTallyFeatures);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const set = (patch: Partial<TallyFeatureFlags>) => {
    const next = { ...flags, ...patch };
    setFlags(next);
    localStorage.setItem('tally-features', JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('tally-features-changed'));
  };

  const row = (label: string, key: keyof TallyFeatureFlags) => (
    <div className="flex items-center justify-between gap-4">
      <span>{label}</span>
      <button
        type="button"
        onClick={() => set({ [key]: !flags[key] } as Partial<TallyFeatureFlags>)}
        className="min-w-[44px] border-b border-dashed border-gray-400 px-2 text-left font-semibold hover:bg-[#fdf6d8]"
      >
        {flags[key] ? 'Yes' : 'No'}
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        style={TALLY_FONT}
        className="w-[460px] border border-[#9db8d8] bg-[#fffefb] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center bg-[#16437e] px-3 py-1 text-[13px] font-semibold text-white">
          F11: Company Features
          <button type="button" onClick={onClose} className="ml-auto px-1 font-bold hover:text-red-300">✕</button>
        </div>
        <div className="p-3 text-[13px]">
          <div className="mb-1 font-semibold tracking-wide text-[#16437e]">ACCOUNTING FEATURES</div>
          <div className="space-y-1">
            {row('Maintain Bill-wise details', 'billWise')}
            {row('Maintain Cost Centres', 'costCentres')}
            {row('Allow Post-Dated vouchers', 'postDated')}
            {row('Maintain Edit Log (audit trail)', 'auditTrail')}
          </div>
          <div className="mt-3 mb-1 font-semibold tracking-wide text-gray-400">INVENTORY FEATURES</div>
          <div className="space-y-1 text-gray-400">
            <div className="flex items-center justify-between gap-4"><span>Maintain Inventory</span><span className="min-w-[44px] px-2 font-semibold">No</span></div>
            <div className="flex items-center justify-between gap-4"><span>Integrate Accounts with Inventory</span><span className="min-w-[44px] px-2 font-semibold">No</span></div>
          </div>
          <div className="pt-2 text-[11px] italic text-gray-500">
            Inventory is not part of this installation. Settings are saved on this device.
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * The line every Tally report opens with: the report's name on the left and
 * the period it covers on the right — "Day Book … For 24-Jul-26".
 */
export const TallyReportHeader: React.FC<{ title: string; period: string }> = ({ title, period }) => (
  <div className="flex items-baseline justify-between px-1 pb-1 pt-0.5">
    <span className="text-[15px] font-bold">{title}</span>
    <span className="font-semibold">{period}</span>
  </div>
);

interface TallyScreenProps {
  /** Screen title in the light-blue strip, e.g. "Balance Sheet" */
  title: string;
  rail?: RailItem[];
  bottomBar?: BottomBarItem[];
  onClose?: () => void;
  /** Override the close button label (default "✕") */
  closeLabel?: string;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}

export const TallyScreen: React.FC<TallyScreenProps> = ({ title, rail: railProp = [], bottomBar, onClose, closeLabel, headerAction, children }) => {
  const { hospitalConfig } = useAuth();
  const accountingCompany = useAccountingCompanyOptional();
  const periodContext = useAccountingPeriodOptional();
  // Stable, so the default key bar below (and the hotkey binding that reads it)
  // is not rebuilt on every render.
  const handleClose = useCallback(
    () => (onClose ? onClose() : window.dispatchEvent(new CustomEvent('tally-escape'))),
    [onClose],
  );
  const closeText = closeLabel || '✕';
  const selectedCompanyName = accountingCompany?.companies.find(
    (company) => company.id === accountingCompany.selectedCompanyId,
  )?.company_name;
  const headerCompanyName = selectedCompanyName || `${hospitalConfig.name} Hospital`;

  // Tally keeps every button live — give the common placeholders real actions.
  // Callers own rail actions. Disabled items stay disabled and never activate
  // a fallback screen or action from this shared component.
  const hasCompanySwitch = railProp.some((item) => item.hotkey === 'F3');
  const rail = accountingCompany && !hasCompanySwitch
    ? [{ hotkey: 'F3', label: 'Company', onClick: accountingCompany.cycleCompany }, ...railProp]
    : railProp;

  // Tally's key bar. A screen that supplies none still gets Quit / Back / Help
  // / Print — and these must be real hotkeys, not just buttons: they used to be
  // rendered inline and never reached the binder, so pressing Q or P did
  // nothing on every screen that relied on the default bar.
  const defaultBottomBar = useMemo<BottomBarItem[]>(
    () => [
      { hotkey: 'Q', label: 'Quit', onClick: handleClose },
      { hotkey: 'Esc', label: 'Back', onClick: handleClose },
      { hotkey: 'F1', label: 'Help', onClick: () => window.dispatchEvent(new CustomEvent('tally-help')) },
      { hotkey: 'P', label: 'Print', onClick: () => window.print() },
    ],
    [handleClose],
  );
  const bar = bottomBar && bottomBar.length > 0 ? bottomBar : defaultBottomBar;
  const isDefaultBar = bar === defaultBottomBar;

  // Take the keyboard when a screen opens. Without this the sidebar button
  // that opened it keeps focus, so Enter re-clicks that button and the arrow
  // keys scroll the page instead of walking the report's rows.
  const contentRef = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    if (active && contentRef.current?.contains(active)) return;
    if (isTypingTarget(active)) return;
    active?.blur();
    contentRef.current?.focus({ preventScroll: true });
  }, [title]);

  // Bind F-key / letter hotkeys declared by the rail + bottom bar.
  //
  // Precedence, highest first: a pop-up or an open top-bar menu owns the
  // keyboard → Esc closes the screen → the bottom bar → the rail. The bottom
  // bar is searched first because its keys are the screen's own actions, while
  // the rail carries the generic report keys (C/A/D/N) that Tally does not even
  // show on a voucher listing.
  useEffect(() => {
    // One key, one action. A screen legitimately shows the same button in two
    // places — F1: Help sits on both the key bar and the rail — so bind the
    // first and drop the rest rather than letting the loop below match twice.
    const seen = new Map<string, string>();
    const items: (RailItem | BottomBarItem)[] = [];
    for (const item of [...bar, ...rail]) {
      if (!item.hotkey) {
        items.push(item);
        continue;
      }
      const key = `${item.mod ?? ''}+${item.hotkey.toUpperCase()}`;
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, item.label);
        items.push(item);
        continue;
      }
      // Same key, same button — a deliberate duplicate, nothing to report.
      if (import.meta.env.DEV && first !== item.label) {
        console.warn(
          `[Tally] "${title}" binds ${hotkeyLabel(item.hotkey, item.mod)} to two different actions — ` +
            `"${first}" wins, "${item.label}" is unreachable by keyboard.`,
        );
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      // A pop-up or an open top-bar drop-down owns the keyboard
      if (tallyModalIsOpen() || tallyTopMenuIsOpen()) return;
      const typing = isTypingTarget(e.target);
      // The browser's own F-key actions (F3 find, F5 reload, F7 caret
      // browsing, F10 menu, F11 fullscreen) must never fire over a report.
      // F12 is the one Chrome refuses to release — Alt+F12 covers Configure.
      if (/^F([1-9]|1[01])$/.test(e.key)) e.preventDefault();
      // Tally's Esc: step back one level — close this screen if it can close,
      // otherwise let the page fall back to the Gateway.
      if (e.key === 'Escape' && !typing) {
        e.preventDefault();
        e.stopPropagation();
        if (onClose) onClose();
        else window.dispatchEvent(new CustomEvent('tally-escape'));
        return;
      }
      // Enter belongs to whatever is focused — a rail or bar button handles its
      // own Enter, and the row cursor drills into the highlighted line.
      const active = document.activeElement as HTMLElement | null;
      const focusedControl = !!active && (active.tagName === 'BUTTON' || active.tagName === 'A');

      for (const item of items) {
        if (!item.hotkey) continue;
        // Letter hotkeys only fire outside inputs; F-keys fire anywhere.
        const isFKey = /^F\d+$/.test(item.hotkey.toUpperCase());
        if (!isFKey && typing) continue;
        if (!itemMatches(e, item)) continue;
        if (item.hotkey.toUpperCase() === 'ENTER' && focusedControl) return;
        // A key the screen declares but cannot act on is still swallowed, so
        // Space never scrolls the report out from under the cursor.
        e.preventDefault();
        if (item.disabled || !item.onClick) return;
        e.stopPropagation();
        item.onClick();
        return;
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
    };
  }, [rail, bar, onClose, title]);

  return (
    <div style={TALLY_FONT} className="flex min-h-[calc(100vh-64px)] flex-col border border-[#9db8d8] bg-[#fffefb]">
      {/* Title strip */}
      <div className="relative flex items-center gap-2 bg-[#cfe0f1] px-2 py-0.5 text-[13px] leading-5">
        <span className="min-w-0 truncate font-semibold text-black">{title}</span>
        <span className="absolute left-1/2 -translate-x-1/2 truncate px-2 font-bold" title={headerCompanyName}>
          {headerCompanyName}
        </span>
        {headerAction}
        <button type="button" onClick={handleClose} className="px-1 font-bold text-black hover:text-red-600" aria-label="Close">
          {closeText}
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Content — focusable so the report owns the keyboard, not the sidebar */}
        <div ref={contentRef} tabIndex={-1} className="min-w-0 flex-1 overflow-auto outline-none">
          {children}
        </div>

        {/* Right button rail */}
        {rail.length > 0 && (
          <div className="w-48 shrink-0 border-l border-[#9db8d8] bg-[#e4eefa] print:hidden">
            {rail.map((item, i) => (
              <div key={`${item.label}-${i}`} className={item.gapBefore ? 'mt-4' : ''}>
                <button
                  type="button"
                  onClick={item.onClick}
                  disabled={item.disabled || !item.onClick}
                  className={`flex min-h-8 w-full items-center border-b border-white px-2 py-1 text-left text-[13px] leading-4 ${
                    item.active
                      ? 'bg-[#16437e] font-semibold text-white'
                      : item.disabled || !item.onClick
                        ? 'cursor-default text-[#8fa8c8]'
                        : 'text-black hover:bg-[#fdf6d8]'
                  }`}
                >
                  {item.hotkey && (
                    <span
                      className={`inline-flex min-w-[44px] shrink-0 pr-1 font-semibold ${
                        item.active ? 'text-white' : 'text-[#1d5aa8]'
                      }`}
                    >
                      <span className="underline">{hotkeyLabel(item.hotkey, item.mod)}</span>
                      {item.label ? ':' : ''}{' '}
                    </span>
                  )}
                  <span className="min-w-0 truncate">{item.label}</span>
                  {/* Tally's rail buttons all carry a right-edge chevron */}
                  <span className={`ml-auto shrink-0 pl-1 ${item.active ? 'text-white' : 'text-[#8fa8c8]'}`}>‹</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom action bar — Tally always shows the key bar */}
      <div className="flex items-stretch gap-px border-t border-[#9db8d8] bg-[#cfe0f1] px-1 py-0.5 print:hidden">
        {bar.map((b) => (
          <button
            key={`${b.mod ?? ''}${b.hotkey}`}
            type="button"
            onClick={b.onClick}
            disabled={b.disabled || !b.onClick}
            className={`flex min-h-8 items-center overflow-hidden whitespace-nowrap border border-[#9db8d8] bg-white py-0.5 text-[13px] ${
              isDefaultBar ? 'px-3' : 'flex-1 justify-center px-1'
            } ${b.disabled || !b.onClick ? 'cursor-default text-[#8fa8c8]' : 'text-black hover:bg-[#fdf6d8]'}`}
          >
            <span className="shrink-0 pr-1 font-semibold text-[#1d5aa8]">
              <span className="underline">{hotkeyLabel(b.hotkey, b.mod)}</span>:
            </span>
            <span className="truncate">{b.label}</span>
          </button>
        ))}
        {isDefaultBar && (
          <span className="ml-auto self-center pr-2 text-[11px] italic text-[#5b7aa0]">
            Alt+F: Go To · Alt+F12: Configure
          </span>
        )}
      </div>

      {/*
        Tally's status line, under the key bar: the company you are in, the
        Current Period and Current Date, and the calculator toggle on the right.
      */}
      <div className="flex items-center gap-3 border-t border-[#9db8d8] bg-[#e4eefa] px-2 py-0.5 text-[11px] text-[#16437e] print:hidden">
        <span className="min-w-0 truncate font-semibold">{headerCompanyName}</span>
        {periodContext && (
          <>
            <span className="text-[#8fa8c8]">|</span>
            <span className="shrink-0">
              Current Period <span className="font-semibold">{labelOfPeriod(periodContext.period)}</span>
            </span>
            <span className="text-[#8fa8c8]">|</span>
            <span className="shrink-0">
              Current Date <span className="font-semibold">{dayLabel(periodContext.currentDate)}</span>
            </span>
          </>
        )}
        <span className="ml-auto shrink-0 italic text-[#5b7aa0]">Ctrl+N: Calculator · Ctrl+M: Panel</span>
      </div>
    </div>
  );
};


