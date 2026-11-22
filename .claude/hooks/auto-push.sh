#!/usr/bin/env bash
# Sube automáticamente a GitHub todos los cambios de CITY LIFE.
# Se ejecuta cada vez que Claude termina de responder (hook "Stop").

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0

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
