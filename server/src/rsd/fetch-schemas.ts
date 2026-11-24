// One-off: fetch the XSDs imported by the two production WSDLs so their element order/optionality
// can be checked against the envelopes this app builds. Read-only; writes to server/data
// (gitignored). Run from server/: npx tsx src/rsd/fetch-schemas.ts
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getRsdConfig } from './config.js';
import { fetchXml } from './soapClient.js';

const config = getRsdConfig();
const creds = { gln: config.gln, username: config.username, password: config.password };

for (const kind of ['sale', 'cancel'] as const) {
  const base = kind === 'sale' ? config.saleUrl : config.cancelUrl;
  const url = `${base}?xsd=1`;
  const result = await fetchXml(url, creds, config.timeoutMs);
  const file = path.resolve(process.cwd(), 'data', `rsd-xsd-${kind}.xsd`);
  await mkdir(path.dirname(file), { recursive: true });
  if (result.body) await writeFile(file, result.body, 'utf8');
  console.log(
    `${kind}: HTTP ${result.httpStatus ?? 'n/a'} ${result.networkError ?? ''} ${result.body.length} bytes -> ${file}`,
  );
}
