import { ArrowDown, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import type { ImportAccent } from './importAccents';

/**
 * The lanes, laid out above the fold so landing on the page tells you what it
 * holds without scrolling through it.
 *
 * The page is long — one CSV import alone runs to five tables — so the second
 * CSV lane sat far below anything you could see, and people did not know it
 * was there. Each card carries its lane's colour and icon, so following a card
 * down to its section is a matter of matching the colour.
 *
 * A lane with `to` set does not live on this page at all: it opens its own
 * screen. It is drawn the same way, but with an arrow that points out rather
 * than down, so a card that navigates away never looks like a card that jumps.
 */
export interface ImportLane {
  accent: ImportAccent;
  title: string;
  hint: string;
  /** Route to open. Omit for a lane that is a section further down this page. */
  to?: string;
}

export function ImportLaneCards({ lanes }: { lanes: ImportLane[] }) {
  return (
    <nav aria-label="Uploads on this page" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {lanes.map(({ accent, title, hint, to }) => {
        const Icon = accent.icon;
        const className = cn(
          'group relative overflow-hidden rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md',
          accent.ring,
        );

        const body = (
          <>
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
            {to ? (
              <ArrowRight className="absolute bottom-3 right-3 h-4 w-4 text-gray-300 transition-transform group-hover:translate-x-0.5 group-hover:text-gray-500" />
            ) : (
              <ArrowDown className="absolute bottom-3 right-3 h-4 w-4 text-gray-300 transition-transform group-hover:translate-y-0.5 group-hover:text-gray-500" />
            )}
          </>
        );

        return to ? (
          <Link key={accent.id} to={to} className={className}>
            {body}
          </Link>
        ) : (
          <a key={accent.id} href={`#${accent.id}`} className={className}>
            {body}
          </a>
        );
      })}
    </nav>
  );
}
