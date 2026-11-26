// Copies the offline game build and the demo server into this folder for packaging.
import { cpSync, rmSync } from 'node:fs';

rmSync('app', { recursive: true, force: true });
cpSync('../dist-offline', 'app', { recursive: true });
cpSync('../scripts/serve.mjs', 'serve.mjs');
console.log('Copied the offline build into desktop/app');
