// Build produksi: bundel React dengan esbuild, salin file statis, tulis index.html.
//   npm run build   build sekali (diminify, nama file berhash)
//   npm run dev     bangun ulang otomatis tiap file berubah (refresh browser setelahnya)
import { build, context } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const watch = process.argv.includes('--watch');
const out = 'dist';
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });

function finish(metafile) {
  const files = Object.keys(metafile.outputs).map((f) => path.basename(f));
  const js = files.find((f) => f.endsWith('.js'));
  const css = files.find((f) => f.endsWith('.css'));
  if (!js || !css) throw new Error('Hasil build tidak lengkap.');
  fs.cpSync('public', out, { recursive: true });
  const html = fs.readFileSync('index.html', 'utf8').replace('%JS%', `/assets/${js}`).replace('%CSS%', `/assets/${css}`);
  fs.writeFileSync(path.join(out, 'index.html'), html);
  console.log(`[${new Date().toLocaleTimeString('id-ID')}] Build selesai: ${out}/ (${js}, ${css})`);
}

const options = {
  entryPoints: ['src/main.jsx'],
  bundle: true,
  minify: !watch,
  sourcemap: watch,
  format: 'esm',
  target: ['es2020', 'safari15', 'chrome100'],
  jsx: 'automatic',
  outdir: path.join(out, 'assets'),
  entryNames: watch ? 'app' : 'app-[hash]',
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
  metafile: true,
  logLevel: watch ? 'warning' : 'info',
};

if (watch) {
  const ctx = await context({
    ...options,
    plugins: [{ name: 'tulis-html', setup: (b) => b.onEnd((r) => { if (!r.errors.length) finish(r.metafile); }) }],
  });
  await ctx.watch();
  console.log('Memantau perubahan di web/src. Setelah tulisan "Build selesai" muncul, refresh browser. Hentikan dengan Ctrl+C.');
} else {
  finish((await build(options)).metafile);
}
