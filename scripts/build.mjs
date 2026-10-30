// content.json의 게시물을 docs/posts/<id>/1.jpg … 로, 스토리용 세로 표지를 docs/stories/<id>.jpg 로 만든다(인스타는 JPEG만 받음).
// 실행(로컬): node scripts/build.mjs        → 아직 없는 게시물만
//             node scripts/build.mjs all    → 전부 다시
// playwright: 이 저장소에 설치돼 있으면(Actions) 그것, 없으면 C:\topnote-app 것을 빌려 쓴다.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(existsSync(resolve(root, 'node_modules/playwright')) ? resolve(root, 'package.json') : 'C:/topnote-app/package.json');
const { chromium } = require('playwright');
const c = JSON.parse(readFileSync(resolve(root, 'content.json'), 'utf8'));

// ZZEND 국내판 디자인: 밝은 바탕 #F6F5F2 · 짙은 #17181d · 장미색 점 #e0435c, Pretendard, 「ZZEND.」
const b64 = (p) => readFileSync(resolve(root, p)).toString('base64');
const css = `
@font-face{font-family:Pre;font-weight:400;src:url(data:font/otf;base64,${b64('assets/fonts/Pretendard-Regular.otf')})}
@font-face{font-family:Pre;font-weight:700;src:url(data:font/otf;base64,${b64('assets/fonts/Pretendard-Bold.otf')})}
@font-face{font-family:Pre;font-weight:900;src:url(data:font/otf;base64,${b64('assets/fonts/Pretendard-Black.otf')})}
*{margin:0;padding:0;box-sizing:border-box}
body{width:1080px;height:1350px;overflow:hidden;font-family:Pre,sans-serif;-webkit-font-smoothing:antialiased}
.page{position:relative;width:1080px;height:1350px;padding:110px 96px;display:flex;flex-direction:column;background:#F6F5F2;color:#17181d}
.dark{background:#17181d;color:#F6F5F2}
.mark{font-weight:900;font-size:56px;letter-spacing:-3px;line-height:1}
.mark i{font-style:normal;color:#e0435c}
.kicker{font-size:30px;letter-spacing:4px;font-weight:700;color:#e0435c;margin-top:72px}
.cover .kicker{margin-top:auto}
h1{font-weight:900;font-size:92px;line-height:1.25;letter-spacing:-3px;margin-top:28px;word-break:keep-all}
h2{font-weight:900;font-size:76px;line-height:1.28;letter-spacing:-2px;margin-top:24px;word-break:keep-all}
p{font-size:38px;line-height:1.65;margin-top:48px;color:#75767d;word-break:keep-all}
.dark p{color:#b9bac0}
.list{margin-top:56px;display:flex;flex-direction:column;gap:36px}
.list div{font-size:42px;font-weight:700;border-top:2px solid #e3e1db;padding-top:32px}
.list span{display:block;font-size:32px;font-weight:400;color:#75767d;margin-top:10px}
.chat{margin-top:64px;display:flex;flex-direction:column;gap:24px}
.chat div{max-width:78%;font-size:40px;line-height:1.45;padding:26px 34px;border-radius:36px;word-break:keep-all}
.chat .them{align-self:flex-start;background:#fff;border:2px solid #e3e1db}
.chat .me{align-self:flex-end;background:#e0435c;color:#fff}
.chat .z{align-self:stretch;max-width:none;background:#17181d;color:#F6F5F2;border-radius:24px;font-size:36px}
.chat .z b{color:#e0435c;font-weight:700;display:block;font-size:28px;letter-spacing:3px;margin-bottom:10px}
.foot{margin-top:auto;display:flex;justify-content:space-between;font-size:26px;letter-spacing:3px;color:#9a9ba1}
.cover .foot{margin-top:72px}
.end{justify-content:center}
.btn{margin-top:64px;align-self:flex-start;border:2px solid #e0435c;color:#F6F5F2;border-radius:999px;padding:20px 48px;font-size:34px}
.story{width:1080px;height:1920px;padding:200px 96px 280px}
.story h1{font-size:104px}
`;

const mark = '<div class="mark">ZZEND<i>.</i></div>';
const foot = `<div class="foot"><span>${c.name}</span><span>${c.handle}</span></div>`;
// body: 문장 / [[제목, 설명], …] 목록 / {chat: [[them|me|z, 말], …]} 대화
const body = (b) => Array.isArray(b)
  ? `<div class="list">${b.map(([t, s]) => `<div>${t}<span>${s}</span></div>`).join('')}</div>`
  : b?.chat
    ? `<div class="chat">${b.chat.map(([who, t]) => `<div class="${who}">${who === 'z' ? '<b>ZZEND</b>' : ''}${t}</div>`).join('')}</div>`
    : `<p>${b}</p>`;
const pagesOf = (post) => {
  const end = post.end ?? c.end;
  return [
    `<div class="page dark cover">${mark}<div class="kicker">${post.tag ?? c.tag}</div><h1>${post.cover[0]}</h1><p>${post.cover[1]}</p>${foot}</div>`,
    ...post.slides.map(([t, b], i) => `<div class="page">${mark}<div class="kicker">${String(i + 1).padStart(2, '0')}</div><h2>${t}</h2>${body(b)}${foot}</div>`),
    `<div class="page dark">${mark}<div class="end page dark" style="padding:0;height:auto;flex:1"><h2>${end[0]}</h2><p>${end[1]}</p><div class="btn">${c.cta}</div></div>${foot}</div>`,
  ];
};
const storyOf = (post) => `<div class="page dark cover story">${mark}<div class="kicker">${post.tag ?? c.tag}</div><h1>${post.cover[0]}</h1><p>${post.cover[1]}</p><div class="btn">새 게시물 · 피드에서 보기</div>${foot}</div>`;

const all = process.argv[2] === 'all';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
for (const post of c.posts) {
  const out = resolve(root, 'docs/posts', post.id);
  if (!all && existsSync(resolve(out, '1.jpg'))) continue;
  mkdirSync(out, { recursive: true });
  for (const [i, html] of pagesOf(post).entries()) {
    await page.setContent(`<html><head><style>${css}</style></head><body>${html}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: resolve(out, `${i + 1}.jpg`), type: 'jpeg', quality: 92 });
  }
  console.log(post.id, post.title);
}
mkdirSync(resolve(root, 'docs/stories'), { recursive: true });
await page.setViewportSize({ width: 1080, height: 1920 });
for (const post of c.posts) {
  const file = resolve(root, 'docs/stories', `${post.id}.jpg`);
  if (!all && existsSync(file)) continue;
  await page.setContent(`<html><head><style>${css}body{height:1920px}</style></head><body>${storyOf(post)}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: file, type: 'jpeg', quality: 92 });
  console.log('story', post.id);
}
await browser.close();
