import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');
const sourceDir = path.join(rootDir, 'client', 'dist');
const targetDir = path.join(rootDir, 'server', 'public');

if (!fs.existsSync(sourceDir)) {
  throw new Error(`Client build output not found: ${sourceDir}`);
}

fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(targetDir, { recursive: true });
fs.cpSync(sourceDir, targetDir, { recursive: true });
