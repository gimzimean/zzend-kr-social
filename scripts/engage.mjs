// 우리 게시물에 달린 인스타 댓글·스레드 답글, 우리를 태그·언급한 글에 짧게 답한다. GitHub Actions 가 2시간마다 실행한다.
// 다른 사람 게시물에 좋아요·팔로우·댓글은 공식 API 가 없고 자동 클릭은 규칙 위반이라 하지 않는다.
// 실행: node scripts/engage.mjs          → 답함
//       node scripts/engage.mjs --dry    → 누구에게 답할지만 보여줌
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadLocalEnv, loadTokens, saveTokens } from './tokens.mjs';

loadLocalEnv();
const root = resolve(import.meta.dirname, '..');
const dry = process.argv.includes('--dry');
const MAX = 10; // 한 번에 답할 최대 수(스팸으로 보이지 않게)
const DAYS = 14; // 이보다 오래된 게시물의 댓글은 건너뜀
const statePath = resolve(root, 'engaged.json');
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
state.instagram ??= [];
state.threads ??= [];
state.mentions ??= [];
const tokens = loadTokens();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 같은 말만 반복하지 않게 몇 개를 돌려 쓴다. 결과를 약속하는 말은 쓰지 않는다.
const LINES = [
  '댓글 고마워요 🙂',
  '이야기 나눠 주셔서 고마워요.',
  '읽어 주셔서 고마워요. 다음 카드도 곧 올라와요.',
  '소중한 의견 고마워요!',
  '공감해 주셔서 고마워요. 편하게 또 남겨 주세요.',
];
const lineFor = (id) => LINES[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % LINES.length];
// 링크가 든 댓글은 광고일 수 있어 답하지 않는다.
const skip = (text) => !text?.trim() || /https?:\/\/|www\./i.test(text);
const recent = (ts) => Date.now() - Date.parse(ts) < DAYS * 864e5;

async function json(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(`${res.status} ${JSON.stringify(body.error ?? body)}`);
  return body;
}

let done = 0;
let failed = false;

async function instagram() {
  const t = tokens.instagram;
  const IG = t.access_token.startsWith('EAA') ? 'https://graph.facebook.com/v23.0' : 'https://graph.instagram.com/v23.0';
  const get = async (path) => json(await fetch(`${IG}/${path}${path.includes('?') ? '&' : '?'}access_token=${t.access_token}`));
  const media = (await get(`${t.user_id}/media?fields=id,timestamp&limit=15`)).data.filter((m) => recent(m.timestamp));
  for (const m of media) {
    const comments = (await get(`${m.id}/comments?fields=id,text,username,replies{username}&limit=50`)).data ?? [];
    for (const c of comments) {
      if (done >= MAX) return;
      if (state.instagram.includes(c.id) || c.username === t.username || skip(c.text)) continue;
      // 이미 사람이 직접 답한 댓글은 건너뜀
      if (c.replies?.data?.some((r) => r.username === t.username)) { state.instagram.push(c.id); continue; }
      const text = `@${c.username} ${lineFor(c.id)}`;
      if (dry) { console.log(`[instagram] ${c.username}: ${c.text}\n  → ${text}`); continue; }
      await json(await fetch(`${IG}/${c.id}/replies`, {
        method: 'POST', body: new URLSearchParams({ message: text, access_token: t.access_token }),
      }));
      state.instagram.push(c.id);
      done++;
      console.log(`[instagram] ${c.username} 에게 답함`);
      await sleep(5000);
    }
  }
  // 우리를 태그한 다른 사람 게시물에 고맙다는 댓글(공식 「언급에 답하기」 API).
  const tagged = (await get(`${t.user_id}/tags?fields=id,username,caption,timestamp&limit=20`)).data ?? [];
  for (const m of tagged.filter((x) => recent(x.timestamp))) {
    const key = `ig:${m.id}`;
    if (done >= MAX) return;
    if (state.mentions.includes(key) || m.username === t.username) continue;
    const text = '태그해 주셔서 고마워요 🙂';
    if (dry) { console.log(`[instagram 태그] ${m.username}: ${m.caption ?? ''}
  → ${text}`); continue; }
    await json(await fetch(`${IG}/${t.user_id}/mentions`, {
      method: 'POST', body: new URLSearchParams({ media_id: m.id, message: text, access_token: t.access_token }),
    }));
    state.mentions.push(key);
    done++;
    console.log(`[instagram 태그] ${m.username} 에게 답함`);
    await sleep(5000);
  }
}

const TH = 'https://graph.threads.net/v1.0';
async function threads() {
  const t = tokens.threads;
  if (Date.now() - (t.refreshed_at ?? 0) > 7 * 864e5) {
    const r = await json(await fetch(`https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${t.access_token}`));
    Object.assign(t, { access_token: r.access_token, refreshed_at: Date.now() });
    saveTokens(tokens);
  }
  const get = async (path) => json(await fetch(`${TH}/${path}${path.includes('?') ? '&' : '?'}access_token=${t.access_token}`));
  const post = async (path, params) => json(await fetch(`${TH}/${path}`, {
    method: 'POST', body: new URLSearchParams({ ...params, access_token: t.access_token }),
  }));
  const reply = async (id, text) => {
    const box = await post(`${t.user_id}/threads`, { media_type: 'TEXT', text, reply_to_id: id });
    await sleep(5000); // 글자만 있는 답글은 몇 초면 준비된다
    await post(`${t.user_id}/threads_publish`, { creation_id: box.id });
  };
  // 우리를 언급한 글에 먼저 답한다.
  const mentions = (await get(`${t.user_id}/mentions?fields=id,text,username,timestamp&limit=20`)).data ?? [];
  for (const m of mentions.filter((x) => recent(x.timestamp))) {
    const key = `th:${m.id}`;
    if (done >= MAX) return;
    if (state.mentions.includes(key) || m.username === t.username || skip(m.text)) continue;
    const text = '언급해 주셔서 고마워요 🙂';
    if (dry) { console.log(`[threads 언급] ${m.username}: ${m.text}
  → ${text}`); continue; }
    await reply(m.id, text);
    state.mentions.push(key);
    done++;
    console.log(`[threads 언급] ${m.username} 에게 답함`);
    await sleep(5000);
  }
  const posts = (await get(`${t.user_id}/threads?fields=id,timestamp&limit=15`)).data.filter((p) => recent(p.timestamp));
  for (const p of posts) {
    const replies = (await get(`${p.id}/replies?fields=id,text,username&limit=50`)).data ?? [];
    for (const r of replies) {
      if (done >= MAX) return;
      if (state.threads.includes(r.id) || r.username === t.username || skip(r.text)) continue;
      const text = lineFor(r.id);
      if (dry) { console.log(`[threads] ${r.username}: ${r.text}\n  → ${text}`); continue; }
      await reply(r.id, text);
      state.threads.push(r.id);
      done++;
      console.log(`[threads] ${r.username} 에게 답함`);
      await sleep(5000);
    }
  }
}

for (const [name, fn] of [['instagram', instagram], ['threads', threads]]) {
  if (!tokens[name]) { console.log(`[${name}] 토큰이 없어 건너뜀`); continue; }
  try { await fn(); } catch (e) { failed = true; console.error(`[${name}] 실패: ${e.message}`); }
}
// 기록은 최근 500개만 남긴다.
for (const k of ['instagram', 'threads', 'mentions']) state[k] = state[k].slice(-500);
if (!dry) writeFileSync(statePath, JSON.stringify(state, null, 1) + '\n');
console.log(`답한 수 ${done}`);
if (failed) process.exit(1);
