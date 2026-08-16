// Writes to public.tile_access_overrides — who may see which tile.
//
// WHY THIS ROUTE EXISTS
// The matrix used to write to localStorage, so it changed nothing for anyone
// but the administrator's own browser. Moving it into the database raises the
// question the browser could not answer: who may change it? The anon key is
// published in the JS bundle, so a write policy the browser could satisfy would
// let anyone with devtools decide which staff see the Accounting screen. So the
// table has no write policy at all, and every change comes through here with
// the service role, behind withRoute({ auth: 'admin' }) — which re-reads the
// caller's role from the database on every request rather than trusting the
// eight-hour session cookie's claim.
//
// Reads are NOT here: every page needs the rules on first render, and they are
// a list of role names against tile ids, so the browser selects them directly
// under the table's open SELECT policy.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withRoute, sendError, text, type RouteContext } from './_middleware.js';

// Tile ids are slugs from src/config/tileAccess.ts ("s-accounting",
// "d-total-patients"). Validated for shape rather than against that list, which
// lives in the frontend bundle: an id that matches no rule is inert, because
// canSeeTile only ever looks up ids the code already knows.
const TILE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const ROLE = /^[a-z0-9_]{1,40}$/i;

type Actor = { id: string; email: string; role: string };

const audit = async (
  sb: any,
  actor: Actor,
  action: string,
  details: Record<string, unknown>,
  ip: string | null,
) => {
  try {
    await sb.from('user_activity_log').insert({
      user_id: actor.id || null,
      user_email: actor.email || null,
      user_role: actor.role || null,
      action,
      details,
      page: '/api/tile-access',
      ip_address: ip,
      user_agent: 'server',
    });
  } catch {
    // Logging must never change the outcome of an administrative action.
  }
};

/**
 * null  → every role sees the tile
 * []    → nobody sees it
 * [...] → exactly these roles
 *
 * Undefined and null are both read as "everyone", because that is what the
 * localStorage map meant by an explicit `undefined` and the meaning has to
 * survive the move.
 */
const parseRoles = (raw: unknown): string[] | null | undefined => {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return undefined;
  const roles = Array.from(
    new Set(raw.map((r) => text(r).trim()).filter(Boolean)),
  );
  if (roles.length > 60) return undefined;
  if (!roles.every((r) => ROLE.test(r))) return undefined;
  return roles;
};

export default withRoute({ auth: 'admin', methods: ['POST'] },
  async (req: VercelRequest, res: VercelResponse, ctx: RouteContext) => {
  const { sb, ip } = ctx;
  const actor: Actor = {
    id: String(ctx.user!.id),
    email: String(ctx.user!.email),
    role: String(ctx.user!.role || ''),
  };

  const action = text(req.body?.action);

  // ------------------------------------------------------------------ set
  if (action === 'set') {
    const tileId = text(req.body?.tile_id).trim();
    if (!TILE_ID.test(tileId)) return sendError(res, 400, 'invalid_tile_id');

    const roles = parseRoles(req.body?.roles);
    if (roles === undefined) return sendError(res, 400, 'invalid_roles');

    const { data, error } = await sb
      .from('tile_access_overrides')
      .upsert(
        { tile_id: tileId, roles, updated_at: new Date().toISOString(), updated_by: actor.email },
        { onConflict: 'tile_id' },
      )
      .select('tile_id, roles')
      .maybeSingle();

    if (error) return sendError(res, 500, error.message || 'tile_access_save_failed');
    // An upsert that wrote nothing is a failure worth reporting, not a silent
    // success the screen would render as saved.
    if (!data) return sendError(res, 500, 'tile_access_not_saved');

    await audit(sb, actor, 'tile_access_set', { tile_id: tileId, roles }, ip);
    return res.status(200).json({ ok: true, override: data });
  }

  // ---------------------------------------------------------------- reset
  if (action === 'reset') {
    const { data, error } = await sb
      .from('tile_access_overrides')
      .delete()
      .not('tile_id', 'is', null)
      .select('tile_id');

    if (error) return sendError(res, 500, error.message || 'tile_access_reset_failed');

    const cleared = (data || []).length;
    await audit(sb, actor, 'tile_access_reset', { cleared }, ip);
    return res.status(200).json({ ok: true, cleared });
  }

  return sendError(res, 400, 'unknown_action');
});
