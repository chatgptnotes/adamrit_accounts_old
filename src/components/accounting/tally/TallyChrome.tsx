import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

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

export const TallyTopBar: React.FC<TallyTopBarProps> = ({ sections, onGoTo }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // Alt+F focuses the finder, like Tally
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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

  const menu = (key: string, label: string, action?: () => void) => (
    <button
      key={key}
      type="button"
      onClick={action}
      disabled={!action}
      className={`px-4 py-0.5 text-[13px] ${action ? 'text-white hover:bg-[#1d5aa8]' : 'cursor-default text-[#9db8d8]'}`}
    >
      <span className="underline">{key}</span>: {label}
    </button>
  );

  return (
    <div style={TALLY_FONT} className="bg-[#16437e] print:hidden">
      {/* Row 1: logo + centred finder */}
      <div className="relative flex items-center px-3 pt-1">
        <div className="leading-none text-white">
          <div className="text-xl italic" style={{ fontFamily: '"Brush Script MT", "Snell Roundhand", cursive' }}>
            Adamrit
          </div>
          <div className="text-[11px] tracking-wide">
            Prime <span className="font-bold text-[#e8b923]">ACCOUNTS</span>
          </div>
        </div>
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
        <div className="ml-auto" />
      </div>
      {/* Row 2: menu */}
      <div className="flex items-center justify-center pb-0.5 pt-1">
        {menu('K', 'Company')}
        {menu('Y', 'Data')}
        {menu('Z', 'Exchange')}
        <span className="mx-2 border border-[#0d2f5c] bg-[#e9f0fa] px-4 py-0.5 text-[13px] font-semibold text-[#16437e]">
          <button type="button" onClick={() => inputRef.current?.focus()}>
            <span className="underline">G</span>: Go To
          </button>
        </span>
        {menu('O', 'Import', () => onGoTo('tally-import-export'))}
        {menu('E', 'Export', () => onGoTo('tally-import-export'))}
        {menu('M', 'Share')}
        {menu('P', 'Print', () => window.print())}
        {menu('F1', 'Help')}
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
  children: React.ReactNode;
}

export const TallyScreen: React.FC<TallyScreenProps> = ({ title, rail = [], bottomBar, onClose, children }) => {
  const { hospitalConfig } = useAuth();

  // Bind F-key / letter hotkeys declared by the rail + bottom bar
  useEffect(() => {
    const items = [...rail, ...(bottomBar ?? [])];
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      for (const item of items) {
        if (!item.hotkey || item.disabled || !item.onClick) continue;
        const hk = item.hotkey.toUpperCase();
        const isFKey = /^F\d+$/.test(hk);
        // Letter hotkeys only fire outside inputs; F-keys fire anywhere.
        if (isFKey ? e.key.toUpperCase() === hk : !typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toUpperCase() === hk) {
          e.preventDefault();
          item.onClick();
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rail, bottomBar]);

  return (
    <div style={TALLY_FONT} className="flex min-h-[calc(100vh-64px)] flex-col border border-[#9db8d8] bg-[#fffefb]">
      {/* Title strip */}
      <div className="relative flex items-center bg-[#cfe0f1] px-2 py-0.5 text-[13px]">
        <span className="font-semibold text-black">{title}</span>
        <span className="absolute left-1/2 -translate-x-1/2 font-bold">{hospitalConfig.name} Hospital</span>
        {onClose && (
          <button type="button" onClick={onClose} className="ml-auto px-1 font-bold text-black hover:text-red-600" aria-label="Close">
            ✕
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Content */}
        <div className="min-w-0 flex-1 overflow-auto">{children}</div>

        {/* Right button rail */}
        {rail.length > 0 && (
          <div className="w-44 shrink-0 border-l border-[#9db8d8] bg-[#e4eefa] print:hidden">
            {rail.map((item, i) => (
              <div key={`${item.label}-${i}`} className={item.gapBefore ? 'mt-4' : ''}>
                <button
                  type="button"
                  onClick={item.onClick}
                  disabled={item.disabled || !item.onClick}
                  className={`block w-full border-b border-white px-2 py-1 text-left text-[13px] ${
                    item.active
                      ? 'bg-[#16437e] font-semibold text-white'
                      : item.disabled || !item.onClick
                        ? 'cursor-default text-[#8fa8c8]'
                        : 'text-black hover:bg-[#fdf6d8]'
                  }`}
                >
                  {item.hotkey && (
                    <span className={`font-semibold ${item.active ? 'text-white' : 'text-[#1d5aa8]'}`}>
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

      {/* Bottom action bar */}
      {bottomBar && bottomBar.length > 0 && (
        <div className="flex items-stretch gap-px border-t border-[#9db8d8] bg-[#cfe0f1] px-1 py-0.5 print:hidden">
          {bottomBar.map((b) => (
            <button
              key={b.hotkey}
              type="button"
              onClick={b.onClick}
              disabled={b.disabled || !b.onClick}
              className={`border border-[#9db8d8] bg-white px-3 py-0.5 text-[13px] ${
                b.disabled || !b.onClick ? 'cursor-default text-[#8fa8c8]' : 'text-black hover:bg-[#fdf6d8]'
              }`}
            >
              <span className="font-semibold text-[#1d5aa8]">
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
