#!/usr/bin/env node
/**
 * build-index.mjs — 재수집 후 references/ 를 스킬이 쓰는 모양으로 정리한다.
 *
 * fetch-faq.mjs 는 목차를 출력 폴더 안(references/faq/INDEX.md)에 만들고,
 * 링크도 같은 폴더 기준(`faq-0189.md`)으로 쓴다. 스킬은 목차를 한 단계 위
 * references/INDEX.md 에 두므로 링크 경로를 `faq/faq-0189.md` 로 올려 옮긴다.
 *
 * 덤으로 references/CATEGORIES.md 를 만든다. INDEX.md 는 226KB라 통째로 읽으면
 * 컨텍스트만 태우는데, 카테고리 지도(~170줄)만 있으면 --cat 으로 좁힐 수 있다.
 *
 *   node build-index.mjs        (tools/ 에서 실행)
 */
import { readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REF = path.resolve(HERE, '..', 'references');
const FAQ = path.join(REF, 'faq');
const SRC = path.join(FAQ, 'INDEX.md');
const DEST = path.join(REF, 'INDEX.md');

// ── 1. INDEX.md 를 한 단계 위로, 링크 경로 보정 ──────────────────────────────
let t;
try {
  t = await readFile(SRC, 'utf8');
} catch {
  console.error(`${SRC} 가 없습니다. 먼저 재수집하세요:  npm run refresh`);
  process.exit(1);
}

t = t.replace(/\]\((faq-\d+\.md)\)/g, '](faq/$1)');
t = t.replace(
  /^출처: (.*)$/m,
  `출처: $1
라이선스: 아래 문서 본문의 저작권은 네이버(주)에 있습니다. NOTICE.md 참고.`
);

await writeFile(DEST, t);
await rm(SRC, { force: true });
const linked = (t.match(/\]\(faq\//g) || []).length;

// ── 2. CATEGORIES.md 생성 ────────────────────────────────────────────────────
// 카테고리 순서는 INDEX.md 의 '## ' 등장 순서를 따른다. 네이버 도움말 자신의
// 정보 구조라, 가나다순으로 다시 정렬하면 오히려 찾기 어려워진다.
const order = [];
for (const line of t.split('\n')) {
  const m = /^## (.+)$/.exec(line);
  if (m && !order.includes(m[1])) order.push(m[1]);
}

const files = (await readdir(FAQ)).filter((f) => /^faq-\d+\.md$/.test(f));
const counts = new Map();
for (const f of files) {
  const src = await readFile(path.join(FAQ, f), 'utf8');
  const m = /^category: (.*)$/m.exec(src);
  let cat = '(미분류)';
  if (m) {
    try {
      cat = JSON.parse(m[1].trim());
    } catch {
      cat = m[1].trim();
    }
  }
  counts.set(cat, (counts.get(cat) || 0) + 1);
}

// INDEX.md 에 없던 카테고리도 빠뜨리지 않는다
for (const c of counts.keys()) if (!order.includes(c)) order.push(c);

const roots = new Map();
for (const cat of order) {
  const n = counts.get(cat);
  if (!n) continue;
  const [root, ...rest] = cat.split(' > ');
  if (!roots.has(root)) roots.set(root, { total: 0, subs: [] });
  const r = roots.get(root);
  r.total += n;
  r.subs.push([rest.join(' > '), n]);
}

const out = [
  '# 카테고리 지도',
  '',
  `문서 ${files.length}건 / 카테고리 ${counts.size}개. 네이버 도움말 자신의 분류 순서를 그대로 따른다.`,
  '',
  '검색어가 잘 안 걸릴 때 여기서 범위를 잡고 다시 찾는다:',
  '',
  '```bash',
  'node scripts/search.mjs "<질의>" --cat "<카테고리 일부>"',
  'node scripts/search.mjs --cat "<카테고리 일부>"     # 질의 없이 훑기 (조회수 순)',
  '```',
  '',
  '문서 전체 목록은 `INDEX.md` — 226KB라 통째로 읽지 말고 grep 하거나 search.mjs 를 쓸 것.',
  '',
];
for (const [root, r] of roots) {
  out.push(`## ${root} — ${r.total}건`, '');
  for (const [sub, n] of r.subs) out.push(sub ? `- ${sub} (${n})` : `- (루트 직속) (${n})`);
  out.push('');
}

await writeFile(path.join(REF, 'CATEGORIES.md'), out.join('\n'));

console.log(
  `references/INDEX.md 갱신 — 문서 ${linked}건 링크\n` +
    `references/CATEGORIES.md 갱신 — 루트 ${roots.size}개 / 카테고리 ${counts.size}개`
);
