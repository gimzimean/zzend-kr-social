// 인스타·틱톡 토큰은 tokens.enc 에 AES-256-GCM 으로 암호화해 저장소에 둔다.
// 토큰은 주기적으로 새로 받아야 해서(인스타 60일, 틱톡 24시간) GitHub 비밀에 둘 수 없다.
// 키는 TOKEN_KEY(base64 32바이트) — GitHub 비밀과 C:\zzend-keys\topnote-social.env 에만 있다.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve(import.meta.dirname, '..', 'tokens.enc');
const key = () => {
  const k = Buffer.from(process.env.TOKEN_KEY ?? '', 'base64');
  if (k.length !== 32) throw new Error('TOKEN_KEY가 없거나 32바이트가 아니에요');
  return k;
};

export function loadTokens() {
  if (!existsSync(file)) return {};
  const raw = Buffer.from(readFileSync(file, 'utf8'), 'base64');
  const d = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8'));
}

export function saveTokens(tokens) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(JSON.stringify(tokens), 'utf8'), c.final()]);
  writeFileSync(file, Buffer.concat([iv, c.getAuthTag(), body]).toString('base64'));
}

// 로컬 실행용: C:\zzend-keys\topnote-social.env 를 process.env 에 읽어 들인다.
export function loadLocalEnv() {
  const p = 'C:/zzend-keys/topnote-social.env';
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
