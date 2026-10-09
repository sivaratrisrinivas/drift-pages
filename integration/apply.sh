#!/usr/bin/env bash
# Drop drift-pages into a monid-ai/monid checkout (tested against b3e7b0c).
#   integration/apply.sh /path/to/monid
# Copies scripts/drift/pages.ts + scripts/drift/pages/ and applies a 10-line
# patch: register the suites in scripts/drift.ts, add an optional `keyless`
# flag to the DriftSuite contract, and widen the drift task's --allow-net.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
monid="${1:?usage: apply.sh <monid-checkout>}"
cp "$here/scripts/drift/pages.ts" "$monid/scripts/drift/pages.ts"
rm -rf "$monid/scripts/drift/pages"
cp -r "$here/scripts/drift/pages" "$monid/scripts/drift/pages"
git -C "$monid" apply "$here/integration/monid.patch"
echo "applied. try: cd $monid && deno task drift --provider firecrawl"
