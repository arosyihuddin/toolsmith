#!/usr/bin/env bash
# Package a Toolsmith release artifact:
#   dist-release/toolsmith-<version>.tar.gz  (source payload + release.json)
#   dist-release/SHA256SUMS                  (sha256sum-compatible)
# Usage: scripts/package-release.sh <version> [commit]
set -Eeuo pipefail

VERSION="${1:?usage: package-release.sh <version> [commit]}"
COMMIT="${2:-$(git rev-parse HEAD)}"

PKG_VERSION="$(node -e 'console.log(require("./package.json").version)' 2>/dev/null || bun -e 'console.log((await Bun.file("package.json").json()).version)')"
if [[ "$PKG_VERSION" != "$VERSION" ]]; then
  echo "package.json version ($PKG_VERSION) does not match requested release version ($VERSION)" >&2
  exit 1
fi

OUT="dist-release"
STAGE="$OUT/stage"
rm -rf "$OUT"
mkdir -p "$STAGE"

cp -a src package.json bun.lock tsconfig.json vite.config.ts install.sh "$STAGE"/
printf '{"name":"toolsmith","version":"%s","commit":"%s","ref":"v%s"}\n' "$VERSION" "$COMMIT" "$VERSION" > "$STAGE/release.json"

tar -czf "$OUT/toolsmith-$VERSION.tar.gz" -C "$STAGE" .
(cd "$OUT" && sha256sum "toolsmith-$VERSION.tar.gz" > SHA256SUMS)
rm -rf "$STAGE"

echo "Packaged $OUT/toolsmith-$VERSION.tar.gz (commit $COMMIT)"
cat "$OUT/SHA256SUMS"
