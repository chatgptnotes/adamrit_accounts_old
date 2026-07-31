import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { ImportAccent } from './importAccents';

/**
 * The frame every upload lane on the import page sits in: a coloured spine
 * down the left, an icon chip in the lane's colour, the kind of upload it
 * takes, and the title.
 *
 * All four lanes used to draw their own header, and the two of each kind drew
 * them identically, so the page read as four near-identical blocks. One frame
 * means one glance is enough to know which lane you are looking at and what it
 * wants — a spreadsheet or a screenshot.
 */
export function ImportSectionShell({
  accent,
  title,
  description,
  /** "1 of 2" — which of the two lanes of this kind */
  position,
  /** Right-hand controls: Clear, Refresh */
  action,
  children,
}: {
  accent: ImportAccent;
  title: string;
  description: string;
  position: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const Icon = accent.icon;

  return (
    <section
      id={accent.id}
      // The app header is sticky, so an anchor jump must stop short of it or
      // the title lands underneath.
      className="scroll-mt-24"
    >
      <div
        className={cn(
          'relative overflow-hidden rounded-2xl border bg-white shadow-sm transition-shadow hover:shadow-md',
          accent.border,
        )}
      >
        {/* The lane's colour, carried from its card at the top of the page */}
        <div className={cn('absolute inset-y-0 left-0 w-1.5', accent.bar)} aria-hidden="true" />

        <header className="flex flex-col gap-4 border-b border-gray-100 py-5 pl-7 pr-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl', accent.chip)}>
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
                    accent.chip,
                  )}
                >
                  {accent.kindLabel}
                </span>
                <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{position}</span>
              </div>
              <h2 className={cn('mt-1.5 text-xl font-bold leading-tight', accent.title)}>{title}</h2>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-gray-500">{description}</p>
            </div>
          </div>
          {action && <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">{action}</div>}
        </header>

        <div className="py-5 pl-7 pr-5">{children}</div>
      </div>
    </section>
  );
}
