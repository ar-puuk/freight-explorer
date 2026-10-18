// Remove the previous build's hashed assets and entry page from docs/ (data/ and the docs markdown stay).
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const docs = resolve(import.meta.dirname, '../../docs');
for (const p of ['assets', 'index.html', 'methodology.html']) rmSync(resolve(docs, p), { recursive: true, force: true });
