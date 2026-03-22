#!/bin/bash
set -e

# ── Major.Minor задаётся здесь, patch инкрементируется автоматически ──
MAJOR=0
MINOR=1
# ─────────────────────────────────────────────────────────────────────

# Read current patch from root package.json
CURRENT=$(node -e "console.log(require('./package.json').version)")
CURRENT_PATCH=$(echo "$CURRENT" | cut -d. -f3)
PATCH=$((CURRENT_PATCH + 1))

VERSION="$MAJOR.$MINOR.$PATCH"
TAG="v$VERSION"

echo "Current version: $CURRENT"
echo "New version:     $VERSION"
echo ""

# Check for uncommitted changes
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Error: uncommitted changes. Commit or stash first."
  exit 1
fi

# Check tag doesn't already exist
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Error: tag $TAG already exists"
  exit 1
fi

# Update version in all package.json files
for pkg in package.json packages/*/package.json; do
  if [ -f "$pkg" ]; then
    node -e "
      const fs = require('fs');
      const p = JSON.parse(fs.readFileSync('$pkg', 'utf8'));
      p.version = '$VERSION';
      fs.writeFileSync('$pkg', JSON.stringify(p, null, 2) + '\n');
    "
    echo "  $pkg -> $VERSION"
  fi
done

git add package.json packages/*/package.json
git commit -m "release: $TAG"
git tag "$TAG"

# Push commit and tag
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git push origin "$BRANCH" "$TAG"

echo ""
echo "Release $TAG pushed. GitHub Actions will build and create the release."
