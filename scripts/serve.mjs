import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const flag = process.env.useMockReports;
if (flag !== undefined && flag !== 'true' && flag !== 'false') {
  console.error('useMockReports debe ser true o false.');
  process.exitCode = 1;
} else {
  const demo = flag === 'true';
  const args = process.argv.slice(2);
  if (demo && args.length) {
    console.error('Usa npm run start:reports-demo para personalizar el servidor de demostración.');
    process.exitCode = 1;
  } else {
    const cli = fileURLToPath(new URL('../node_modules/@angular/cli/bin/ng.js', import.meta.url));
    const server = spawn(process.execPath, [cli, 'serve', ...(demo
      ? ['--configuration', 'reports-demo', '--host', '127.0.0.1']
      : args)], { stdio: 'inherit' });
    server.on('exit', (code) => { process.exitCode = code ?? 1; });
    server.on('error', (error) => { console.error(error); process.exitCode = 1; });
  }
}
