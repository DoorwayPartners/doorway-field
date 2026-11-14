#!/usr/bin/env bash
# Doorway Field gate (Kim, one pass): install -> secret/CSP scan -> golden suites (core + v2, Brookline_Sanford_50) -> optional publish.
#   bash field_gate.sh              dry run: test only, publishes nothing
#   bash field_gate.sh --publish    test, then publish app/ to the ISOLATED Pages repo for field.doorwaypartners.com
# Never touches doorwaypartners.com or ops.doorwaypartners.com: the publish target must be a clone whose origin contains "doorway-field".
set -euo pipefail
cd "$(dirname "$0")"
die() { echo "GATE FAIL: $*" >&2; exit 1; }
PUBLISH=0; [ "${1:-}" = "--publish" ] && PUBLISH=1
FIELD_DOMAIN="${FIELD_DOMAIN:-field.doorwaypartners.com}"
command -v node >/dev/null || die "node >= 18 not found"
[ -d node_modules/maplibre-gl ] && [ -d node_modules/playwright ] || npm install --no-audit --no-fund
node -e 'require("playwright").chromium.executablePath()' >/dev/null 2>&1 || npx playwright install chromium
node tests/scan_secrets_csp.js || die "secret / CSP scan failed. Nothing was published."
node tests/test_doorway_field.js || die "core golden suite failed. Nothing was published."
node tests/test_field_v2.js || die "v2 golden suite failed. Nothing was published."
[ "$PUBLISH" = 1 ] || { echo "GATE PASS (dry run; nothing published)"; exit 0; }
: "${FIELD_PAGES_REPO:?set FIELD_PAGES_REPO to your local clone of the isolated doorway-field Pages repo}"
[ -d "$FIELD_PAGES_REPO/.git" ] || die "$FIELD_PAGES_REPO is not a git clone"
case "$(git -C "$FIELD_PAGES_REPO" remote get-url origin)" in *doorway-field*) ;; *) die "origin is not the isolated doorway-field repo; refusing";; esac
[ -f config.publish.js ] || die "config.publish.js missing: copy app/config.js, fill OWNER_EMAILS / API_URL / GOOGLE_CLIENT_ID (keep it out of Drive)"
grep -q "DF_CONFIG_OVERRIDE" config.publish.js || die "config.publish.js must keep the DF_CONFIG_OVERRIDE line from app/config.js"
node -e 'const c=require("fs").readFileSync("config.publish.js","utf8"),m=/ROSTER:\s*\[([\s\S]*?)\n\s*\]/.exec(c),n=m?[...m[1].matchAll(/name: .([^\x27"]+)./g)].map(x=>x[1]):[];process.exit(n.every(x=>x==="Cristian Coy"||/^(Manager|Agent) \d+$/.test(x))?0:1)' || die "config.publish.js holds real rep names: overwrite it from app/config.js (real names live in Admin › Roster only)"
find "$FIELD_PAGES_REPO" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp app/* "$FIELD_PAGES_REPO/" && cp config.publish.js "$FIELD_PAGES_REPO/config.js" && echo "$FIELD_DOMAIN" > "$FIELD_PAGES_REPO/CNAME"
# tests + workflow ride along so GitHub Actions (auto-gate.yml) re-runs the gate on every push ($0 on a public repo)
cp -r tests package.json field_gate.sh .gitignore "$FIELD_PAGES_REPO/" && mkdir -p "$FIELD_PAGES_REPO/.github/workflows" && cp .github/workflows/auto-gate.yml "$FIELD_PAGES_REPO/.github/workflows/"
git -C "$FIELD_PAGES_REPO" add -A
git -C "$FIELD_PAGES_REPO" commit -qm "Doorway Field $(node -p 'require("./package.json").version') ($(date -u +%Y-%m-%dT%H:%MZ))" || echo "no changes"
git -C "$FIELD_PAGES_REPO" push -q && echo "GATE PASS + PUBLISHED https://$FIELD_DOMAIN"
