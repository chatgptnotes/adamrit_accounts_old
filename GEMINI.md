# Adamrit — notes for Gemini CLI

Read `CLAUDE.md` as well: it carries the money-path rules, and they are not
optional.

## This is NOT a Next.js app

React + Vite, one single-page app, deployed to Vercel. No `next.config`, no
`app/` or `pages/` router, no server components. `src/pages/` is an ordinary
folder of route components; routes are declared in
`src/components/AppRoutes.tsx`.

## The landing page

    /  ->  src/components/LandingPage.tsx
              renders src/components/LandingModules.tsx   (the module list)

`src/pages/Index.tsx` is the internal dashboard shown after login. It is NOT
the landing page, and changing it will not change what a visitor sees.

### Two rules for LandingModules.tsx, both easy to break by accident

1. **NO STAFF NAMES.** The public module list must carry no person's name.
   Tiles inside the app may be named after staff ("Nisha Cash Handover"); the
   public list must not be. `scripts/check-public-labels.cjs` runs in
   `prebuild` and FAILS THE DEPLOY if a name reaches the public bundle.

2. **DO NOT import the tablet module registry into it.** Importing
   `@/tablet/config/modules` is the obvious way to build the list and it is
   wrong: it drags staff names into the public bundle and breaks rule 1. The
   file is deliberately self-contained. It looks like duplication. Leave it.

## Before you tell the user a change is done

    npm run typecheck     # ratchet; plain `tsc -p tsconfig.json` checks NOTHING
    npm run build         # runs the frozen-module lock checks in prebuild

## Frozen files

These fail the build if edited without updating their SHA256 baseline, because
each one has cost the hospital money:

    src/pages/FinalBill.tsx
    src/pages/Accounting.tsx and src/components/accounting/**
    src/pages/ExpenseBills.tsx and the expense-bill tablet flows
    the patient registration forms

Do not edit them to "tidy up". Ask first.

## Money

Anything touching cash, billing, vouchers or ledgers: read
`docs/money-path-rules.md` first, and run

    npm run check:migrations
    npm run test:money-paths
    npm run test:loud-failures

Never rebuild a database function from an old migration file — read the live
definition. A migration file is only true on the day it was applied.
