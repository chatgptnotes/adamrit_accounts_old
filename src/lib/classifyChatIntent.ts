// Cheap, local intent gate for the Skill Factory chatbot — generalises the
// looksLikeCreateReminder pattern (parseReminderFromPrompt) into a multi-way
// router. Answers "is the user asking for automation IDEAS, or to pull up an
// EXISTING automation?" before spending an LLM round-trip. Returns null when
// neither applies, so the chatbot falls through to its existing reminder →
// design-flow behaviour unchanged.
//
// IMPORTANT: this is only ever called from inside SkillFactoryChatbot.send() —
// never from a mount effect — so suggestions appear ONLY on an explicit request,
// never proactively when the chatbot opens.
export type ChatIntent = 'suggest' | 'edit_existing';

export function classifyChatIntent(text: string): ChatIntent | null {
  const p = text.toLowerCase().trim();
  if (!p) return null;

  const libRef = /\b(automations?|flows?|workflows?)\b/;

  // Library actions: "show me my automations", "pull up a saved workflow",
  // "edit my existing automations". Requires the my/saved/existing framing so
  // "edit this automation to also notify" still routes to the design path (it
  // edits the CURRENT canvas, not the saved library).
  if (
    /\b(my|saved|existing|other|previous)\s+(automations?|flows?|workflows?)\b/.test(p) ||
    (/\b(show me|list|pull up|open|load|see|view)\b/.test(p) && /\b(my|saved|existing)\b/.test(p) && libRef.test(p))
  ) {
    return 'edit_existing';
  }

  // Idea / suggestion asks: "what can you automate for me", "suggest some",
  // "any ideas", "recommend automations for this person".
  if (
    /\bwhat can (you|u|i)\b/.test(p) ||
    /\b(suggest|recommend)\b/.test(p) ||
    /\b(any |some )?ideas?\b/.test(p) ||
    /\bautomations?\s+for\s+(me|him|her|this|them|us)\b/.test(p) ||
    (/\bhelp me\b/.test(p) && /\bautomat/.test(p))
  ) {
    return 'suggest';
  }

  return null;
}
