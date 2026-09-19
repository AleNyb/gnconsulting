'use strict';

/**
 * Builds docs/ — the static copy GitHub Pages serves.
 *
 * Same files as public/, with absolute asset paths rewritten to relative ones so
 * the site works from a project page (https://user.github.io/repo/).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'docs');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });

// index.html: absolute -> relative asset references
const html = fs
  .readFileSync(path.join(SRC, 'index.html'), 'utf8')
  .replace(/(src|href)="\/(?!\/)/g, '$1="');

fs.writeFileSync(path.join(OUT, 'index.html'), html);

for (const file of ['styles.css', 'app.js', 'favicon.svg', '404.html']) {
  const from = path.join(SRC, file);
  if (!fs.existsSync(from)) continue;
  const out = fs
    .readFileSync(from, 'utf8')
    .replace(/(src|href)="\/(?!\/)/g, '$1="');
  fs.writeFileSync(path.join(OUT, file), out);
}

for (const img of fs.readdirSync(path.join(SRC, 'img'))) {
  fs.copyFileSync(path.join(SRC, 'img', img), path.join(OUT, 'img', img));
}

// Stops Pages running the files through Jekyll.
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

const leftovers = html.match(/(?:src|href)="\/[^/][^"]*"/g);
console.log('docs/ built' + (leftovers ? ` — WARNING absolute refs remain: ${leftovers}` : ' — all asset paths relative'));
