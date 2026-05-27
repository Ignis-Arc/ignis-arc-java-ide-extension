#!/bin/bash
# Exit on any error
set -e

echo "========================================="
echo "Packaging Ignis Arc Java IDE Extension Pack..."
echo "========================================="

# Ensure the build script is executable
chmod +x build.sh

# 1. Compile the Java JDT LS OSGi plugin
./build.sh

# 2. Install TypeScript and VS Code types using ultra-fast Bun package manager
echo "Installing extension dependencies..."
bun install

# 3. Transpile TypeScript frontend code
echo "Compiling TypeScript frontend..."
bun x tsc -p ./

# 4. Package into .vsix using vsce (skip dependencies, allow missing repo, skip license check)
echo "Packaging into VSIX..."
bun x @vscode/vsce package --no-dependencies --allow-missing-repository --skip-license

echo ""
echo "========================================="
echo "Success: packaged extension is ready!"
echo "You can install it directly in VS Code."
echo "File location:"
ls -la *.vsix
echo "========================================="
