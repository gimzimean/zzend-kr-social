// 다음 차례 게시물을 인스타·틱톡에 올린다. GitHub Actions 가 월·수·금 20:00 KST 에 실행한다.
// 실행: node scripts/post.mjs            → 올림
//       node scripts/post.mjs --dry      → 무엇을 올릴지만 보여줌
//       node scripts/post.mjs --only instagram|tiktok
// 환경변수: TOKEN_KEY, TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_MODE(upload|direct, 기본 upload)
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadLocalEnv, loadTokens, saveTokens } from './tokens.mjs';

loadLocalEnv();
const root = resolve(import.meta.dirname, '..');
const BASE = 'https://gimzimean.github.io/zzend-kr-social/posts';
const TT = 'https://open.tiktokapis.com/v2';
const dry = process.argv.includes('--dry');
const onlyIdx = process.argv.indexOf('--only');
const only = onlyIdx > 0 ? process.argv[onlyIdx + 1] : null;

const content = JSON.parse(readFileSync(resolve(root, 'content.json'), 'utf8'));
const statePath = resolve(root, 'state.json');
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { instagram: [], tiktok: [] };
for (const k of ['instagram', 'story', 'threads', 'tiktok']) state[k] ??= [];
const tokens = dry ? {} : loadTokens();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const imagesOf = (id) => {
  const dir = resolve(root, 'docs/posts', id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.jpg'))
    .sort((a, b) => parseInt(a) - parseInt(b)).map((f) => `${BASE}/${id}/${f}`);
};
// 스토리는 피드에 이미 올라간 게시물만(스토리 버튼이 「피드에서 보기」라서).
const nextFor = (platform) => content.posts.find((p) => !state[platform].includes(p.id) && imagesOf(p.id).length
  && (platform !== 'story' || state.instagram.includes(p.id)));
const storyOf = (id) => `${BASE.replace(/posts$/, 'stories')}/${id}.jpg`;

async function json(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error?.code && body.error.code !== 'ok') {
    throw new Error(`${res.status} ${JSON.stringify(body.error ?? body)}`);
  }
  return body;
}

async function igClient() {
  const t = tokens.instagram;
  // 시스템 사용자 토큰(EAA…)은 graph.facebook.com, 인스타 로그인 토큰(IGAA…)은 graph.instagram.com.
  const fb = t.access_token.startsWith('EAA');
  const IG = fb ? 'https://graph.facebook.com/v23.0' : 'https://graph.instagram.com/v23.0';
  // 인스타 로그인 장기 토큰은 60일. 7일마다 새로 받아 둔다.
  if (!fb && Date.now() - (t.refreshed_at ?? 0) > 7 * 864e5) {
    const r = await json(await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${t.access_token}`));
    t.access_token = r.access_token;
    t.refreshed_at = Date.now();
    saveTokens(tokens);
  }
  const call = async (path, params) => json(await fetch(`${IG}/${path}`, {
    method: 'POST', body: new URLSearchParams({ ...params, access_token: t.access_token }),
  }));
  const ready = async (id) => {
    for (let i = 0; i < 30; i++) {
      const s = await json(await fetch(`${IG}/${id}?fields=status_code&access_token=${t.access_token}`));
      if (s.status_code === 'FINISHED') return;
      if (s.status_code === 'ERROR') throw new Error('인스타 처리 실패');
      await sleep(3000);
    }
  };
  return { t, call, ready };
}

async function postInstagram(post, urls) {
  const { t, call, ready } = await igClient();
  const children = [];
  for (const url of urls) children.push((await call(`${t.user_id}/media`, { image_url: url, is_carousel_item: 'true' })).id);
  const box = await call(`${t.user_id}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption: post.caption });
  await ready(box.id);
  const id = (await call(`${t.user_id}/media_publish`, { creation_id: box.id })).id;
  // 첫 댓글. 실패해도 게시물은 올라간 것으로 둔다.
  await call(`${id}/comments`, { message: commentOf(post, 'instagram') }).catch((e) => console.error(`[instagram] 댓글 실패: ${e.message}`));
  return id;
}

// 첫 댓글: 게시물에 comment 가 있으면 그것, 없으면 기본 문구.
const commentOf = (post, platform) => (typeof post.comment === 'string' ? post.comment : post.comment?.[platform]) ?? (platform === 'threads'
  ? '내 대화로 직접 해 보기 → https://zzend.kr/?src=th'
  : '여러분은 이런 답장 받아본 적 있나요?\n대화 붙여넣고 읽어 보려면 프로필 링크 → @zzend_official');

// 스레드: 같은 사진 묶음 + 게시물별 스레드 글 + 첫 답글에 링크. 장기 토큰 60일 → 7일마다 새로.
const TH = 'https://graph.threads.net/v1.0';
// 스레드 글은 게시물마다 따로 쓴다(해시태그 없음). 없으면 캡션에서 해시태그·프로필 링크 줄을 뺀다.
const threadsText = (post) => (post.threads ?? post.caption.replace(/\n*#[^\n]*$/, '').replace(/\n*프로필 링크[^\n]*/, '')).slice(0, 500);
async function postThreads(post, urls) {
  const t = tokens.threads;
  if (Date.now() - (t.refreshed_at ?? 0) > 7 * 864e5) {
    const r = await json(await fetch(`https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${t.access_token}`));
    Object.assign(t, { access_token: r.access_token, refreshed_at: Date.now() });
    saveTokens(tokens);
  }
  const call = async (path, params) => json(await fetch(`${TH}/${path}`, {
    method: 'POST', body: new URLSearchParams({ ...params, access_token: t.access_token }),
  }));
  const ready = async (id) => {
    for (let i = 0; i < 40; i++) {
      await sleep(3000);
      // 막 만든 항목은 몇 초 동안 「없음」으로 나올 수 있다.
      const s = await json(await fetch(`${TH}/${id}?fields=status,error_message&access_token=${t.access_token}`)).catch(() => ({}));
      if (s.status === 'FINISHED') return;
      if (s.status === 'ERROR') throw new Error(`스레드 처리 실패: ${s.error_message}`);
    }
  };
  const children = [];
  for (const url of urls) children.push((await call(`${t.user_id}/threads`, { media_type: 'IMAGE', image_url: url, is_carousel_item: 'true' })).id);
  for (const id of children) await ready(id);
  const box = await call(`${t.user_id}/threads`, { media_type: 'CAROUSEL', children: children.join(','), text: threadsText(post) });
  await ready(box.id);
  const id = (await call(`${t.user_id}/threads_publish`, { creation_id: box.id })).id;
  // 첫 댓글(답글). threads_manage_replies 권한이 없으면 글만 올리고 넘어간다.
  try {
    const reply = await call(`${t.user_id}/threads`, { media_type: 'TEXT', text: commentOf(post, 'threads'), reply_to_id: id });
    await ready(reply.id);
    await call(`${t.user_id}/threads_publish`, { creation_id: reply.id });
  } catch (e) { console.error(`[threads] 댓글 실패: ${e.message}`); }
  return id;
}

// 인스타 스토리: 세로 표지 한 장(docs/stories/<id>.jpg).
async function postStory(post) {
  const { t, call, ready } = await igClient();
  const box = await call(`${t.user_id}/media`, { media_type: 'STORIES', image_url: storyOf(post.id) });
  await ready(box.id);
  return (await call(`${t.user_id}/media_publish`, { creation_id: box.id })).id;
}

async function postTiktok(post, urls) {
  const t = tokens.tiktok;
  // 접근 토큰은 24시간. 1시간 남으면 새로 받는다(새 refresh_token 이 오면 같이 바꾼다).
  if ((t.expires_at ?? 0) - Date.now() < 36e5) {
    const r = await json(await fetch(`${TT}/oauth/token/`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY, client_secret: process.env.TIKTOK_CLIENT_SECRET,
        grant_type: 'refresh_token', refresh_token: t.refresh_token,
      }),
    }));
    Object.assign(t, { access_token: r.access_token, refresh_token: r.refresh_token ?? t.refresh_token, expires_at: Date.now() + r.expires_in * 1000 });
    saveTokens(tokens);
  }
  const call = async (path, body) => json(await fetch(`${TT}/${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${t.access_token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(body),
  }));
  // upload: 틱톡 앱 알림(초안)으로 보내고 사람이 눌러서 올림 — 앱 심사 전 기본값.
  // direct: 바로 공개 — 앱 심사 통과 뒤 TIKTOK_MODE=direct.
  const direct = process.env.TIKTOK_MODE === 'direct';
  const post_info = { title: post.title.slice(0, 90), description: post.caption.slice(0, 4000) };
  if (direct) {
    const info = (await call('post/publish/creator_info/query/', {})).data;
    const opts = info.privacy_level_options ?? [];
    Object.assign(post_info, {
      privacy_level: opts.includes('PUBLIC_TO_EVERYONE') ? 'PUBLIC_TO_EVERYONE' : opts[0],
      disable_comment: false, auto_add_music: true,
    });
  }
  const { publish_id } = (await call('post/publish/content/init/', {
    post_info, media_type: 'PHOTO', post_mode: direct ? 'DIRECT_POST' : 'MEDIA_UPLOAD',
    source_info: { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: urls },
  })).data;
  for (let i = 0; i < 40; i++) {
    const s = (await call('post/publish/status/fetch/', { publish_id })).data;
    if (['PUBLISH_COMPLETE', 'SEND_TO_USER_INBOX'].includes(s.status)) return `${publish_id} ${s.status}`;
    if (s.status === 'FAILED') throw new Error(`틱톡 실패: ${s.fail_reason}`);
    await sleep(3000);
  }
  throw new Error(`틱톡 처리 대기 시간 초과 (${publish_id})`);
}

let failed = false;
// story·threads 는 인스타 토큰·스레드 토큰을 쓴다.
const tokenOf = { instagram: 'instagram', story: 'instagram', threads: 'threads', tiktok: 'tiktok' };
for (const [platform, fn] of [['instagram', postInstagram], ['story', postStory], ['threads', postThreads], ['tiktok', postTiktok]]) {
  if (only && only !== platform) continue;
  const post = nextFor(platform);
  if (!post) { console.log(`[${platform}] 올릴 게시물이 없어요. content.json 에 새 게시물을 넣으세요.`); continue; }
  const urls = platform === 'story' ? [storyOf(post.id)] : imagesOf(post.id);
  if (dry) { console.log(`[${platform}] ${post.id} ${post.title}\n  ${urls.join('\n  ')}`); continue; }
  if (!tokens[tokenOf[platform]]) { console.log(`[${platform}] 토큰이 없어 건너뜀 (node scripts/auth.mjs ${tokenOf[platform]})`); continue; }
  try {
    const head = await fetch(urls[0], { method: 'HEAD' });
    if (!head.ok) throw new Error(`사진 주소가 아직 안 열려요: ${urls[0]} (${head.status})`);
    const id = await fn(post, urls);
    state[platform].push(post.id);
    writeFileSync(statePath, JSON.stringify(state, null, 1) + '\n');
    console.log(`[${platform}] ${post.id} 올림 → ${id}`);
  } catch (e) {
    failed = true;
    console.error(`[${platform}] ${post.id} 실패: ${e.message}`);
  }
}
if (failed) process.exit(1);
