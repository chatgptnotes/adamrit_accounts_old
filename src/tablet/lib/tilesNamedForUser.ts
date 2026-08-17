/**
 * Tiles that carry the signed-in person's own name.
 *
 * 21 of the 77 tablet tiles are named after the person whose job they are --
 * "OT Schedule - Gaurav", "Quick Pay - Avni", "Accounts (Tilak)", "Dialysis
 * Billing - Shashank". Their owner had to hunt for them in a 77-tile grid like
 * everybody else, because the only thing that floated a tile to the top was an
 * explicit row in tile_assignments, and on 17-Aug that table held two rows in
 * total. So in practice nobody's own work was on top.
 *
 * This costs no data entry: the tile already says whose it is. Explicit
 * assignments still work and still win; this only adds to them.
 *
 * MATCHED AS A WHOLE WORD, and never on a fragment. "Reena" must not be found
 * inside another word, and a short login id must not sweep half the grid into
 * one person's band -- so names shorter than four characters are ignored
 * entirely. Nothing is ever hidden by this, only reordered, so the cost of a
 * wrong match is a tile sitting higher than it should rather than a tile
 * somebody cannot reach.
 */

export interface NameableTile {
  id: string;
  label: string;
}

export interface NameableUser {
  username?: string | null;
  email?: string | null;
}

/** Shortest name we will match on. Below this, false positives outweigh the help. */
const MIN_NAME_LENGTH = 4;

/**
 * The names this person might be called on a tile, from their login id.
 *
 * The client has no full_name -- the session carries only email and username
 * (AuthContext's User) -- so the login id is what there is. "avni@gmail.com"
 * yields "avni"; "sakharediksha54@gmail.com" yields "sakharediksha", which
 * matches nothing, which is the correct outcome rather than a wrong one.
 */
export function candidateNames(user: NameableUser | null | undefined): string[] {
  if (!user) return [];
  const raw = [user.username, (user.email || '').split('@')[0]];
  const names = new Set<string>();

  for (const value of raw) {
    const cleaned = String(value || '')
      .toLowerCase()
      .replace(/[0-9]+/g, ' ')
      .replace(/[._-]+/g, ' ');
    for (const part of cleaned.split(/\s+/)) {
      if (part.length >= MIN_NAME_LENGTH) names.add(part);
    }
  }

  return [...names];
}

/** Does this tile's label carry one of the person's names as a whole word? */
export function tileIsNamedFor(label: string, names: readonly string[]): boolean {
  if (names.length === 0) return false;
  // Split on anything that is not a letter, so "Accounts (Tilak)" and
  // "Dialysis - Rakesh" both reduce to plain words.
  const words = new Set(
    String(label || '')
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter(Boolean),
  );
  return names.some((name) => words.has(name));
}

/** Ids of the tiles named for this person. */
export function tilesNamedForUser(
  tiles: readonly NameableTile[],
  user: NameableUser | null | undefined,
): Set<string> {
  const names = candidateNames(user);
  if (names.length === 0) return new Set();
  return new Set(tiles.filter((t) => tileIsNamedFor(t.label, names)).map((t) => t.id));
}
