// Load the WHO's ICD-11 classification into the icd11_codes master.
//
// WHY IT IS AN IMPORTER AND NOT A SEED FILE. ICD-11 content is licensed by the
// World Health Organization. It is not something to write from memory into a
// migration: a fabricated code would look exactly as authoritative as a real
// one, and would end up on a medical record and a claim. This pulls the real
// classification from the WHO's own API, so what lands in the master is what
// the WHO published, and re-running it picks up their next release.
//
// SETTING IT UP (one-time, free):
//   1. Register at https://icd.who.int/icdapi and create an API client.
//   2. Put the pair in Vercel Production:
//        ICD_API_CLIENT_ID
//        ICD_API_CLIENT_SECRET
//   3. POST /api/icd11-sync   (superadmin session; see auth below)
//
// RESUMABLE ON PURPOSE. MMS is tens of thousands of entities and a serverless
// function has a time limit, so one call walks a bounded number of nodes and
// returns the frontier it did not reach. Send that back as `cursor` to carry
// on. `chapter` limits a run to one chapter. A run that stops early reports
// done:false — it never reports success for a partial load, because a
// half-loaded classification that claims to be complete is worse than an empty
// one nobody trusts.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { withRoute } from './_middleware.js'

const TOKEN_URL = 'https://icdaccessmanagement.who.int/connect/token'
const ROOT_URL = 'https://id.who.int/icd/release/11/mms'

/** Vercel Pro allows this; a full chapter needs far more than the default 10s. */
export const config = { maxDuration: 300 }

interface Entity {
  '@id'?: string
  code?: string
  title?: { '@value'?: string }
  definition?: { '@value'?: string }
  classKind?: string
  child?: string[]
  indexTerm?: Array<{ label?: { '@value'?: string } }>
  inclusion?: Array<{ label?: { '@value'?: string } }>
}

const text = (value: unknown): string | null => {
  const s = typeof value === 'string' ? value.trim() : ''
  return s || null
}

async function getToken(id: string, secret: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: id,
    client_secret: secret,
    scope: 'icdapi_access',
    grant_type: 'client_credentials',
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    throw new Error(`WHO token request failed (${res.status}). Check ICD_API_CLIENT_ID / ICD_API_CLIENT_SECRET.`)
  }
  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) throw new Error('WHO token response carried no access_token')
  return json.access_token
}

async function fetchEntity(uri: string, token: string): Promise<Entity> {
  const res = await fetch(uri, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Accept-Language': 'en',
      'API-Version': 'v2',
    },
  })
  if (!res.ok) throw new Error(`WHO API ${res.status} for ${uri}`)
  return (await res.json()) as Entity
}

export default withRoute({ auth: 'admin', methods: ['POST'], rateLimit: { perMinute: 4, perHour: 40 } },
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const clientId = process.env.ICD_API_CLIENT_ID || ''
    const clientSecret = process.env.ICD_API_CLIENT_SECRET || ''
    if (!clientId || !clientSecret) {
      // Not configured is not the same as broken, and says exactly what to do.
      return res.status(503).json({
        error: 'icd_api_not_configured',
        detail: 'Register at https://icd.who.int/icdapi, then set ICD_API_CLIENT_ID and ICD_API_CLIENT_SECRET in Vercel.',
      })
    }

    const maxNodes = Math.min(Number(req.body?.maxNodes) || 400, 1200)
    const chapterFilter = text(req.body?.chapter)
    const cursor: string[] = Array.isArray(req.body?.cursor) ? req.body.cursor.filter((u: unknown) => typeof u === 'string') : []

    let token: string
    try {
      token = await getToken(clientId, clientSecret)
    } catch (err: any) {
      return res.status(502).json({ error: 'who_auth_failed', detail: err?.message || 'unknown' })
    }

    // Start from the frontier the caller handed back, or from the root.
    let frontier: string[] = cursor.length ? [...cursor] : [ROOT_URL]
    const rows: any[] = []
    let visited = 0
    let release: string | null = null

    try {
      while (frontier.length > 0 && visited < maxNodes) {
        const uri = frontier.shift() as string
        const entity = await fetchEntity(uri, token)
        visited += 1

        const id = entity['@id'] || uri
        // The release id sits in the URI, e.g. .../release/11/2024-01/mms/...
        if (!release) release = id.match(/\/release\/11\/([^/]+)\//)?.[1] || null

        const kind = text(entity.classKind)
        const title = text(entity.title?.['@value'])
        const children = Array.isArray(entity.child) ? entity.child : []

        // Chapters are the top level; a filter keeps a run to one of them.
        if (chapterFilter && kind === 'chapter' && text(entity.code) !== chapterFilter && uri !== ROOT_URL) {
          continue
        }

        if (title && uri !== ROOT_URL) {
          const synonyms = [
            ...(entity.indexTerm || []).map((t) => text(t.label?.['@value'])),
            ...(entity.inclusion || []).map((t) => text(t.label?.['@value'])),
          ].filter((s): s is string => Boolean(s))

          rows.push({
            uri: id,
            code: text(entity.code),
            title,
            definition: text(entity.definition?.['@value']),
            class_kind: kind,
            parent_uri: uri === ROOT_URL ? null : null,
            synonyms: synonyms.length ? [...new Set(synonyms)] : null,
            is_leaf: children.length === 0,
            release_version: release,
            synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
        }

        frontier.push(...children)
      }
    } catch (err: any) {
      // Report what was already read rather than losing a long walk to one
      // failed request — and never as a success.
      return res.status(502).json({
        error: 'who_fetch_failed',
        detail: err?.message || 'unknown',
        visited,
        pending: frontier.length,
        cursor: frontier.slice(0, 5000),
      })
    }

    let written = 0
    if (rows.length) {
      // Batched: one statement per 500 keeps each round trip well inside the
      // function's budget. onConflict on the WHO URI so a re-run updates in
      // place instead of duplicating the classification.
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500)
        const { error } = await ctx.sb.from('icd11_codes').upsert(batch, { onConflict: 'uri' })
        if (error) {
          return res.status(502).json({
            error: 'icd_write_failed',
            detail: error.message,
            written,
            visited,
            cursor: frontier.slice(0, 5000),
          })
        }
        written += batch.length
      }
    }

    const done = frontier.length === 0
    console.log(`[icd11-sync] visited ${visited}, wrote ${written}, pending ${frontier.length}, done=${done}`)

    return res.status(200).json({
      ok: true,
      done,
      visited,
      written,
      release,
      pending: frontier.length,
      // Hand the caller what is left so the next call carries on exactly here.
      cursor: done ? [] : frontier.slice(0, 5000),
      note: done
        ? 'Classification loaded.'
        : 'Partial run — POST again with this cursor to continue.',
    })
  })
