// Generates public/claude-skills.json from the local harvested Claude skills.
// Run locally (reads ~/.claude/skills/harvested); the JSON is committed so the
// deployed /skills page has the data without filesystem access.
//
//   node scripts/generate-claude-skills.mjs
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const SKILLS_DIR = join(homedir(), '.claude', 'skills', 'harvested');
const OUT = join(process.cwd(), 'public', 'claude-skills.json');

function parseFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: md };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (kv) {
      let v = kv[2].trim();
      // Strip a single pair of surrounding quotes if present.
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      meta[kv[1]] = v;
    }
  }
  return { meta, body: m[2].trim() };
}

if (!existsSync(SKILLS_DIR)) {
  console.error('No harvested skills dir at', SKILLS_DIR);
  process.exit(1);
}

const skills = [];
for (const name of readdirSync(SKILLS_DIR)) {
  const dir = join(SKILLS_DIR, name);
  const file = join(dir, 'SKILL.md');
  if (!statSync(dir).isDirectory() || !existsSync(file)) continue;
  const raw = readFileSync(file, 'utf8');
  const { meta, body } = parseFrontmatter(raw);
  skills.push({
    slug: name,
    name: meta.name || name,
    description: meta.description || '',
    type: meta.type || (meta.metadata && meta.metadata.type) || 'reference',
    source: meta.source || '',
    body,
  });
}

skills.sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(OUT, JSON.stringify({ generatedCount: skills.length, skills }, null, 2));
console.log(`Wrote ${skills.length} skills to ${OUT}`);
