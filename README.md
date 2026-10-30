# ZZEND 국내판 소셜 자동 게시 (@zzend_official)

`gimzimean/topnote-social`과 같은 구조. 올릴 때마다 인스타 피드 묶음 → 스토리 → 스레드(게시물별 `threads` 글) → 각자 첫 댓글.

- 게시물: `content.json` (body 는 문장 / 목록 / `{chat: [[them|me|z, 말]]}` 대화)
- 이미지: push 하면 `build.yml` 이 `docs/posts`, `docs/stories` 생성 (로컬: `node scripts/build.mjs`)
- 올리기: `post.yml` (화·목·토 20:00 KST), 기록 `state.json`
- 토큰: `tokens.enc` (키 `TOKEN_KEY` = `C:\zzend-keys\topnote-social.env` 와 같은 값)
- 인스타 토큰: Meta 앱 TopNote Social 대시보드 「액세스 토큰 생성」에서 zzend_official
- 스레드: `node scripts/auth.mjs threads` (zzend_official 이 Threads 테스터여야 함)

규칙: 인스타 본문에 주소 금지(「프로필 링크 → @zzend_official」), 스레드는 해시태그 없음, 링크는 첫 답글에 `zzend.kr/?src=th`. 영어 계정 @zzend.app 과 섞지 않는다.
