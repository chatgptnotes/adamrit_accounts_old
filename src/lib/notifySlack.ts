// Standalone Slack sender. Lives in its own module (not the useUtilityDeadlines
// hook) so the flow runtime (runTaskFlows) can call it WITHOUT creating an
// import cycle (useUtilityDeadlines → flowDispatcher → runTaskFlows).
//
// /api/slack is the Vercel function in production; the same path is served by
// the Vite dev middleware locally (vite.config.ts). Both forward to
// SLACK_WEBHOOK_URL server-side, keeping the webhook off the client.
export async function notifyUtilitySlack(message: string): Promise<void> {
  try {
    await fetch('/api/slack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    });
  } catch (e) {
    // Never block the UI if Slack is unreachable / not configured.
    console.warn('[notifySlack] Slack notify failed', e);
  }
}
