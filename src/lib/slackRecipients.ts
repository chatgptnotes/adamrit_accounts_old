// Slack reminder recipients — a small roster of people/channels a deadline
// reminder can be addressed to. A reminder stores recipient_id; the firing crons
// resolve it to a Slack mention that prefixes the message text (kept on the one
// existing webhook/channel — see api/fire-due-reminders.ts).

export type SlackRecipientKind = 'dm' | 'channel';

export interface SlackRecipient {
  id: string;
  name: string;            // display, e.g. 'Murli sir'
  aliases: string[];       // extra match tokens, e.g. ['murli','murali']
  slack_target: string | null; // Slack user ID (U…) or channel ID (C…); null = name-only
  kind: SlackRecipientKind;
  active: boolean;
  // MD/director: receives only IMPORTANT items + a daily important-only summary,
  // never routine bill noise.
  is_director: boolean;
  created_at: string;
  updated_at: string;
}

// Build the Slack mention that prefixes a reminder. With a real Slack ID this is
// proper mention syntax that pings; without one we fall back to plain '@Name'
// text so a recipient is still usable before its ID is wired in.
export function mentionFor(r: Pick<SlackRecipient, 'name' | 'slack_target' | 'kind'>): string {
  if (!r.slack_target) return `@${r.name}`;
  return r.kind === 'channel' ? `<#${r.slack_target}>` : `<@${r.slack_target}>`;
}

// Honorifics that users tack onto names but that aren't part of the match token.
const HONORIFICS = new Set(['sir', 'maam', "ma'am", 'madam', 'mam', 'ji', 'the', 'to', 'in']);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[#@]/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !HONORIFICS.has(t));
}

// Match a free-text recipient hint ("Murli sir", "finance channel") against the
// roster by name + aliases. Returns the first active recipient that shares any
// significant token with the hint, or null when nothing matches.
export function matchRecipient(hint: string, roster: SlackRecipient[]): SlackRecipient | null {
  const hintTokens = new Set(tokenize(hint));
  if (hintTokens.size === 0) return null;

  for (const r of roster) {
    if (!r.active) continue;
    const candidateTokens = [...tokenize(r.name), ...r.aliases.flatMap(tokenize)];
    if (candidateTokens.some((t) => hintTokens.has(t))) return r;
  }
  return null;
}
