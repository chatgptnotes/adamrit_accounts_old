import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { HOSPITAL_CONFIGS, type HospitalType } from '@/types/hospital';
import { useCompanies } from '@/hooks/useCompanies';
import { useAccountingCompanyOptional } from '../AccountingCompanyContext';
import { companyKey } from '@/lib/tallyCompanyMatch';

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

export interface RailItem {
  /** Shortcut label shown in blue, e.g. "F5" or "A" */
  hotkey?: string;
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
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}

interface TallyTopBarProps {
  /** Section names for the Alt+F / Go To jump list */
  sections: { id: string; label: string }[];
  onGoTo: (id: string) => void;
}

const TallySyncButton: React.FC = () => {
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

  return (
    <button
      type="button"
      onClick={() => void syncLatest()}
      disabled={syncing || selectedTallyConfig?.auto_sync_enabled !== true}
      className="mr-3 inline-flex items-center gap-1 border border-[#6f8fb5] bg-[#e9f0fa] px-2 py-0.5 text-[12px] font-semibold text-[#16437e] hover:bg-white disabled:cursor-default disabled:opacity-60"
      title="Fetch and save latest data for the selected Accounting company"
    >
      <RefreshCw className={`h-3 w-3 ${syncing ? 'animate-spin' : ''}`} />
      {syncing ? 'Syncing...' : selectedTallyConfig?.auto_sync_enabled === true ? 'Sync Latest' : 'Sync Disabled'}
    </button>
  );
};

export const TallyTopBar: React.FC<TallyTopBarProps> = ({ sections, onGoTo }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const { user, switchHospital, hospitalConfig } = useAuth();
  const { data: companies = [] } = useCompanies();

  const otherHospital = (Object.keys(HOSPITAL_CONFIGS) as HospitalType[]).find((h) => h !== user?.hospitalType);

  // Alt+F focuses the finder, like Tally
  useEffect(() => {
    const onHelp = () => setHelpOpen(true);
    const onConfigure = () => setConfigOpen(true);
    window.addEventListener('tally-help', onHelp);
    window.addEventListener('tally-configure', onConfigure);
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'F12') {
        e.preventDefault();
        setConfigOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('tally-help', onHelp);
      window.removeEventListener('tally-configure', onConfigure);
    };
  }, []);

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

  // Tally Prime's top-bar buttons each drop a menu of destinations.
  const menu = (key: string, label: string, action?: () => void, items?: { label: string; onClick?: () => void }[]) => (
    <div key={key} className="relative">
      <button
        type="button"
        onClick={() => {
          if (items) setOpenMenu((m) => (m === key ? null : key));
          else action?.();
        }}
        disabled={!action && !items}
        className={`px-4 py-0.5 text-[13px] ${
          action || items ? 'text-white hover:bg-[#1d5aa8]' : 'cursor-default text-[#9db8d8]'
        } ${openMenu === key ? 'bg-[#1d5aa8]' : ''}`}
      >
        <span className="underline">{key}</span>: {label}
      </button>
      {items && openMenu === key && (
        <div className="absolute left-0 z-50 min-w-[220px] border border-[#0d2f5c] bg-[#eef3fa] shadow-lg">
          {items.map((it, i) => (
            <button
              key={i}
              type="button"
              disabled={!it.onClick}
              onClick={() => {
                setOpenMenu(null);
                it.onClick?.();
              }}
              className={`block w-full px-3 py-1 text-left text-[13px] ${
                it.onClick ? 'text-black hover:bg-[#fdd835]' : 'cursor-default text-gray-400'
              }`}
            >
              {it.label}
            </button>
          ))}
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
        <div className="ml-auto flex items-center">
          <TallySyncButton />
        </div>
      </div>
      {/* Row 2: menu */}
      <div className="flex items-center justify-center pb-0.5 pt-1" onMouseLeave={() => setOpenMenu(null)}>
        {menu('K', 'Company', undefined, [
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
        ])}
        {menu('Y', 'Data', undefined, [
          { label: 'Import / Export (Tally XML)', onClick: () => onGoTo('tally-import-export') },
          { label: 'Statistics', onClick: () => onGoTo('statistics') },
          { label: 'Edit Log (audit trail)', onClick: () => onGoTo('edit-log') },
          { label: 'Exception Reports', onClick: () => onGoTo('exception-reports') },
        ])}
        {menu('Z', 'Exchange', undefined, [
          { label: 'Tally Live (gateway sync)', onClick: () => onGoTo('tally-live') },
          { label: 'Export vouchers to Tally', onClick: () => onGoTo('tally-import-export') },
          { label: 'Import masters from Tally', onClick: () => onGoTo('tally-import-export') },
        ])}
        <span className="mx-2 border border-[#0d2f5c] bg-[#e9f0fa] px-4 py-0.5 text-[13px] font-semibold text-[#16437e]">
          <button type="button" onClick={() => inputRef.current?.focus()}>
            <span className="underline">G</span>: Go To
          </button>
        </span>
        {menu('O', 'Import', () => onGoTo('tally-import-export'))}
        {menu('E', 'Export', () => onGoTo('tally-import-export'))}
        {menu('M', 'Share', () => {
          navigator.clipboard
            .writeText(window.location.href)
            .then(() => toast.success('Link copied — share it with your team'))
            .catch(() => toast.error('Could not copy the link'));
        })}
        {menu('P', 'Print', () => window.print())}
        {menu('F1', 'Help', () => setHelpOpen(true))}
        {menu('F12', 'Configure', () => setConfigOpen(true))}
      </div>
      {helpOpen && <TallyHelp onClose={() => setHelpOpen(false)} />}
      {configOpen && <TallyConfigure onClose={() => setConfigOpen(false)} />}
    </div>
  );
};

/** F1 — the Tally shortcut reference. */
const SHORTCUTS: [string, string][] = [
  ['Alt+F', 'Go To — find and open any screen'],
  ['Esc', 'Back one screen (or to the Gateway of Tally)'],
  ['F2', 'Date / Period'],
  ['F3', 'Switch company (Hope ↔ Ayushman)'],
  ['F4', 'Contra voucher · or the screen\'s filter (party, type, ledger)'],
  ['F5', 'Payment voucher · Ledger-wise / Status toggles'],
  ['F6', 'Receipt voucher · Age wise analysis'],
  ['F7', 'Journal voucher'],
  ['F8', 'Sales voucher'],
  ['F9', 'Purchase voucher'],
  ['C', 'New Column — compare with another period'],
  ['H', 'Detailed / Condensed toggle'],
  ['A', 'Accept (save)'],
  ['Q', 'Quit / clear the form'],
  ['X', 'Cancel voucher (in alteration)'],
  ['D', 'Delete voucher (in alteration)'],
  ['E', 'Export (Excel, where available)'],
  ['P', 'Print — clean report / formal A4 voucher'],
  ['F12', 'Configure — detailed-by-default, Day Book month view'],
  ['L / T', 'Optional / Post-Dated voucher (in voucher entry)'],
];

const TallyHelp: React.FC<{ onClose: () => void }> = ({ onClose }) => {
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
        </div>
      </div>
    </div>
  </div>
  );
};

const TallyConfigure: React.FC<{ onClose: () => void }> = ({ onClose }) => {
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
  const handleClose = onClose ?? (() => window.dispatchEvent(new CustomEvent('tally-escape')));
  const closeText = closeLabel || '← Back';
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

  // Bind F-key / letter hotkeys declared by the rail + bottom bar
  useEffect(() => {
    const items = [...rail, ...(bottomBar ?? [])];
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      // Tally's Esc: step back one level — close this screen if it can close,
      // otherwise let the page fall back to the Gateway.
      if (e.key === 'Escape' && !typing) {
        e.preventDefault();
        e.stopPropagation();
        if (onClose) onClose();
        else window.dispatchEvent(new CustomEvent('tally-escape'));
        return;
      }
      for (const item of items) {
        if (!item.hotkey || item.disabled || !item.onClick) continue;
        const hk = item.hotkey.toUpperCase();
        const isFKey = /^F\d+$/.test(hk);
        // Letter hotkeys only fire outside inputs; F-keys fire anywhere.
        if (isFKey ? e.key.toUpperCase() === hk : !typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toUpperCase() === hk) {
          e.preventDefault();
          e.stopPropagation();
          item.onClick();
          return;
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
    };
  }, [rail, bottomBar, onClose]);

  return (
    <div style={TALLY_FONT} className="flex min-h-[calc(100vh-64px)] flex-col border border-[#9db8d8] bg-[#fffefb]">
      {/* Title strip */}
      <div className="relative flex items-center gap-2 bg-[#cfe0f1] px-2 py-0.5 text-[13px] leading-5">
        <span className="min-w-0 truncate font-semibold text-black">{title}</span>
        <span className="absolute left-1/2 -translate-x-1/2 truncate px-2 font-bold" title={headerCompanyName}>
          {headerCompanyName}
        </span>
        {headerAction}
        <button type="button" onClick={handleClose} className="px-1 font-bold text-black hover:text-red-600" aria-label={closeText}>
          {closeText}
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Content */}
        <div className="min-w-0 flex-1 overflow-auto">{children}</div>

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
                    <span className={`inline-flex w-11 shrink-0 font-semibold ${item.active ? 'text-white' : 'text-[#1d5aa8]'}`}>
                      <span className="underline">{item.hotkey}</span>:{' '}
                    </span>
                  )}
                  {item.label}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom action bar — Tally always shows the key bar */}
      {(!bottomBar || bottomBar.length === 0) && (
        <div className="flex items-stretch gap-px border-t border-[#9db8d8] bg-[#cfe0f1] px-1 py-0.5 print:hidden">
          {[
            { hotkey: 'Q', label: 'Quit', onClick: () => (onClose ? onClose() : window.dispatchEvent(new CustomEvent('tally-escape'))) },
            { hotkey: 'Esc', label: 'Back', onClick: () => (onClose ? onClose() : window.dispatchEvent(new CustomEvent('tally-escape'))) },
            { hotkey: 'F1', label: 'Help', onClick: () => window.dispatchEvent(new CustomEvent('tally-help')) },
            { hotkey: 'P', label: 'Print', onClick: () => window.print() },
          ].map((b) => (
            <button
              key={b.hotkey}
              type="button"
              onClick={b.onClick}
              className="flex min-h-8 items-center border border-[#9db8d8] bg-white px-3 py-0.5 text-[13px] text-black hover:bg-[#fdf6d8]"
            >
              <span className="inline-flex w-11 shrink-0 font-semibold text-[#1d5aa8]">
                <span className="underline">{b.hotkey}</span>:
              </span>{' '}
              {b.label}
            </button>
          ))}
          <span className="ml-auto self-center pr-2 text-[11px] italic text-[#5b7aa0]">Alt+F: Go To · F12: Configure</span>
        </div>
      )}
      {bottomBar && bottomBar.length > 0 && (
        <div className="flex items-stretch gap-px border-t border-[#9db8d8] bg-[#cfe0f1] px-1 py-0.5 print:hidden">
          {bottomBar.map((b) => (
            <button
              key={b.hotkey}
              type="button"
              onClick={b.onClick}
              disabled={b.disabled || !b.onClick}
              className={`flex min-h-8 items-center border border-[#9db8d8] bg-white px-3 py-0.5 text-[13px] ${
                b.disabled || !b.onClick ? 'cursor-default text-[#8fa8c8]' : 'text-black hover:bg-[#fdf6d8]'
              }`}
            >
              <span className="inline-flex w-11 shrink-0 font-semibold text-[#1d5aa8]">
                <span className="underline">{b.hotkey}</span>:
              </span>{' '}
              {b.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};


