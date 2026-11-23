// ============================================================================
// Guarda cada versión de CITY LIFE en la carpeta "versiones":
//   versiones/v0.3.0 - Misiones y policía/
//     JUGAR - CITY LIFE v0.3.0.html   ← doble clic para jugar (sin internet)
//     codigo/                          ← el código de esa versión
//     LEEME.txt                        ← novedades de la versión
//
// Uso:
//   node scripts/guardar-version.mjs            guarda la versión actual (si falta)
//   node scripts/guardar-version.mjs --todas    guarda también las versiones viejas desde git
//   node scripts/guardar-version.mjs --forzar   vuelve a generar aunque ya exista
// ============================================================================
import { readFileSync, existsSync, mkdirSync, rmSync, cpSync, writeFileSync, renameSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'versiones');
const TMP = join(ROOT, '.snapshot-tmp');
const args = process.argv.slice(2);
const force = args.includes('--forzar');
const all = args.includes('--todas');

const catalog = JSON.parse(readFileSync(join(ROOT, 'versiones.json'), 'utf8'));
const current = readFileSync(join(ROOT, 'src/core/Game.js'), 'utf8').match(/VERSION = '([\d.]+)'/)[1];

const safe = (s) => s.replace(/[<>:"/\\|?*]/g, '').trim();
const folderFor = (entry) => join(OUT, `v${entry.version} - ${safe(entry.nombre)}`);

async function snapshot(entry, fromCommit) {
  const dest = folderFor(entry);
  if (existsSync(dest) && !force) {
    console.log(`= v${entry.version} ya está guardada`);
    return;
  }
  console.log(`+ Guardando v${entry.version} (${entry.nombre})...`);
  // 1) código fuente de esa versión
  const src = join(TMP, `v${entry.version}`);
  rmSync(src, { recursive: true, force: true });
  mkdirSync(src, { recursive: true });
  if (fromCommit) {
    const tar = join(TMP, `v${entry.version}.tar`);
    execSync(`git archive --format=tar -o "${tar}" ${fromCommit}`, { cwd: ROOT });
    execSync(`tar -xf "${tar}" -C "${src}"`, { cwd: ROOT });
    rmSync(tar, { force: true });
  } else {
    for (const f of ['src', 'index.html', 'package.json', 'vite.config.js', 'versiones.json', 'scripts']) {
      if (existsSync(join(ROOT, f))) cpSync(join(ROOT, f), join(src, f), { recursive: true });
    }
  }
  // 2) juego compilado en un solo archivo HTML (funciona con doble clic, sin servidor)
  const built = join(TMP, `build-v${entry.version}`);
  rmSync(built, { recursive: true, force: true });
  await build({
    root: src,
    base: './',
    configFile: false,
    logLevel: 'warn',
    plugins: [viteSingleFile()],
    build: { outDir: built, emptyOutDir: true, chunkSizeWarningLimit: 5000, assetsInlineLimit: 100000000 },
  });
  // 3) armar la carpeta final
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  renameSync(join(built, 'index.html'), join(dest, `JUGAR - CITY LIFE v${entry.version}.html`));
  const codeDir = join(dest, 'codigo');
  mkdirSync(codeDir);
  for (const f of readdirSync(src)) {
    if (['node_modules', 'dist', '.github', '.claude'].includes(f)) continue;
    cpSync(join(src, f), join(codeDir, f), { recursive: true });
  }
  const notes = [
    `CITY LIFE v${entry.version} — ${entry.nombre}`,
    'Un juego de SHOFE GAMES',
    `Fecha: ${entry.fecha}${fromCommit ? `   (commit ${fromCommit})` : ''}`,
    '',
    'CÓMO JUGAR',
    `  Doble clic en "JUGAR - CITY LIFE v${entry.version}.html" (mejor en Chrome o Edge).`,
    '  No necesita internet ni instalar nada.',
    '',
    'NOVEDADES DE ESTA VERSIÓN',
    ...entry.novedades.map((n) => `  - ${n}`),
    '',
    'CÓDIGO',
    '  La carpeta "codigo" tiene el código fuente exacto de esta versión.',
    '  Para editarlo: copiarlo a otra carpeta, ejecutar "npm install" y después "npm run dev".',
    '',
  ].join('\r\n');
  writeFileSync(join(dest, 'LEEME.txt'), notes, 'utf8');
  rmSync(built, { recursive: true, force: true });
  rmSync(src, { recursive: true, force: true });
  console.log(`  listo → ${dest}`);
}

mkdirSync(OUT, { recursive: true });
try {
  for (const entry of catalog) {
    if (entry.version === current) await snapshot(entry, null);
    else if (all && entry.commit) await snapshot(entry, entry.commit);
  }
  if (!catalog.some((e) => e.version === current)) {
    await snapshot({ version: current, nombre: 'Versión en desarrollo', fecha: new Date().toISOString().slice(0, 10), novedades: ['(sin descripción todavía)'] }, null);
  }
} finally {
  rmSync(TMP, { recursive: true, force: true });
}
