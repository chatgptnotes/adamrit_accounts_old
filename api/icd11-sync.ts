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
  /** Always an array in MMS, even with one element. */
  parent?: string[]
  releaseId?: string
  latestRelease?: string
  indexTerm?: Array<{ label?: { '@value'?: string } }>
  inclusion?: Array<{ label?: { '@value'?: string } }>
}

/** A queued node carries the chapter it descends from; the entity does not say. */
interface Node {
  uri: string
  chapterNo: string | null
  chapterTitle: string | null
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
    // A cursor entry carries its chapter context, because an entity does not
    // say which chapter it sits under — only the walk down to it knows.
    const cursor: Node[] = Array.isArray(req.body?.cursor)
      ? req.body.cursor
          .filter((n: any) => n && typeof n.uri === 'string')
          .map((n: any) => ({ uri: n.uri, chapterNo: n.chapterNo ?? null, chapterTitle: n.chapterTitle ?? null }))
      : []

    let token: string
    try {
      token = await getToken(clientId, clientSecret)
    } catch (err: any) {
      return res.status(502).json({ error: 'who_auth_failed', detail: err?.message || 'unknown' })
    }

    // Start from the frontier the caller handed back, or resolve the release.
    // ROOT_URL is a LIST OF RELEASES, not the classification — walking it
    // directly yields nothing, which is what the first draft of this did.
    let frontier: Node[]
    let release: string | null = null
    try {
      if (cursor.length) {
        frontier = [...cursor]
      } else {
        const root = await fetchEntity(ROOT_URL, token)
        const releaseUri = root.latestRelease
        if (!releaseUri) throw new Error('WHO root carried no latestRelease')
        const releaseEntity = await fetchEntity(releaseUri, token)
        release = text(releaseEntity.releaseId)
        frontier = (releaseEntity.child || []).map((uri) => ({ uri, chapterNo: null, chapterTitle: null }))
      }
    } catch (err: any) {
      return res.status(502).json({ error: 'who_release_failed', detail: err?.message || 'unknown' })
    }

    const rows: any[] = []
    let visited = 0

    try {
      while (frontier.length > 0 && visited < maxNodes) {
        const node = frontier.shift() as Node
        const entity = await fetchEntity(node.uri, token)
        visited += 1

        const id = entity['@id'] || node.uri
        if (!release) release = id.match(/\/release\/11\/([^/]+)\//)?.[1] || null

        const kind = text(entity.classKind)
        const title = text(entity.title?.['@value'])
        const children = entity.child || []

        // Chapter context is inherited downwards; a chapter sets it.
        let chapterNo = node.chapterNo
        let chapterTitle = node.chapterTitle
        if (kind === 'chapter') {
          chapterNo = text(entity.code)
          chapterTitle = title
          if (chapterFilter && chapterNo !== chapterFilter) continue
        }

        if (title) {
          const synonyms = [
            ...(entity.indexTerm || []).map((t) => text(t.label?.['@value'])),
            ...(entity.inclusion || []).map((t) => text(t.label?.['@value'])),
          ].filter((s): s is string => Boolean(s))

          rows.push({
            uri: id,
            // Blocks carry code "" rather than omitting it; "" is not a code.
            code: text(entity.code),
            title,
            definition: text(entity.definition?.['@value']),
            class_kind: kind,
            chapter_no: chapterNo,
            chapter_title: chapterTitle,
            parent_uri: entity.parent?.[0] ?? null,
            synonyms: synonyms.length ? [...new Set(synonyms)] : null,
            is_leaf: children.length === 0,
            release_version: release,
            synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
        }

        frontier.push(...children.map((uri) => ({ uri, chapterNo, chapterTitle })))
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
