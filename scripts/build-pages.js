'use strict';

/**
 * Builds the GitHub Pages copy into the repo root.
 *
 * Pages serves this repo from the root of `main`, so the static site lives
 * alongside the source: same files as public/, with absolute asset paths
 * rewritten to relative ones. `.nojekyll` stops Pages running the repo
 * through Jekyll (which would otherwise publish README.md as the homepage).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public');

const PAGES = ['index.html', 'styles.css', 'app.js', 'favicon.svg', '404.html', 'robots.txt'];

// Custom domain for GitHub Pages. Pages reads this file on every deploy; if it
// goes missing the site falls back to the github.io URL and HTTPS breaks.
const DOMAIN = 'gounarinyberg.com';

for (const file of PAGES) {
  const from = path.join(SRC, file);
  if (!fs.existsSync(from)) continue;
  const out = fs.readFileSync(from, 'utf8').replace(/(src|href)="\/(?!\/)/g, '$1="');
  fs.writeFileSync(path.join(ROOT, file), out);
}

fs.mkdirSync(path.join(ROOT, 'img'), { recursive: true });
for (const img of fs.readdirSync(path.join(SRC, 'img'))) {
  fs.copyFileSync(path.join(SRC, 'img', img), path.join(ROOT, 'img', img));
}

fs.writeFileSync(path.join(ROOT, '.nojekyll'), '');
fs.writeFileSync(path.join(ROOT, 'CNAME'), DOMAIN + '\n');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const absolute = html.match(/(?:src|href)="\/[^/][^"]*"/g);
console.log(
  'pages build written to repo root' +
    (absolute ? ` — WARNING absolute refs remain: ${absolute}` : ' — all asset paths relative')
);
