#!/usr/bin/env python3
"""Apply a SQL migration file to the linked Supabase project.

Usage: python3 scripts/apply-migration.py supabase/migrations/<file>.sql
Reads SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_URL from .env and calls the
service-role-only apply_migration() function (created 2026-08-06). Each file
name applies exactly once; re-running returns ALREADY_APPLIED.
"""
import json
import pathlib
import sys
import urllib.request

root = pathlib.Path(__file__).resolve().parents[1]
env = {}
for line in (root / ".env").read_text().splitlines():
    if "=" in line and not line.lstrip().startswith("#"):
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip()

path = pathlib.Path(sys.argv[1])
payload = json.dumps({"p_name": path.name, "p_sql": path.read_text()}).encode()
request = urllib.request.Request(
    env["VITE_SUPABASE_URL"].rstrip("/") + "/rest/v1/rpc/apply_migration",
    data=payload,
    headers={
        "apikey": env["SUPABASE_SERVICE_ROLE_KEY"],
        "Authorization": "Bearer " + env["SUPABASE_SERVICE_ROLE_KEY"],
        "Content-Type": "application/json",
    },
)
try:
    with urllib.request.urlopen(request) as response:
        print(response.read().decode())
except urllib.error.HTTPError as error:
    print("ERROR", error.code, error.read().decode()[:500])
    sys.exit(1)
