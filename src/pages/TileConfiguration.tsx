import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { LayoutDashboard, Search, Users, UserRound, Trash2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TABLET_MODULES } from '@/tablet/config/modules';
import { ALL_ROLES } from '@/config/tileAccess';

const db = supabase as any;

// A row of tile_assignments. Exactly one of user_id / role is set - the table's
// check constraint guarantees it, so the UI can switch on which one is null.
interface Assignment {
  id: string;
  tile_id: string;
  user_id: string | null;
  role: string | null;
}

interface Staff {
  id: string;
  full_name: string | null;
  email: string;
  role: string | null;
  department: string | null;
}

// Tiles a person can be sent to from the home grid. Child flows reached only
// from inside another module have nothing to map.
const TILES = TABLET_MODULES.filter((m) => !m.hiddenFromHome);

const staffName = (s: Staff) => s.full_name?.trim() || s.email;

const roleLabel = (role: string) =>
  role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const TileConfiguration: React.FC = () => {
  const { user } = useAuth();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selectedTile, setSelectedTile] = useState<string>(TILES[0]?.id ?? '');
  const [tileSearch, setTileSearch] = useState('');
  const [staffSearch, setStaffSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const fetchAll = async () => {
    setLoading(true);

    const { data: rows, error } = await db
      .from('tile_assignments')
      .select('id, tile_id, user_id, role');
    if (error) {
      // Almost always the migration not having been run yet, which is worth
      // saying plainly rather than showing an empty page that looks configured.
      toast.error(`Could not load tile assignments: ${error.message}`);
      setAssignments([]);
    } else {
      setAssignments(rows || []);
    }

    const { data: users, error: userError } = await db
      .from('User')
      .select('id, full_name, email, role, department, is_active')
      .eq('is_active', true)
      .order('full_name');
    if (userError) toast.error(`Could not load staff: ${userError.message}`);
    setStaff(users || []);

    setLoading(false);
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Roles offered as checkboxes. The static ALL_ROLES list has drifted from the
  // roles people actually hold, so the roles present on real staff rows are
  // merged in - otherwise an employee's role could never be mapped at all.
  const roles = useMemo(() => {
    const found = new Set<string>(ALL_ROLES);
    staff.forEach((s) => { if (s.role) found.add(s.role); });
    return Array.from(found).sort();
  }, [staff]);

  const forTile = (tileId: string) => assignments.filter((a) => a.tile_id === tileId);

  const visibleTiles = useMemo(() => {
    const q = tileSearch.trim().toLowerCase();
    if (!q) return TILES;
    return TILES.filter(
      (m) =>
        m.label.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q),
    );
  }, [tileSearch]);

  const visibleStaff = useMemo(() => {
    const q = staffSearch.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter(
      (s) =>
        staffName(s).toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q) ||
        (s.department || '').toLowerCase().includes(q),
    );
  }, [staff, staffSearch]);

  // Assignments left behind by a module that has since been renamed or removed.
  // They match nothing on the tablet, so they are surfaced here to be cleared
  // rather than sitting invisibly in the table.
  const orphans = useMemo(() => {
    const known = new Set(TABLET_MODULES.map((m) => m.id));
    const stale = new Set<string>();
    assignments.forEach((a) => { if (!known.has(a.tile_id)) stale.add(a.tile_id); });
    return Array.from(stale).sort();
  }, [assignments]);

  /** Add or remove one mapping. The unique indexes make a double-add harmless. */
  const toggle = async (
    tileId: string,
    target: { user_id: string; role?: never } | { role: string; user_id?: never },
    on: boolean,
  ) => {
    const key = `${tileId}:${target.user_id ?? target.role}`;
    setBusy(key);

    if (on) {
      const { error } = await db.from('tile_assignments').insert({
        tile_id: tileId,
        user_id: target.user_id ?? null,
        role: target.role ?? null,
        created_by: user?.email ?? null,
      });
      setBusy(null);
      if (error) { toast.error(`Could not assign: ${error.message}`); return; }
    } else {
      let q = db.from('tile_assignments').delete().eq('tile_id', tileId);
      q = target.user_id ? q.eq('user_id', target.user_id) : q.eq('role', target.role);
      const { error } = await q;
      setBusy(null);
      if (error) { toast.error(`Could not remove: ${error.message}`); return; }
    }
    fetchAll();
  };

  const clearOrphan = async (tileId: string) => {
    setBusy(`orphan:${tileId}`);
    const { error } = await db.from('tile_assignments').delete().eq('tile_id', tileId);
    setBusy(null);
    if (error) { toast.error(`Could not clear: ${error.message}`); return; }
    toast.success(`Cleared assignments for “${tileId}”`);
    fetchAll();
  };

  const current = TILES.find((m) => m.id === selectedTile);
  const currentRows = forTile(selectedTile);
  const currentRoles = new Set(currentRows.map((a) => a.role).filter(Boolean) as string[]);
  const currentUsers = new Set(currentRows.map((a) => a.user_id).filter(Boolean) as string[]);

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-start gap-3 mb-2">
          <div className="rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 p-2.5">
            <LayoutDashboard className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Tile Configuration</h1>
            <p className="text-sm text-gray-600">
              Map each tablet tile to the roles and staff who use it. Their tiles appear
              under <strong>Your Work</strong> at the top of their tablet home screen.
              Nothing is hidden — every other tile stays available below.
            </p>
          </div>
        </div>

        {orphans.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
            <div className="flex items-center gap-2 text-amber-900 font-medium">
              <AlertTriangle className="h-4 w-4" />
              Assignments for tiles that no longer exist
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {orphans.map((id) => (
                <button
                  key={id}
                  onClick={() => clearOrphan(id)}
                  disabled={busy === `orphan:${id}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-sm text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {id}
                </button>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="mt-6 text-gray-500">Loading tiles and staff…</div>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-[22rem_1fr]">
            {/* ── Tile list ─────────────────────────────────────────── */}
            <div className="rounded-xl border border-gray-200 bg-white">
              <div className="relative border-b border-gray-200 p-3">
                <Search className="pointer-events-none absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="search"
                  value={tileSearch}
                  onChange={(e) => setTileSearch(e.target.value)}
                  placeholder={`Search ${TILES.length} tiles…`}
                  className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500"
                />
              </div>
              <div className="max-h-[65vh] overflow-y-auto">
                {visibleTiles.map((m) => {
                  const rows = forTile(m.id);
                  const roleCount = rows.filter((a) => a.role).length;
                  const userCount = rows.filter((a) => a.user_id).length;
                  const Icon = m.icon;
                  return (
                    <button
                      key={m.id}
                      onClick={() => setSelectedTile(m.id)}
                      className={cn(
                        'flex w-full items-center gap-3 border-b border-gray-100 p-3 text-left hover:bg-gray-50',
                        selectedTile === m.id && 'bg-blue-50 hover:bg-blue-50',
                      )}
                    >
                      <span className={cn('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br', m.tint)}>
                        <Icon className="h-4 w-4 text-white" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-900">{m.label}</span>
                        <span className="block text-xs text-gray-500">
                          {roleCount + userCount === 0
                            ? 'Not mapped'
                            : [
                                roleCount ? `${roleCount} role${roleCount > 1 ? 's' : ''}` : null,
                                userCount ? `${userCount} staff` : null,
                              ].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                    </button>
                  );
                })}
                {visibleTiles.length === 0 && (
                  <div className="p-4 text-sm text-gray-500">No tiles match “{tileSearch}”.</div>
                )}
              </div>
            </div>

            {/* ── Assignment editor ─────────────────────────────────── */}
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              {!current ? (
                <div className="text-gray-500">Select a tile to map it.</div>
              ) : (
                <>
                  <div className="flex items-center gap-3 border-b border-gray-200 pb-3">
                    <span className={cn('inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br', current.tint)}>
                      <current.icon className="h-5 w-5 text-white" />
                    </span>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">{current.label}</h2>
                      <p className="text-xs text-gray-500">{current.description}</p>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                      <Users className="h-4 w-4 text-gray-500" />
                      Roles
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">
                      Everyone holding this role gets the tile at the top of their tablet.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {roles.map((role) => {
                        const on = currentRoles.has(role);
                        return (
                          <button
                            key={role}
                            onClick={() => toggle(current.id, { role }, !on)}
                            disabled={busy === `${current.id}:${role}`}
                            className={cn(
                              'rounded-full border px-3 py-1.5 text-sm transition-colors disabled:opacity-50',
                              on
                                ? 'border-blue-600 bg-blue-600 text-white'
                                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
                            )}
                          >
                            {roleLabel(role)}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-6">
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                      <UserRound className="h-4 w-4 text-gray-500" />
                      Staff
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">
                      Named employees, on top of whatever their role already gives them.
                      Logins and passwords are managed in User Management.
                    </p>
                    <div className="relative mt-2">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                      <input
                        type="search"
                        value={staffSearch}
                        onChange={(e) => setStaffSearch(e.target.value)}
                        placeholder={`Search ${staff.length} staff…`}
                        className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="mt-2 max-h-[40vh] overflow-y-auto rounded-lg border border-gray-200">
                      {visibleStaff.map((s) => {
                        const on = currentUsers.has(s.id);
                        return (
                          <label
                            key={s.id}
                            className="flex cursor-pointer items-center gap-3 border-b border-gray-100 p-2.5 last:border-b-0 hover:bg-gray-50"
                          >
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={busy === `${current.id}:${s.id}`}
                              onChange={() => toggle(current.id, { user_id: s.id }, !on)}
                              className="h-4 w-4 rounded border-gray-300"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm text-gray-900">{staffName(s)}</span>
                              <span className="block truncate text-xs text-gray-500">
                                {[s.role ? roleLabel(s.role) : null, s.department, s.email]
                                  .filter(Boolean).join(' · ')}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                      {visibleStaff.length === 0 && (
                        <div className="p-3 text-sm text-gray-500">No staff match “{staffSearch}”.</div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TileConfiguration;
