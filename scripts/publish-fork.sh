#!/usr/bin/env bash
set -euo pipefail

SCOPE="@pdfmergy-embedpdf"
OLD_SCOPE="@embedpdf"
VERSION="${1:-}"  # optional version override, e.g. "0.1.0"
DRY_RUN="${DRY_RUN:-false}"
PUBLISH_ONLY="${PUBLISH_ONLY:-false}"

REPO_ROOT="$(git rev-parse --show-toplevel)"
WORKTREE_DIR="${REPO_ROOT}/.publish-worktree"
BRANCH_NAME="publish-fork"

if [ "$PUBLISH_ONLY" = "true" ] && [ -d "$WORKTREE_DIR/packages" ]; then
  echo "==> PUBLISH_ONLY: reusing existing worktree at $WORKTREE_DIR"
  cd "$WORKTREE_DIR"
else
  # Clean up any stale worktree
  git worktree remove --force "$WORKTREE_DIR" 2>/dev/null || true
  git branch -D "$BRANCH_NAME" 2>/dev/null || true
  rm -rf "$WORKTREE_DIR"

  echo "==> Creating worktree at $WORKTREE_DIR"
  git worktree add -b "$BRANCH_NAME" "$WORKTREE_DIR" HEAD

  cd "$WORKTREE_DIR"

  # ── Rename scope in all relevant files ──────────────────────────────

  echo "==> Renaming $OLD_SCOPE/ → $SCOPE/ in all package.json files"
  find . -name 'package.json' -not -path '*/node_modules/*' \
    -exec sed -i '' "s|${OLD_SCOPE}/|${SCOPE}/|g" {} +

  echo "==> Renaming in source files (.ts, .tsx, .js, .jsx, .vue, .svelte)"
  find . \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \
    -o -name '*.vue' -o -name '*.svelte' \) \
    -not -path '*/node_modules/*' \
    -exec sed -i '' "s|${OLD_SCOPE}/|${SCOPE}/|g" {} +

  echo "==> Renaming in config files (rollup, vite, tsconfig, .npmrc, changeset)"
  find . \( -name 'rollup.config.*' -o -name 'vite.config.*' \
    -o -name 'tsconfig*.json' -o -name '.npmrc' -o -name 'config.json' \) \
    -not -path '*/node_modules/*' \
    -exec sed -i '' "s|${OLD_SCOPE}/|${SCOPE}/|g" {} +

  # Update .npmrc registry scope
  sed -i '' "s|${OLD_SCOPE}:registry|${SCOPE}:registry|g" .npmrc 2>/dev/null || true

  # Remove _authToken=${NPM_TOKEN} lines so npm falls back to ~/.npmrc session auth
  # (from `npm login`). The project .npmrc's env-var reference overrides session auth
  # with an empty value when NPM_TOKEN is unset.
  if [ -z "${NPM_TOKEN:-}" ]; then
    echo "==> NPM_TOKEN not set, removing _authToken lines to use session auth"
    find . -name '.npmrc' -not -path '*/node_modules/*' \
      -exec sed -i '' '/:_authToken=/d' {} +
  fi

  # ── Version override ────────────────────────────────────────────────

  if [ -n "$VERSION" ]; then
    echo "==> Setting version to $VERSION in all package.json files"
    find . -name 'package.json' -not -path '*/node_modules/*' \
      -exec node -e "
        const fs = require('fs');
        const f = process.argv[1];
        const pkg = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (pkg.name && pkg.name.startsWith('${SCOPE}/') && !pkg.private) {
          pkg.version = '${VERSION}';
        }
        fs.writeFileSync(f, JSON.stringify(pkg, null, 2) + '\n');
      " {} \;
  fi

  # ── Verify ──────────────────────────────────────────────────────────

  echo "==> Verifying no stale $OLD_SCOPE references remain..."
  REMAINING=$(grep -r "${OLD_SCOPE}/" --include='*.ts' --include='*.json' \
    --include='*.tsx' --include='*.js' --include='*.cjs' --include='*.d.cts' \
    . | grep -v node_modules | grep -v '.git' | grep -v '.map' | head -5 || true)
  if [ -n "$REMAINING" ]; then
    echo "WARNING: Some $OLD_SCOPE references remain:"
    echo "$REMAINING"
    echo "(these may be in comments, URLs, or docs — verify they're harmless)"
  fi

  # ── Build ───────────────────────────────────────────────────────────

  echo "==> Patching aliasFromTsconfig for clean builds"
  # @rollup/plugin-alias uses prefix matching and returns the first match.
  # Fix: return an array sorted longest-key-first and always resolve to absolute.
  node <<'PATCH_EOF'
const fs = require("fs");
const f = "packages/build/src/vite/index.ts";
let code = fs.readFileSync(f, "utf8");

const old = `return Object.fromEntries(
    Object.entries(paths as Record<string, string[]>).map(([key, [p0]]) => {
      const isRelative = p0.startsWith('.') || p0.startsWith('/');
      return [key, isRelative ? path.resolve(baseDir, baseUrl, p0) : p0];
    }),
  );`;

const replacement = `return Object.entries(paths as Record<string, string[]>).map(([key, [p0]]) => {
      // Always resolve to absolute path relative to baseDir/baseUrl
      const resolved = path.isAbsolute(p0) ? p0 : path.resolve(baseDir, baseUrl, p0);
      return { find: key, replacement: resolved };
    }).sort((a, b) => b.find.length - a.find.length);`;

if (!code.includes(old)) {
  console.error("WARN: aliasFromTsconfig pattern not found, skipping patch");
  process.exit(0);
}
code = code.replace(old, replacement);
fs.writeFileSync(f, code);
console.log("  Patched", f);
PATCH_EOF

  echo "==> Installing dependencies"
  pnpm install --no-frozen-lockfile

  echo "==> Building packages (force, no turbo cache)"
  pnpm build --force --filter='./packages/*' --filter='./viewers/*'
fi

# ── Publish ─────────────────────────────────────────────────────────

if [ "$DRY_RUN" = "true" ]; then
  echo "==> DRY RUN: would publish these packages:"
  pnpm -r publish --dry-run --access public  2>&1 || true
else
  echo "==> Publishing to npm under $SCOPE"
  CONCURRENCY=8

  # Collect all package name/version/dir in one node call
  PKGS=$(pnpm -r list --json --depth=-1 2>/dev/null | node -e "
    const pkgs = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    pkgs.filter(p => !p.private && p.name.startsWith('${SCOPE}/')).forEach(p => {
      const ver = require(p.path + '/package.json').version;
      console.log(p.name + '\t' + ver + '\t' + p.path);
    });
  ")

  # Pre-check which packages are already published (parallel)
  echo "==> Checking which packages need publishing..."
  TMPDIR_CHECK=$(mktemp -d)
  echo "$PKGS" | while IFS=$'\t' read -r name ver dir; do
    (npm view "${name}@${ver}" version &>/dev/null && echo "$name" > "$TMPDIR_CHECK/$(echo "$name" | tr '/' '_')") &
    # Throttle
    while [ "$(jobs -r | wc -l)" -ge "$CONCURRENCY" ]; do wait -n; done
  done
  wait
  ALREADY_PUBLISHED=$(cat "$TMPDIR_CHECK"/* 2>/dev/null || true)
  rm -rf "$TMPDIR_CHECK"

  NEED_PUBLISH=$(echo "$PKGS" | while IFS=$'\t' read -r name ver dir; do
    echo "$ALREADY_PUBLISHED" | grep -qx "$name" || echo "$name\t$ver\t$dir"
  done)

  TOTAL=$(echo "$NEED_PUBLISH" | grep -c . || true)
  SKIP=$(echo "$ALREADY_PUBLISHED" | grep -c . || true)
  echo "  $SKIP already published, $TOTAL to publish"

  if [ "$TOTAL" -eq 0 ]; then
    echo "==> All packages already published!"
  else
    OTP_FLAG=""
    while true; do
      # Try first package to detect OTP requirement
      FIRST_LINE=$(echo "$NEED_PUBLISH" | head -1)
      IFS=$'\t' read -r FIRST_NAME FIRST_VER FIRST_DIR <<< "$FIRST_LINE"
      echo "  Publishing $FIRST_NAME@$FIRST_VER (testing auth)..."
      OUTPUT=$(cd "$FIRST_DIR" && npm publish --access public $OTP_FLAG 2>&1)
      if [ $? -eq 0 ]; then
        echo "    OK"
      elif echo "$OUTPUT" | grep -q "EOTP"; then
        echo "    OTP required."
        read -rp "Enter npm OTP code: " OTP_CODE
        OTP_FLAG="--otp=$OTP_CODE"
        OUTPUT=$(cd "$FIRST_DIR" && npm publish --access public $OTP_FLAG 2>&1) || {
          echo "    FAILED: $OUTPUT"
          echo "Ctrl+C to abort, or enter new OTP to retry."
          continue
        }
      elif echo "$OUTPUT" | grep -q "previously published\|E403"; then
        echo "    Already published."
      else
        echo "    FAILED: $OUTPUT"
        exit 1
      fi

      # Publish remaining in parallel
      FAIL_DIR=$(mktemp -d)
      echo "$NEED_PUBLISH" | tail -n +2 | while IFS=$'\t' read -r name ver dir; do
        (
          OUT=$(cd "$dir" && npm publish --access public $OTP_FLAG 2>&1)
          RC=$?
          if [ $RC -eq 0 ]; then
            echo "  Published $name@$ver"
          elif echo "$OUT" | grep -q "previously published\|E403"; then
            echo "  $name already published, skipping."
          else
            echo "  FAILED $name: $(echo "$OUT" | grep 'npm error' | head -2)"
            touch "$FAIL_DIR/$name"
          fi
        ) &
        while [ "$(jobs -r | wc -l)" -ge "$CONCURRENCY" ]; do wait -n; done
      done
      wait

      FAIL_COUNT=$(find "$FAIL_DIR" -type f 2>/dev/null | wc -l | tr -d ' ')
      rm -rf "$FAIL_DIR"
      if [ "$FAIL_COUNT" -eq 0 ]; then
        break
      fi
      echo ""
      echo "$FAIL_COUNT packages failed. Enter new OTP to retry (Ctrl+C to abort):"
      read -rp "OTP: " OTP_CODE
      OTP_FLAG="--otp=$OTP_CODE"
    done
  fi
fi

echo "==> Done!"
