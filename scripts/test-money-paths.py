#!/usr/bin/env python3
"""Run the money-path test suite against the linked Supabase project.

The tests live in the database (run_money_path_tests), because that is where
the money logic lives — 164 functions and 102 sets of triggers. Testing them
from JavaScript would prove almost nothing.

Every test runs inside a savepoint that always rolls back, so this reads live
data and cannot change it. Exits non-zero if anything fails, so CI can use it.

Usage: python3 scripts/test-money-paths.py
"""
import json
import pathlib
import sys
import urllib.request
import urllib.error

root = pathlib.Path(__file__).resolve().parents[1]
env = {}
for line in (root / ".env").read_text().splitlines():
    if "=" in line and not line.lstrip().startswith("#"):
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip()

request = urllib.request.Request(
    env["VITE_SUPABASE_URL"].rstrip("/") + "/rest/v1/rpc/run_money_path_tests",
    data=b"{}",
    headers={
        "apikey": env["SUPABASE_SERVICE_ROLE_KEY"],
        "Authorization": "Bearer " + env["SUPABASE_SERVICE_ROLE_KEY"],
        "Content-Type": "application/json",
    },
)
try:
    result = json.loads(urllib.request.urlopen(request).read().decode())
except urllib.error.HTTPError as error:
    print("could not run the suite:", error.code, error.read().decode()[:400])
    sys.exit(1)

for test in result["tests"]:
    if test["ok"]:
        print(f"  ok   {test['test']}")
    else:
        print(f"  FAIL {test['test']}\n         {test['detail']}")

print(f"\nRESULT: {result['passed']} passed, {result['failed']} failed")
sys.exit(1 if result["failed"] else 0)
