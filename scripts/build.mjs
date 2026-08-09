import {build} from 'esbuild';
import {rm, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {POPUP_BASE_CSS} from 'syncer-extension-core/popup';

const root = path.resolve(import.meta.dirname, '..');
const outdir = path.join(root, 'generated');
await rm(outdir, {recursive: true, force: true});
await mkdir(outdir, {recursive: true});
await writeFile(path.join(outdir, 'popup-base.css'), `${POPUP_BASE_CSS}\n`);
await build({
  absWorkingDir: root,
  entryPoints: {background: 'background.js', 'main-content-script': 'main-content-script.js', popup: 'popup.js'},
  outdir,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome120',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
});
