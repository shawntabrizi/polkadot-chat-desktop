#!/usr/bin/env bash
# M19: build and check a release, then print the `gh release create` command.
#   bash scripts/release.sh v0.2.0-preview
# Refuses a dirty tree and a tag that does not name package.json's version
# (`v<version>` or `v<version>-<label>`): a release must be exactly the
# committed code, under the version the app reports. Then runs npm run check,
# npm run package and npm run smoke:packaged (headless, throwaway profile).
# It does NOT publish: it writes the changelog section to a notes file and
# prints the command; the coordinator runs it once the repo is public.
# Exit 0 RELEASE_READY; 1 RELEASE_FAIL <why>.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() {
  echo "RELEASE_FAIL $*"
  exit 1
}

tag="${1:-}"
[ -n "$tag" ] || fail "usage: scripts/release.sh <tag>, e.g. v0.2.0-preview"
[ -z "$(git status --porcelain)" ] || fail "the working tree is not clean; commit or stash first"
version=$(node -p "require('./package.json').version")
case "$tag" in
  "v$version" | "v$version"-*) ;;
  *) fail "tag $tag does not match package.json version $version (expected v$version or v$version-<label>)" ;;
esac
label="${tag#v"$version"}"
label="${label#-}"
section="${version}${label:+-$label}"
# In dist/ (git-ignored), next to the dmg, so it outlives this shell.
mkdir -p dist
notes="dist/release-notes-$tag.md"
# The changelog section: from its heading to the next "## " heading.
awk -v head="## $section" '$0 == head { on = 1; next } on && /^## / { exit } on { print }' CHANGELOG.md > "$notes"
[ -s "$notes" ] || fail "CHANGELOG.md has no \"## $section\" section"

npm run check
npm run package
npm run smoke:packaged

dmg="dist/Polkadot Chat-$version-arm64.dmg"
[ -f "$dmg" ] || fail "no $dmg after npm run package"
echo "RELEASE_READY $tag $(shasum -a 256 "$dmg" | cut -d' ' -f1) notes=$notes"
echo "Run this after the repo is public:"
printf 'gh release create %q --prerelease --title %q --notes-file %q %q\n' "$tag" "Polkadot Chat $tag" "$notes" "$dmg"
