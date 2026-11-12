import { copyFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

await mkdir('dist/admin', { recursive: true });
await Promise.all([
  ...['index.html', 'login.html', 'daftar.html', 'admin/login.html', 'style.css'].map(
    file => copyFile(file, 'dist/' + file)
  ),
  build({
    entryPoints: ['secure-app.js'],
    outfile: 'dist/secure-app.js',
    bundle: true,
    format: 'esm',
    target: ['es2022', 'safari16']
  })
]);
