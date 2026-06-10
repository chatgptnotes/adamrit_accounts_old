// App/module context fed to the automation chatbot so its suggestions are
// grounded in what this hospital app actually does — without changing the
// EXECUTABLE vocabulary (triggers/actions live in FLOW_EVENT_TYPES /
// SAFE_ACTION_TYPES and are enumerated in the prompts directly). This constant
// only adds the module map + an honesty rule so the bot tailors ideas to a
// department but never proposes something the engine can't actually run yet.
//
// Track B (wiring new module events into the engine) will extend the trigger
// vocabulary; until then this keeps "automate the whole project" suggestions
// honest instead of hallucinated.
import { formatRegistryForPrompt } from '@/lib/pageActionRegistry';

export const APP_AUTOMATION_CONTEXT = `About this app: Adamrit is a hospital management system. Staff work across modules such as: Patients & OPD, Final Bill / billing, Pharmacy & inventory, Lab & investigations, utility-bill deadlines, and the staff Task Optimizer (where these automations live).

Ground every automation idea in the staff member's department/work, but you can ONLY build automations from the trigger and action lists given below. If the user wants to automate something those lists cannot express yet (e.g. pharmacy stock running low, a lab result becoming ready, a patient being discharged), say plainly that it is not automatable yet, and offer the closest supported alternative (e.g. a scheduled check, or a task status-change / task-added trigger paired with a "guide" or Slack alert that points staff to the right page).

${formatRegistryForPrompt()}`;
