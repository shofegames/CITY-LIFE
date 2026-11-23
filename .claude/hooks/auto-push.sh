#!/usr/bin/env bash
# Sube automáticamente a GitHub todos los cambios de CITY LIFE.
# Se ejecuta cada vez que Claude termina de responder (hook "Stop").

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0

# Copia de cada versión en la carpeta "versiones" de esta computadora
# (solo hace algo cuando aparece un número de versión nuevo).
node scripts/guardar-version.mjs >/dev/null 2>&1 || true

git add -A

if ! git diff --cached --quiet; then
  git commit -q -m "Auto-guardado $(date '+%Y-%m-%d %H:%M')"
fi

# Nada que subir si todavía no hay ningún commit
git rev-parse --verify -q HEAD >/dev/null || exit 0

# Subir solo si hay commits locales que GitHub no tiene
if ! git rev-parse --verify -q origin/main >/dev/null || [ -n "$(git log origin/main..HEAD --oneline)" ]; then
  git push -q -u origin main
fi

# Etiqueta de versión en GitHub (v0.3.0, v0.4.0...) la primera vez que aparece
VERSION=$(grep -o "VERSION = '[0-9.]*'" src/core/Game.js | grep -o "[0-9.]*[0-9]")
if [ -n "$VERSION" ] && ! git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null; then
  git tag -a "v$VERSION" -m "CITY LIFE v$VERSION" && git push -q origin "v$VERSION"
fi
