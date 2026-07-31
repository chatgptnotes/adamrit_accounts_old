import { ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ImportAccent } from './importAccents';

/**
 * The four lanes, laid out above the fold so landing on the page tells you
 * what it holds without scrolling through it.
 *
 * The page is long — one CSV import alone runs to five tables — so the second
 * CSV lane sat far below anything you could see, and people did not know it
 * was there. Each card carries its lane's colour and icon, so following a card
 * down to its section is a matter of matching the colour.
 */
export function ImportLaneCards({ lanes }: { lanes: { accent: ImportAccent; title: string; hint: string }[] }) {
  return (
    <nav aria-label="Uploads on this page" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {lanes.map(({ accent, title, hint }) => {
        const Icon = accent.icon;
        return (
          <a
            key={accent.id}
            href={`#${accent.id}`}
            className={cn(
              'group relative overflow-hidden rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md',
              accent.ring,
            )}
          >
            <div className={cn('absolute inset-x-0 top-0 h-1', accent.bar)} aria-hidden="true" />
            <div className="flex items-start gap-3 pt-1">
              <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', accent.chip)}>
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <span
                  className={cn(
                    'inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                    accent.chip,
                  )}
                >
                  {accent.kindLabel}
                </span>
                <div className="mt-1 truncate text-sm font-semibold text-gray-900" title={title}>
                  {title}
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-gray-500">{hint}</p>
              </div>
            </div>
            <ArrowDown className="absolute bottom-3 right-3 h-4 w-4 text-gray-300 transition-transform group-hover:translate-y-0.5 group-hover:text-gray-500" />
          </a>
        );
      })}
    </nav>
  );
}
