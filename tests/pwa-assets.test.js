import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../public');

function readPngDimensions(filePath) {
  const buf = fs.readFileSync(filePath);
  // PNG signature check (89 50 4E 47 0D 0A 1A 0A)
  assert.equal(buf[0], 0x89);
  assert.equal(buf.toString('ascii', 1, 4), 'PNG');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

describe('PWA Manifest, Service Worker & Static Asset Verification', () => {
  it('has a valid manifest.json with existing 192x192 and 512x512 PNG icons for Android WebAPK', () => {
    const manifestPath = path.join(PUBLIC_DIR, 'manifest.json');
    assert.ok(fs.existsSync(manifestPath));

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.display, 'standalone');
    assert.ok(manifest.start_url === './index.html' || manifest.start_url === './');
    assert.equal(manifest.scope, './');
    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 4);

    for (const icon of manifest.icons) {
      const iconPath = path.resolve(PUBLIC_DIR, icon.src);
      assert.ok(fs.existsSync(iconPath), `Missing manifest icon file: ${icon.src}`);

      if (icon.type === 'image/png') {
        const { width, height } = readPngDimensions(iconPath);
        assert.equal(`${width}x${height}`, icon.sizes, `PNG icon ${icon.src} dimensions mismatch`);
      }
    }
  });

  it('lists only existing static files in pwa-sw.js ASSETS cache list', () => {
    const swPath = path.join(PUBLIC_DIR, 'pwa-sw.js');
    assert.ok(fs.existsSync(swPath));

    const swSource = fs.readFileSync(swPath, 'utf8');
    const assetsMatch = swSource.match(/const\s+ASSETS\s*=\s*\[([\s\S]*?)\];/);
    assert.ok(assetsMatch, 'Could not find ASSETS array in pwa-sw.js');

    const assetPaths = [...assetsMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.ok(assetPaths.length >= 8);

    for (const relPath of assetPaths) {
      if (relPath === './') continue;
      const fullPath = path.resolve(PUBLIC_DIR, relPath);
      assert.ok(fs.existsSync(fullPath), `Service Worker asset missing on disk: ${relPath}`);
    }
  });

  it('uses relative asset paths in index.html for GitHub Pages subpath hosting', () => {
    const htmlPath = path.join(PUBLIC_DIR, 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    assert.match(html, /href="\.\/manifest\.json"/);
    assert.match(html, /href="\.\/styles\.css"/);
    assert.match(html, /src="\.\/app\.js"/);
  });
});
