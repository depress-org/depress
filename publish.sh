#!/usr/bin/env bash
# Publish all depress packages to npm.
# Usage: NPM_TOKEN=npm_xxx ./publish.sh
set -e

if [ -n "$NPM_TOKEN" ]; then
  echo "//registry.npmjs.org/:_authToken=$NPM_TOKEN" > ~/.npmrc
fi

echo "Building all packages..."
npm run build

echo ""
echo "Publishing @depress-dev/core..."
cd packages/core
npm publish --access public
cd ../..

echo ""
echo "Publishing @depress-dev/wp-migrate..."
cd packages/wp-migrate
npm publish --access public
cd ../..

echo ""
echo "Publishing depress (CLI)..."
cd packages/cli
npm publish --access public
cd ../..

echo ""
echo "All packages published!"
echo ""
echo "Test with: npx depress --version"
