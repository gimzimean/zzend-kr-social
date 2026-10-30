// 인스타·틱톡 계정 연결(한 번만). 로그인은 본인이 브라우저에서 한다.
// 스레드도 같다(threads). 인스타는 지금 Meta 대시보드 시스템 사용자 토큰을 쓴다.
// 1) node scripts/auth.mjs instagram          → 로그인 주소를 연다
// 2) 로그인 뒤 나온 페이지의 코드를 복사
// 3) node scripts/auth.mjs instagram <코드>   → tokens.enc 에 저장 (그다음 git push)
// 틱톡도 같다(instagram → tiktok). 앱 정보는 C:\zzend-keys\topnote-social.env
import { execSync } from 'node:child_process';
import { loadLocalEnv, loadTokens, saveTokens } from './tokens.mjs';

loadLocalEnv();
const [platform, code] = process.argv.slice(2);
const REDIRECT = 'https://gimzimean.github.io/topnote-social/callback.html';
const env = (k) => process.env[k] || (() => { throw new Error(`${k} 가 C:\\zzend-keys\\topnote-social.env 에 없어요`); })();

async function json(res) {
  const body = await res.json().catch(() => ({}));
  const err = typeof body.error === 'object' ? body.error?.code !== 'ok' && body.error : body.error;
  if (!res.ok || body.error_message || err) throw new Error(`${res.status} ${JSON.stringify(body)}`);
  return body;
}

if (platform === 'instagram' && !code) {
  const url = `https://www.instagram.com/oauth/authorize?${new URLSearchParams({
    client_id: env('IG_APP_ID'), redirect_uri: REDIRECT, response_type: 'code',
    scope: 'instagram_business_basic,instagram_business_content_publish', state: 'instagram',
  })}`;
  console.log(url);
  execSync(`start "" "${url}"`, { shell: 'cmd.exe' });
} else if (platform === 'instagram') {
  const short = await json(await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env('IG_APP_ID'), client_secret: env('IG_APP_SECRET'),
      grant_type: 'authorization_code', redirect_uri: REDIRECT, code: code.replace(/#_$/, ''),
    }),
  }));
  const long = await json(await fetch(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${env('IG_APP_SECRET')}&access_token=${short.access_token}`));
  const me = await json(await fetch(`https://graph.instagram.com/v23.0/me?fields=user_id,username&access_token=${long.access_token}`));
  const tokens = loadTokens();
  tokens.instagram = { access_token: long.access_token, user_id: me.user_id, username: me.username, refreshed_at: Date.now() };
  saveTokens(tokens);
  console.log(`인스타 @${me.username} 연결 완료 → tokens.enc 저장. git push 하세요.`);
} else if (platform === 'threads' && !code) {
  const url = `https://threads.net/oauth/authorize?${new URLSearchParams({
    client_id: env('THREADS_APP_ID'), redirect_uri: REDIRECT, response_type: 'code',
    scope: 'threads_basic,threads_content_publish,threads_manage_replies', state: 'threads',
  })}`;
  console.log(url);
  execSync(`start "" "${url}"`, { shell: 'cmd.exe' });
} else if (platform === 'threads') {
  const short = await json(await fetch('https://graph.threads.net/oauth/access_token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env('THREADS_APP_ID'), client_secret: env('THREADS_APP_SECRET'),
      grant_type: 'authorization_code', redirect_uri: REDIRECT, code: code.replace(/#_$/, ''),
    }),
  }));
  const long = await json(await fetch(`https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${env('THREADS_APP_SECRET')}&access_token=${short.access_token}`));
  const me = await json(await fetch(`https://graph.threads.net/v1.0/me?fields=id,username&access_token=${long.access_token}`));
  const tokens = loadTokens();
  tokens.threads = { access_token: long.access_token, user_id: me.id, username: me.username, refreshed_at: Date.now() };
  saveTokens(tokens);
  console.log(`스레드 @${me.username} 연결 완료 → tokens.enc 저장. git push 하세요.`);
} else if (platform === 'tiktok' && !code) {
  const url = `https://www.tiktok.com/v2/auth/authorize/?${new URLSearchParams({
    client_key: env('TIKTOK_CLIENT_KEY'), redirect_uri: REDIRECT, response_type: 'code',
    scope: 'user.info.basic,video.upload,video.publish', state: 'tiktok',
  })}`;
  console.log(url);
  execSync(`start "" "${url}"`, { shell: 'cmd.exe' });
} else if (platform === 'tiktok') {
  const r = await json(await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: env('TIKTOK_CLIENT_KEY'), client_secret: env('TIKTOK_CLIENT_SECRET'),
      grant_type: 'authorization_code', redirect_uri: REDIRECT, code: decodeURIComponent(code),
    }),
  }));
  const tokens = loadTokens();
  tokens.tiktok = { access_token: r.access_token, refresh_token: r.refresh_token, open_id: r.open_id, expires_at: Date.now() + r.expires_in * 1000 };
  saveTokens(tokens);
  console.log('틱톡 연결 완료 → tokens.enc 저장. git push 하세요.');
} else {
  console.log('사용법: node scripts/auth.mjs instagram|threads|tiktok [코드]');
}
