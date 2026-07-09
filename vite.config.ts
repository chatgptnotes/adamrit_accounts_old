import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import * as http from "http";
import * as https from "https";

// Dev-only Tally proxy. In production, api/tally-proxy.ts (Vercel function)
// handles this. In dev, Vite doesn't serve API routes, so the browser POST to
// /api/tally-proxy returns 404 unless this middleware intercepts it. Read-only
// mode keeps test-connection and proxy available, but blocks all outbound push.
function tallyProxyPlugin(): Plugin {
  function esc(s: string) {
    return (s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function fmtDate(d: string) {
    return (d || "").replace(/-/g, "");
  }

  function buildVoucherXml(companyName: string, action: string, data: any): string {
    switch (action) {
      case "create-voucher": {
        let entries = "";
        for (const e of data.ledgerEntries || []) {
          const amt = e.isDeemedPositive ? -Math.abs(e.amount) : Math.abs(e.amount);
          entries += `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(e.ledgerName || e.ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${e.isDeemedPositive ? "Yes" : "No"}</ISDEEMEDPOSITIVE><AMOUNT>${amt}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
        }
        return `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Import</TALLYREQUEST><TYPE>Data</TYPE><ID>Vouchers</ID></HEADER><BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>${esc(companyName)}</SVCURRENTCOMPANY></STATICVARIABLES></DESC><DATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${esc(data.voucherType)}" ACTION="Create"><DATE>${fmtDate(data.date)}</DATE><NARRATION>${esc(data.narration || "")}</NARRATION><VOUCHERTYPENAME>${esc(data.voucherType)}</VOUCHERTYPENAME><PARTYLEDGERNAME>${esc(data.partyLedger || "")}</PARTYLEDGERNAME>${entries}</VOUCHER></TALLYMESSAGE></DATA></BODY></ENVELOPE>`;
      }
      case "create-sales-voucher": {
        let entries = `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(data.patientName)}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${data.totalAmount}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
        for (const item of data.items || []) {
          entries += `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(item.ledgerName || "Hospital Income")}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${item.amount}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
        }
        return `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Import</TALLYREQUEST><TYPE>Data</TYPE><ID>Vouchers</ID></HEADER><BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>${esc(companyName)}</SVCURRENTCOMPANY></STATICVARIABLES></DESC><DATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Sales" ACTION="Create"><DATE>${fmtDate(data.date)}</DATE><NARRATION>IPD Bill #${esc(data.billNumber || "")}</NARRATION><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><PARTYLEDGERNAME>${esc(data.patientName)}</PARTYLEDGERNAME>${entries}</VOUCHER></TALLYMESSAGE></DATA></BODY></ENVELOPE>`;
      }
      case "create-receipt-voucher": {
        const bank = data.bankLedger || (data.paymentMode === "Cash" ? "Cash" : "Bank Account");
        return `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Import</TALLYREQUEST><TYPE>Data</TYPE><ID>Vouchers</ID></HEADER><BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>${esc(companyName)}</SVCURRENTCOMPANY></STATICVARIABLES></DESC><DATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Receipt" ACTION="Create"><DATE>${fmtDate(data.date)}</DATE><NARRATION>Receipt #${esc(data.receiptNumber || "")} from ${esc(data.patientName || "")}</NARRATION><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><PARTYLEDGERNAME>${esc(data.patientName || "")}</PARTYLEDGERNAME><ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(bank)}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${data.amount}</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(data.patientName || "")}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${data.amount}</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER></TALLYMESSAGE></DATA></BODY></ENVELOPE>`;
      }
      default:
        return "";
    }
  }

  function callTally(serverUrl: string, xmlBody: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL(serverUrl);
      const lib = url.protocol === "https:" ? https : http;
      const buf = Buffer.from(xmlBody, "utf8");
      const req = lib.request(
        {
          hostname: url.hostname,
          port: parseInt(url.port || "9000", 10),
          path: url.pathname || "/",
          method: "POST",
          headers: { "Content-Type": "application/xml", "Content-Length": buf.length },
        },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => resolve(data));
        }
      );
      req.setTimeout(30000, () => { req.destroy(); reject(new Error("Tally timeout after 30s")); });
      req.on("error", reject);
      req.write(buf);
      req.end();
    });
  }

  function parseResp(xml: string) {
    const created = parseInt((xml.match(/<CREATED[^>]*>([^<]*)<\/CREATED>/i) || [])[1] || "0", 10);
    const altered = parseInt((xml.match(/<ALTERED[^>]*>([^<]*)<\/ALTERED>/i) || [])[1] || "0", 10);
    const errors: string[] = [];
    for (const m of xml.matchAll(/<LINEERROR[^>]*>([^<]*)<\/LINEERROR>/gi)) {
      if (m[1]?.trim()) errors.push(m[1].trim());
    }
    return { success: errors.length === 0, message: errors.join("; ") || `Created:${created} Altered:${altered}`, created, altered, errors: errors.length ? errors : undefined };
  }

  return {
    name: "tally-proxy-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/tally-proxy", (req: any, res: any) => {
        if (req.method === "GET") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ status: "ok (dev)", endpoints: ["test-connection", "push", "proxy"] }));
          return;
        }
        if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }

        let raw = "";
        req.on("data", (c: any) => (raw += c));
        req.on("end", async () => {
          const send = (obj: any) => {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(obj));
          };
          try {
            const body = JSON.parse(raw || "{}");
            const { endpoint, action, serverUrl, companyName, data, xmlBody } = body;

            if (!serverUrl) { send({ error: "Missing serverUrl" }); return; }

            if (endpoint === "test-connection") {
              const xml = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>List of Companies</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></DESC></BODY></ENVELOPE>`;
              try {
                const resp = await callTally(serverUrl, xml);
                const names = [...resp.matchAll(/<NAME[^>]*>([^<]+)<\/NAME>/gi)].map((m) => m[1].trim()).filter(Boolean);
                send({ connected: true, companies: [...new Set(names)], version: "Connected" });
              } catch (e: any) {
                send({ connected: false, companies: [], version: "", error: e.message });
              }
              return;
            }

            if (endpoint === "proxy") {
              try { send({ response: await callTally(serverUrl, xmlBody) }); }
              catch (e: any) { send({ error: e.message }); }
              return;
            }

            if (endpoint === "push") {
              send({
                success: false,
                message: "Outbound push to Tally is disabled. This installation is read-only from Tally.",
              });
              return;
            }

            // sync — needs Supabase service key; skip in dev (use Dashboard Refresh instead)
            if (endpoint === "sync") {
              send({ success: false, message: "Sync not available in dev mode — use the Refresh button on the Dashboard or run vercel dev." });
              return;
            }

            send({ error: `Unknown endpoint: ${endpoint}` });
          } catch (e: any) {
            send({ error: e.message });
          }
        });
      });
    },
  };
}

// Dev-only Gmail proxy. Handles /api/get-emails, /api/reply-email, /api/send-email
// locally using Gmail App Password — same as the Vercel functions in api/.
function gmailProxyPlugin(env: Record<string, string>): Plugin {
  const userEmail = env.GMAIL_USER_EMAIL ?? '';
  const appPassword = env.GMAIL_APP_PASSWORD ?? '';

  function readBody(req: any): Promise<string> {
    return new Promise((resolve) => {
      let raw = '';
      req.on('data', (c: any) => (raw += c));
      req.on('end', () => resolve(raw));
    });
  }

  function send(res: any, status: number, body: unknown) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  }

  function getTransporter() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodemailer = require('nodemailer') as typeof import('nodemailer');
    return nodemailer.createTransport({ service: 'gmail', auth: { user: userEmail, pass: appPassword } });
  }

  return {
    name: 'gmail-proxy-dev',
    apply: 'serve',
    configureServer(server) {
      // GET /api/get-emails — IMAP read
      server.middlewares.use('/api/get-emails', (req: any, res: any) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end(); return; }
        if (!userEmail || !appPassword) {
          send(res, 500, { error: 'Set GMAIL_USER_EMAIL and GMAIL_APP_PASSWORD in .env' });
          return;
        }
        (async () => {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { ImapFlow } = require('imapflow') as typeof import('imapflow');
          const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true,
            auth: { user: userEmail, pass: appPassword }, logger: false });
          try {
            await client.connect();
            await client.mailboxOpen('INBOX');
            const uids = (await client.search({ all: true })).slice(-30).reverse();
            const emails: unknown[] = [];
            for await (const msg of client.fetch(uids.length ? uids : ['1:1'],
              { uid: true, flags: true, envelope: true })) {
              const env2 = msg.envelope;
              const fr = env2?.from?.[0];
              const fromRaw = fr ? `${fr.name ?? ''} <${fr.mailbox}@${fr.host}>` : '';
              const nm = fromRaw.match(/^"?([^"<]+?)"?\s*<(.+)>$/);
              let body = '';
              try {
                const bp = await client.download(String(msg.uid), '1', { uid: true });
                if (bp?.content) {
                  const chunks: Buffer[] = [];
                  for await (const c of bp.content) chunks.push(c as Buffer);
                  body = Buffer.concat(chunks).toString('utf-8').slice(0, 4000);
                }
              } catch { /* no body */ }
              emails.push({
                id: String(msg.uid), threadId: String(msg.uid),
                messageId: env2?.messageId ?? '',
                from: nm ? nm[2].trim() : fromRaw.trim(),
                fromName: nm ? nm[1].trim() : fromRaw.trim(),
                subject: env2?.subject ?? '(no subject)',
                date: env2?.date?.toISOString() ?? '',
                snippet: body.slice(0, 120).replace(/\s+/g, ' '),
                body,
                isUnread: !msg.flags?.has('\\Seen'),
              });
            }
            await client.logout();
            send(res, 200, { emails });
          } catch (e: any) {
            try { await client.logout(); } catch { /* ignore */ }
            send(res, 500, { error: e.message });
          }
        })();
      });

      // POST /api/reply-email — SMTP send
      server.middlewares.use('/api/reply-email', (req: any, res: any) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        readBody(req).then(async (raw) => {
          try {
            const { to, subject, body, messageId } = JSON.parse(raw || '{}');
            const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
            await getTransporter().sendMail({
              from: userEmail, to, subject: replySubject, text: body,
              ...(messageId ? { inReplyTo: messageId, references: messageId } : {}),
            });
            send(res, 200, { ok: true });
          } catch (e: any) { send(res, 500, { ok: false, error: e.message }); }
        });
      });

      // POST /api/send-email — SMTP send
      server.middlewares.use('/api/send-email', (req: any, res: any) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        readBody(req).then(async (raw) => {
          try {
            const { to, subject, body } = JSON.parse(raw || '{}');
            await getTransporter().sendMail({ from: userEmail, to, subject, text: body ?? subject });
            send(res, 200, { ok: true });
          } catch (e: any) { send(res, 500, { ok: false, error: e.message }); }
        });
      });
    },
  };
}

// Dev-only Slack relay. The browser can't POST to a Slack webhook directly
// (no CORS), so the page POSTs { text } to same-origin /api/slack and this
// middleware forwards it server-side to SLACK_WEBHOOK_URL (kept in .env.local,
// gitignored). The Slack Workflow webhook variable key is literally "t-e-x-t"
// (with dashes), so the forwarded body MUST use that key. In production the same
// /api/slack path is handled by the Vercel function api/slack.ts — so one URL
// works in both; this middleware only runs under `npm run dev`.
function slackProxyPlugin(env: Record<string, string>): Plugin {
  return {
    name: "slack-proxy-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/slack", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("Method Not Allowed");
          return;
        }
        const webhook = env.SLACK_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL;
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(body));
        };
        if (!webhook) {
          send(500, { error: "SLACK_WEBHOOK_URL not set in .env.local" });
          return;
        }
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", async () => {
          try {
            const { text } = JSON.parse(raw || "{}");
            const r = await fetch(webhook, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ "t-e-x-t": text ?? "" }),
            });
            send(r.ok ? 200 : 502, { ok: r.ok, status: r.status });
          } catch (e) {
            send(500, { error: e instanceof Error ? e.message : String(e) });
          }
        });
      });
    },
  };
}

// Dev-only DoubleTick relay for the Government Portal Import screen. Production
// uses api/send-extension-needed-whatsapp.ts; this keeps the same same-origin
// URL working under Vite without exposing the DoubleTick key to the browser.
function doubleTickExtensionAlertPlugin(env: Record<string, string>): Plugin {
  return {
    name: "doubletick-extension-alert-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/send-extension-needed-whatsapp", (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(body));
        };

        if (req.method !== "POST") {
          send(405, { error: "method_not_allowed" });
          return;
        }

        const apiKey = env.DOUBLETICK_API_KEY || process.env.DOUBLETICK_API_KEY || "";
        const from = env.DOUBLETICK_PHONE || process.env.DOUBLETICK_PHONE || "";
        const to = env.DOUBLETICK_EXTENSION_ALERT_TO || process.env.DOUBLETICK_EXTENSION_ALERT_TO || "";

        if (!apiKey || !from || !to) {
          send(500, {
            error: "doubletick_not_configured",
            keys: { apiKey: Boolean(apiKey), from: Boolean(from), to: Boolean(to) },
          });
          return;
        }

        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", async () => {
          try {
            const body = JSON.parse(raw || "{}");
            const reportDate = typeof body.reportDate === "string" ? body.reportDate.trim() : "";
            const patientList = typeof body.patientList === "string" ? body.patientList.trim() : "";
            const extensionCount = Number(body.extensionCount);

            if (!reportDate) {
              send(400, { error: "reportDate required" });
              return;
            }
            if (!patientList) {
              send(400, { error: "patientList required" });
              return;
            }
            if (!Number.isFinite(extensionCount) || extensionCount <= 0) {
              send(400, { error: "extensionCount must be greater than zero" });
              return;
            }

            const r = await fetch("https://public.doubletick.io/whatsapp/message/template", {
              method: "POST",
              headers: {
                accept: "application/json",
                "content-type": "application/json",
                Authorization: apiKey,
              },
              body: JSON.stringify({
                messages: [
                  {
                    to,
                    from,
                    content: {
                      templateName: "extension_needed_patients_v1",
                      language: "en",
                      templateData: {
                        header: { type: "TEXT" },
                        body: {
                          placeholders: [
                            "Billing Team",
                            reportDate,
                            patientList,
                            String(extensionCount),
                          ],
                        },
                      },
                    },
                  },
                ],
              }),
            });

            const responseText = await r.text();
            let responseBody: unknown = responseText;
            try {
              responseBody = responseText ? JSON.parse(responseText) : null;
            } catch {
              responseBody = responseText.slice(0, 1000);
            }

            if (!r.ok) {
              send(502, { error: "doubletick_send_failed", status: r.status, detail: responseBody });
              return;
            }

            send(200, { ok: true, status: r.status, response: responseBody });
          } catch (e) {
            send(502, {
              error: "doubletick_unreachable",
              detail: e instanceof Error ? e.message : String(e),
            });
          }
        });
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load non-VITE_ env (e.g. SLACK_WEBHOOK_URL) for server-side dev use only.
  const env = loadEnv(mode, process.cwd(), "");
  return {
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    ...(mode === 'development' ? [slackProxyPlugin(env), doubleTickExtensionAlertPlugin(env), tallyProxyPlugin(), gmailProxyPlugin(env)] : []),
    ...(mode === 'development' ? [basicSsl()] : []),
    react(),
    // Service worker for installability + instant app-shell launch. We keep the
    // hand-written public/manifest.webmanifest (manifest: false) and only let the
    // plugin generate/register the SW. No data caching — offline data is out of
    // scope; this exists so Chrome/Android offers "Install" and the installed
    // app launches without a blank screen.
    VitePWA({
      // autoUpdate (not "prompt"): the new service worker activates and the page
      // reloads automatically when a deploy ships, so users never get stuck on a
      // stale cached bundle (which caused 404s on newly-added routes). Pairs with
      // skipWaiting + clientsClaim below.
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: false,
      includeAssets: [
        "favicon.ico",
        "favicon.svg",
        "apple-touch-icon.png",
        "splash/*.png",
      ],
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
        navigateFallback: "/index.html",
        // Never serve the SPA shell for API/auth requests.
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        // Allow the larger vendor chunks (pdf/ckeditor) into the precache so the
        // installed app launches fully offline-capable for its shell.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    global: 'globalThis',
  },
  optimizeDeps: {
    exclude: ['jspdf'],
    // CKEditor ships a CJS/UMD-only build with no ESM entry. It must be
    // pre-bundled (not excluded) so Vite's dev server can synthesize the
    // `default` export; excluding it breaks `import ClassicEditor from ...`
    // in dev with "does not provide an export named 'default'".
    include: ['@ckeditor/ckeditor5-build-classic']
  },
  build: {
    target: 'es2015',
    sourcemap: false,
    minify: 'esbuild',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      // NOTE: Manual chunk splitting removed entirely. Previous config caused
      // runtime crashes: react-router "Cannot read createContext", recharts
      // "Cannot access 'S' before initialization". Rollup's automatic code
      // splitting handles module initialization order correctly.
      onwarn(warning, warn) {
        if (warning.code === 'UNRESOLVED_IMPORT' ||
            warning.code === 'MISSING_EXPORT') {
          return;
        }
        warn(warning);
      }
    }
  }
  };
});
