import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Sparkles, Search, Download, Plus, Wrench, Bug, Rocket, Package,
  Workflow, BookOpen, Stethoscope, X,
} from 'lucide-react';

interface Skill {
  slug: string;
  name: string;
  description: string;
  type: string;
  source: string;
  body: string;
}

// A deterministic, pleasant gradient per skill so each card has its own visual.
const GRADIENTS = [
  'from-violet-500 to-purple-600', 'from-blue-500 to-cyan-500',
  'from-emerald-500 to-teal-600', 'from-amber-500 to-orange-600',
  'from-rose-500 to-pink-600', 'from-indigo-500 to-blue-600',
  'from-fuchsia-500 to-purple-600', 'from-sky-500 to-indigo-500',
  'from-lime-500 to-emerald-600', 'from-red-500 to-rose-600',
];

const TYPE_ICON: Record<string, typeof Wrench> = {
  pattern: Workflow, deployment: Rocket, setup: Wrench, workflow: Workflow,
  fix: Wrench, 'bug-fix': Bug, diagnosis: Stethoscope, 'install-procedure': Package,
  project: Package, reference: BookOpen,
};

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function initials(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/);
  return ((words[0]?.[0] || '') + (words[1]?.[0] || '')).toUpperCase() || 'SK';
}

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function skillVisual(skill: Skill, size: 'sm' | 'lg' = 'sm') {
  const Icon = TYPE_ICON[skill.type] || Sparkles;
  const gradient = GRADIENTS[hash(skill.slug) % GRADIENTS.length];
  const box = size === 'lg' ? 'h-16 w-16 rounded-2xl' : 'h-12 w-12 rounded-xl';
  return (
    <div className={`relative flex ${box} flex-shrink-0 items-center justify-center bg-gradient-to-br ${gradient} text-white shadow-sm`}>
      <span className={size === 'lg' ? 'text-lg font-extrabold' : 'text-sm font-bold'}>{initials(skill.name)}</span>
      <Icon className={`absolute -bottom-1 -right-1 ${size === 'lg' ? 'h-6 w-6' : 'h-4 w-4'} rounded-full bg-white p-0.5 text-gray-700 shadow`} />
    </div>
  );
}

function buildSkillMd(name: string, description: string, type: string, body: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'my-skill';
  return `---\nname: ${slug}\ndescription: ${description.trim()}\nmetadata:\n  type: ${type.trim() || 'reference'}\n---\n\n${body.trim()}\n`;
}

export default function ClaudeSkills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [active, setActive] = useState<Skill | null>(null);
  const [building, setBuilding] = useState(false);

  // Build form state
  const [bName, setBName] = useState('');
  const [bDesc, setBDesc] = useState('');
  const [bType, setBType] = useState('reference');
  const [bBody, setBBody] = useState('');

  useEffect(() => {
    fetch('/claude-skills.json')
      .then(r => r.json())
      .then(d => setSkills(d.skills || []))
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
  }, []);

  const types = useMemo(() => {
    const set = new Set(skills.map(s => s.type));
    return ['all', ...Array.from(set).sort()];
  }, [skills]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return skills.filter(s =>
      (typeFilter === 'all' || s.type === typeFilter) &&
      (s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
    );
  }, [skills, query, typeFilter]);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2 text-primary">
            <Sparkles className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Claude Skills</h1>
            <p className="text-sm text-gray-500">{skills.length} reusable skills — browse, view, and build your own.</p>
          </div>
        </div>
        <Button onClick={() => setBuilding(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Build a Skill
        </Button>
      </div>

      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search skills…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {types.map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                typeFilter === t ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="py-20 text-center text-gray-400">Loading skills…</div>
      ) : (
        <>
          <p className="mb-3 text-xs text-gray-400">{filtered.length} of {skills.length} skills</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map(skill => (
              <button
                key={skill.slug}
                onClick={() => setActive(skill)}
                className="group flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-all hover:border-primary/40 hover:shadow-md active:scale-[0.99]"
              >
                {skillVisual(skill)}
                <div className="min-w-0">
                  <div className="truncate font-semibold text-gray-800">{skill.name}</div>
                  <div className="mt-0.5 line-clamp-2 text-xs text-gray-500">{skill.description || 'No description'}</div>
                  <span className="mt-2 inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">{skill.type}</span>
                </div>
              </button>
            ))}
          </div>
          {filtered.length === 0 && (
            <div className="py-20 text-center text-gray-400">No skills match “{query}”.</div>
          )}
        </>
      )}

      {/* Skill detail */}
      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          {active && (
            <>
              <DialogHeader>
                <div className="flex items-start gap-4">
                  {skillVisual(active, 'lg')}
                  <div className="min-w-0">
                    <DialogTitle className="text-left">{active.name}</DialogTitle>
                    <DialogDescription className="text-left">{active.description}</DialogDescription>
                    <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">{active.type}</span>
                  </div>
                </div>
              </DialogHeader>
              <pre className="flex-1 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-4 text-xs leading-relaxed text-gray-800">{active.body}</pre>
              <div className="flex justify-end">
                <Button onClick={() => download(`${active.slug}.SKILL.md`, active.body)} className="gap-2">
                  <Download className="h-4 w-4" /> Download SKILL.md
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Build a skill */}
      <Dialog open={building} onOpenChange={setBuilding}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Build a Skill</DialogTitle>
            <DialogDescription>Fill in the details and download a ready-to-use SKILL.md file.</DialogDescription>
          </DialogHeader>
          <div className="flex-1 space-y-3 overflow-auto">
            <div>
              <label className="text-xs font-medium text-gray-600">Name</label>
              <Input value={bName} onChange={e => setBName(e.target.value)} placeholder="e.g. Discharge Summary Generator" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Description (one line)</label>
              <Input value={bDesc} onChange={e => setBDesc(e.target.value)} placeholder="What the skill does and when to use it" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Type</label>
              <Input value={bType} onChange={e => setBType(e.target.value)} placeholder="reference | pattern | workflow | fix | setup" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Body (markdown)</label>
              <Textarea value={bBody} onChange={e => setBBody(e.target.value)} placeholder="# Title&#10;&#10;Steps, code, gotchas…" className="min-h-[200px] font-mono text-xs" />
            </div>
            {bName && (
              <div>
                <p className="mb-1 text-xs font-medium text-gray-600">Preview</p>
                <pre className="overflow-auto rounded-lg bg-gray-50 p-3 text-[11px] leading-relaxed text-gray-700">{buildSkillMd(bName, bDesc, bType, bBody)}</pre>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setBuilding(false)} className="gap-1"><X className="h-4 w-4" /> Cancel</Button>
            <Button
              disabled={!bName.trim()}
              onClick={() => {
                const slug = bName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'my-skill';
                download(`${slug}.SKILL.md`, buildSkillMd(bName, bDesc, bType, bBody));
              }}
              className="gap-2"
            >
              <Download className="h-4 w-4" /> Download SKILL.md
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
