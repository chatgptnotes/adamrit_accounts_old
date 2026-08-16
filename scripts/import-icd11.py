#!/usr/bin/env python3
"""Load the WHO ICD-11 MMS classification into the icd11_codes master.

Why a script and not just the API route: MMS is tens of thousands of entities,
each one an HTTP request to the WHO. A serverless function would need dozens of
resumed invocations; this walks the whole tree once with bounded concurrency.
api/icd11-sync.ts remains for re-syncing from inside the app.

Nothing here invents classification content. Every row is what the WHO returned.

Usage:
    export ICD_API_CLIENT_ID=...  ICD_API_CLIENT_SECRET=...
    python3 scripts/import-icd11.py            # whole classification
    python3 scripts/import-icd11.py --chapter 01
    python3 scripts/import-icd11.py --limit 500   # a taste, for checking

Idempotent: upserts on the WHO entity URI, so a re-run updates in place.
"""
import argparse
import json
import os
import pathlib
import queue
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = "https://id.who.int/icd/release/11/mms"
TOKEN_URL = "https://icdaccessmanagement.who.int/connect/token"

repo = pathlib.Path(__file__).resolve().parents[1]
env = {}
env_file = repo / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, _, v = line.partition("=")
            env.setdefault(k.strip(), v.strip())

SUPABASE_URL = (os.environ.get("VITE_SUPABASE_URL") or env.get("VITE_SUPABASE_URL", "")).rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or env.get("SUPABASE_SERVICE_ROLE_KEY", "")
CLIENT_ID = os.environ.get("ICD_API_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("ICD_API_CLIENT_SECRET", "")

if not (SUPABASE_URL and SERVICE_KEY):
    sys.exit("VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing")
if not (CLIENT_ID and CLIENT_SECRET):
    sys.exit("ICD_API_CLIENT_ID / ICD_API_CLIENT_SECRET missing — register at https://icd.who.int/icdapi")

_token = {"value": None, "expires": 0}
_token_lock = threading.Lock()


def token() -> str:
    """A long walk outlives the hour-long token, so it is refreshed in place."""
    with _token_lock:
        if _token["value"] and time.time() < _token["expires"] - 120:
            return _token["value"]
        body = urllib.parse.urlencode({
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "scope": "icdapi_access",
            "grant_type": "client_credentials",
        }).encode()
        req = urllib.request.Request(TOKEN_URL, data=body,
                                     headers={"content-type": "application/x-www-form-urlencoded"})
        data = json.loads(urllib.request.urlopen(req, timeout=60).read().decode())
        _token["value"] = data["access_token"]
        _token["expires"] = time.time() + int(data.get("expires_in", 3600))
        return _token["value"]


def fetch(uri: str, tries: int = 5) -> dict:
    """GET one entity, backing off on rate limits rather than hammering."""
    last = None
    for attempt in range(tries):
        req = urllib.request.Request(uri, headers={
            "Authorization": "Bearer " + token(),
            "Accept": "application/json",
            "Accept-Language": "en",
            "API-Version": "v2",
        })
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(1.5 * (attempt + 1))
                continue
            if e.code == 401:            # token rotated under us
                _token["expires"] = 0
                continue
            raise
        except Exception as e:           # transient network
            last = str(e)
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"giving up on {uri}: {last}")


def text(v):
    s = (v or "").strip() if isinstance(v, str) else ""
    return s or None


def row_of(entity: dict, chapter_no, chapter_title, release) -> dict:
    labels = []
    for key in ("indexTerm", "inclusion"):
        for item in entity.get(key) or []:
            label = text(((item or {}).get("label") or {}).get("@value"))
            if label:
                labels.append(label)
    parents = entity.get("parent") or []
    return {
        "uri": entity.get("@id"),
        # Blocks carry code "" rather than omitting it; an empty string is not a code.
        "code": text(entity.get("code")),
        "title": text((entity.get("title") or {}).get("@value")) or "(untitled)",
        "definition": text((entity.get("definition") or {}).get("@value")),
        "class_kind": text(entity.get("classKind")),
        "chapter_no": chapter_no,
        "chapter_title": chapter_title,
        "parent_uri": parents[0] if parents else None,
        "synonyms": sorted(set(labels)) or None,
        "is_leaf": not (entity.get("child") or []),
        "release_version": release,
        "synced_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def upsert(rows):
    if not rows:
        return
    payload = json.dumps(rows).encode()
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/icd11_codes?on_conflict=uri",
        data=payload,
        headers={
            "apikey": SERVICE_KEY,
            "Authorization": "Bearer " + SERVICE_KEY,
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=180).read()
    except urllib.error.HTTPError as e:
        # Never silently drop a batch — a partly-loaded classification that
        # reports success is worse than one that stops and says why.
        sys.exit(f"\nWRITE FAILED ({e.code}): {e.read().decode()[:400]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chapter", help="only this chapter code, e.g. 01")
    ap.add_argument("--limit", type=int, default=0, help="stop after N entities (a smoke test)")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    root = fetch(ROOT)
    release_uri = root["latestRelease"]
    release = fetch(release_uri)
    release_id = release.get("releaseId")
    chapters = release.get("child") or []
    print(f"ICD-11 MMS release {release_id} — {len(chapters)} chapters")

    work = queue.Queue()
    for uri in chapters:
        work.put((uri, None, None))

    seen = set()
    seen_lock = threading.Lock()
    buffer = []
    buffer_lock = threading.Lock()
    counts = {"fetched": 0, "written": 0}
    stop = threading.Event()

    def flush(force=False):
        with buffer_lock:
            if not buffer or (len(buffer) < 400 and not force):
                return
            batch, buffer[:] = buffer[:], []
        upsert(batch)
        counts["written"] += len(batch)

    def worker():
        while not stop.is_set():
            try:
                uri, ch_no, ch_title = work.get(timeout=3)
            except queue.Empty:
                return
            try:
                with seen_lock:
                    if uri in seen:
                        continue
                    seen.add(uri)
                    if args.limit and len(seen) > args.limit:
                        stop.set()
                        return
                entity = fetch(uri)
                kind = entity.get("classKind")
                if kind == "chapter":
                    ch_no = text(entity.get("code"))
                    ch_title = text((entity.get("title") or {}).get("@value"))
                    if args.chapter and ch_no != args.chapter:
                        continue
                with buffer_lock:
                    buffer.append(row_of(entity, ch_no, ch_title, release_id))
                counts["fetched"] += 1
                for child in entity.get("child") or []:
                    work.put((child, ch_no, ch_title))
                if counts["fetched"] % 250 == 0:
                    flush()
                    print(f"  {counts['fetched']} fetched, {counts['written']} written, "
                          f"{work.qsize()} queued", flush=True)
            except Exception as e:
                print(f"  ! {uri}: {e}", flush=True)
            finally:
                work.task_done()

    threads = [threading.Thread(target=worker, daemon=True) for _ in range(args.workers)]
    started = time.time()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    flush(force=True)

    mins = (time.time() - started) / 60
    print(f"\nDone: {counts['fetched']} entities fetched, {counts['written']} written, "
          f"{mins:.1f} min, release {release_id}")


if __name__ == "__main__":
    main()
