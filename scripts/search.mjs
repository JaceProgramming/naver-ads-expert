#!/usr/bin/env node
/**
 * search.mjs — references/faq/ 1148건에서 관련 문서를 찾는다.
 *
 * 왜 필요한가: 문서가 1148개라 SKILL.md 에 "이 질문이면 이 파일" 라우팅 표를 넣을 수 없다.
 * 목차(references/INDEX.md)도 226KB라 통째로 읽으면 컨텍스트만 태우고 답은 못 찾는다.
 * 그래서 질문 → 문서 3~5개로 좁히는 일을 이 스크립트가 대신한다.
 *
 * 의존성 없음, Node 18+. 어느 디렉터리에서 실행해도 된다.
 *
 *   node scripts/search.mjs "파워링크 노출 순위"
 *   node scripts/search.mjs "품질지수" --limit 5
 *   node scripts/search.mjs "입찰" --cat "쇼핑검색"      카테고리 안에서만
 *   node scripts/search.mjs --cat "광고 검토"            질의 없이 카테고리 훑기
 *   node scripts/search.mjs --tree                      카테고리 트리 + 문서 수
 *   node scripts/search.mjs --show 189                  문서 전문 출력
 *   node scripts/search.mjs "환불" --json               기계 판독용
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAQ_DIR = path.resolve(HERE, '..', 'references', 'faq');
const UPDATES_FILE = path.resolve(HERE, '..', 'references', 'UPDATES.md');

// ── 인자 파싱 ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opt = { limit: 8, cat: '', json: false, tree: false, show: '', query: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--limit') opt.limit = Number(argv[++i]) || 8;
  else if (a === '--cat') opt.cat = argv[++i] || '';
  else if (a === '--show') opt.show = argv[++i] || '';
  else if (a === '--json') opt.json = true;
  else if (a === '--tree') opt.tree = true;
  else if (a === '-h' || a === '--help') opt.help = true;
  else opt.query.push(a);
}
const query = opt.query.join(' ').trim();

if (opt.help || (!query && !opt.cat && !opt.tree && !opt.show)) {
  console.log(`사용법:
  node scripts/search.mjs "<질문이나 키워드>"     관련 문서 랭킹 검색
  node scripts/search.mjs "<질의>" --cat "<카테고리 일부>"
  node scripts/search.mjs --cat "<카테고리 일부>"  해당 카테고리 문서 나열
  node scripts/search.mjs --tree                  카테고리 트리
  node scripts/search.mjs --show <번호|파일명>     문서 전문

옵션: --limit N (기본 8) · --json`);
  process.exit(0);
}

// ── 로딩 ─────────────────────────────────────────────────────────────────────
async function load() {
  let files;
  try {
    files = (await readdir(FAQ_DIR)).filter((f) => /^faq-\d+\.md$/.test(f)).sort();
  } catch {
    console.error(`원문 폴더가 없습니다: ${FAQ_DIR}
tools/ 에서 재수집하세요:  cd tools && npm install && npm run refresh`);
    process.exit(1);
  }
  if (!files.length) {
    console.error(`원문이 0건입니다: ${FAQ_DIR}`);
    process.exit(1);
  }
  return Promise.all(
    files.map(async (file) => {
      const src = await readFile(path.join(FAQ_DIR, file), 'utf8');
      const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
      const fm = m ? m[1] : '';
      const body = m ? src.slice(m[0].length) : src;
      const get = (k) => {
        const r = new RegExp(`^${k}: (.*)$`, 'm').exec(fm);
        return r ? r[1].trim() : '';
      };
      // front matter 값은 fetch-faq.mjs 가 JSON.stringify 로 쓴다
      const unq = (s) => {
        if (!s) return '';
        try {
          return s.startsWith('"') || s.startsWith('[') ? JSON.parse(s) : s;
        } catch {
          return s;
        }
      };
      return {
        file,
        title: unq(get('title')) || file,
        category: unq(get('category')) || '(미분류)',
        tags: unq(get('tags')) || [],
        seq: Number(get('faq_seq')) || 0,
        updated: unq(get('updated')),
        source: unq(get('source')),
        reads: Number(get('read_count')) || 0,
        body,
      };
    })
  );
}

// ── 최근 공지 (references/UPDATES.md) ────────────────────────────────────────
//
// FAQ 원문은 스냅샷이라 그 뒤 공지로 바뀐 내용을 모른다. UPDATES.md 가 그 틈을 메운다.
//   · "| faq-NNNN | 바뀐 내용 | ..." 표 행 → 그 문서가 결과에 나오면 ⚠ 를 붙인다
//   · "## YYYY-MM-DD · 제목" 섹션   → 검색어가 걸리면 결과 맨 위에 띄운다
// 파일이 없어도 검색은 그대로 동작한다.
async function loadUpdates() {
  const out = { overrides: new Map(), entries: [] };
  let src;
  try {
    src = await readFile(UPDATES_FILE, 'utf8');
  } catch {
    return out;
  }
  for (const m of src.matchAll(/^\|\s*faq-(\d+)\s*\|\s*(.+?)\s*\|/gm)) {
    out.overrides.set(Number(m[1]), m[2]);
  }
  const parts = src.split(/^## /m).slice(1);
  for (const p of parts) {
    const nl = p.indexOf('\n');
    const heading = p.slice(0, nl).trim();
    if (!/^\d{4}-\d{2}-\d{2}/.test(heading)) continue; // 표·출처 섹션은 제외
    const body = p.slice(nl + 1).split(/^---$/m)[0];
    out.entries.push({ heading, body, lc: (heading + '\n' + body).toLowerCase() });
  }
  return out;
}

const docs = await load();
const updates = await loadUpdates();
for (const d of docs) {
  d.lcTitle = d.title.toLowerCase();
  d.lcCat = d.category.toLowerCase();
  d.lcTags = d.tags.join(' ').toLowerCase();
  d.lcBody = d.body.toLowerCase();
}

// ── --show ───────────────────────────────────────────────────────────────────
if (opt.show) {
  const key = /^\d+$/.test(opt.show)
    ? `faq-${String(opt.show).padStart(4, '0')}.md`
    : opt.show.endsWith('.md')
      ? opt.show
      : `${opt.show}.md`;
  const d = docs.find((x) => x.file === key);
  if (!d) {
    console.error(`없는 문서: ${opt.show}`);
    process.exit(1);
  }
  console.log(await readFile(path.join(FAQ_DIR, d.file), 'utf8'));
  if (updates.overrides.has(d.seq)) {
    console.log(`\n⚠ 이 문서는 이후 공지로 바뀐 부분이 있다 (references/UPDATES.md):\n  ${updates.overrides.get(d.seq)}`);
  }
  process.exit(0);
}

// ── --tree ───────────────────────────────────────────────────────────────────
if (opt.tree && !query) {
  const counts = new Map();
  for (const d of docs) counts.set(d.category, (counts.get(d.category) || 0) + 1);
  const roots = new Map();
  for (const [cat, n] of counts) {
    const root = cat.split(' > ')[0];
    if (!roots.has(root)) roots.set(root, { total: 0, subs: [] });
    const r = roots.get(root);
    r.total += n;
    r.subs.push([cat.split(' > ').slice(1).join(' > '), n]);
  }
  console.log(`카테고리 트리 — 문서 ${docs.length}건 / 카테고리 ${counts.size}개\n`);
  for (const [root, r] of roots) {
    console.log(`■ ${root}  (${r.total}건)`);
    for (const [sub, n] of r.subs) if (sub) console.log(`    ${sub}  (${n})`);
    console.log('');
  }
  process.exit(0);
}

// ── 카테고리 필터 ────────────────────────────────────────────────────────────
let pool = docs;
if (opt.cat) {
  const c = opt.cat.toLowerCase();
  pool = docs.filter((d) => d.lcCat.includes(c));
  if (!pool.length) {
    console.error(`"${opt.cat}" 에 해당하는 카테고리가 없습니다. --tree 로 목록을 확인하세요.`);
    process.exit(1);
  }
}

// 질의 없이 카테고리만 준 경우 — 조회수 순으로 나열
if (!query) {
  const list = [...pool].sort((a, b) => b.reads - a.reads).slice(0, opt.limit === 8 ? 40 : opt.limit);
  if (opt.json) {
    console.log(JSON.stringify(list.map(strip), null, 2));
    process.exit(0);
  }
  console.log(`카테고리 "${opt.cat}" — ${pool.length}건 중 조회수 상위 ${list.length}건\n`);
  for (const d of list) {
    console.log(`  ${d.file}  ${d.title}`);
    console.log(`      ${d.category} · 수정 ${d.updated} · 조회 ${d.reads.toLocaleString()}`);
    if (updates.overrides.has(d.seq)) console.log(`      ⚠ 공지로 바뀐 부분 있음 — references/UPDATES.md`);
  }
  process.exit(0);
}

// ── 검색 ─────────────────────────────────────────────────────────────────────
//
// 한국어는 띄어쓰기로 형태소가 갈리지 않아서 토크나이저 없이는 정확히 못 자른다.
// 대신 (1) 부분 문자열 매칭 — 한국어 합성어는 붙여 쓰므로 "입찰가"가 "입찰가변경"에 걸린다
//      (2) 조사 1글자 절삭 — "광고가" → "광고"
//      (3) IDF 가중 — 거의 모든 문서에 있는 말("네이버", "광고")은 자동으로 가중치가 0에 수렴한다.
//          불용어 목록을 손으로 관리하지 않아도 되고, 문서 집합이 바뀌면 알아서 따라간다.

const JOSA = /[은는이가을를의에도로과와만도]$/;

const terms = query
  .toLowerCase()
  .split(/[\s,./?!"'()[\]{}·]+/)
  .filter((t) => t.length >= 2);

if (!terms.length) {
  console.error('검색어가 너무 짧습니다 (2글자 이상).');
  process.exit(1);
}

const N = pool.length;
const idfCache = new Map();
function idf(form) {
  if (idfCache.has(form)) return idfCache.get(form);
  let df = 0;
  for (const d of pool) {
    if (d.lcTitle.includes(form) || d.lcTags.includes(form) || d.lcCat.includes(form) || d.lcBody.includes(form)) df++;
  }
  // df=0 이면 0. 전 문서에 있으면 0 에 수렴.
  const v = df === 0 ? 0 : Math.log(N / df);
  idfCache.set(form, v);
  return v;
}

const W_TITLE = 6, W_TAG = 4, W_CAT = 2, W_BODY = 1;

function countIn(hay, needle) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

function scoreTerm(d, form) {
  const w = idf(form);
  if (w === 0) return 0;
  let s = 0;
  if (d.lcTitle.includes(form)) s += W_TITLE;
  if (d.lcTags.includes(form)) s += W_TAG;
  if (d.lcCat.includes(form)) s += W_CAT;
  const bc = countIn(d.lcBody, form);
  if (bc) s += W_BODY * Math.min(bc, 3);
  return s * w;
}

const lcQuery = query.toLowerCase();
const scored = [];
for (const d of pool) {
  let score = 0;
  let matched = 0;
  const hits = [];
  for (const t of terms) {
    // 원형과 조사 절삭형 중 점수가 높은 쪽만 센다 (중복 가산 방지)
    let best = scoreTerm(d, t), bestForm = t;
    if (t.length >= 3 && JOSA.test(t)) {
      const trimmed = t.slice(0, -1);
      const s2 = scoreTerm(d, trimmed) * 0.6;
      if (s2 > best) { best = s2; bestForm = trimmed; }
    }
    if (best > 0) { matched++; hits.push(bestForm); }
    score += best;
  }
  if (!score) continue;
  // 질의 전체가 제목에 그대로 있으면 확실한 정답이다
  if (d.lcTitle.includes(lcQuery)) score *= 1.8;
  // 여러 단어가 동시에 걸린 문서를 우대 (한 단어만 폭발적으로 걸린 문서보다 낫다)
  if (terms.length > 1) score *= 1 + 0.35 * (matched - 1);
  // FAQ 조회수는 "실제 광고주가 많이 겪는 문제"라는 약한 신호다. 동점 정리용으로만 쓴다.
  score += Math.log10(d.reads + 10) * 0.15;
  scored.push({ d, score, hits });
}

scored.sort((a, b) => b.score - a.score);
const top = scored.slice(0, opt.limit);

function strip(d) {
  const o = { file: d.file, seq: d.seq, title: d.title, category: d.category, tags: d.tags, updated: d.updated, source: d.source, read_count: d.reads };
  if (updates.overrides.has(d.seq)) o.notice_override = updates.overrides.get(d.seq);
  return o;
}

// 최근 공지 매칭 — 카테고리 필터와 무관하게 전체 문서 기준 IDF 로 잰다.
// FAQ 에 한 번도 안 나오는 말(예: "애즈 어시스턴트")은 공지에만 있는 새 개념이라 가중치를 최대로 준다.
const gCache = new Map();
function globalWeight(form) {
  if (gCache.has(form)) return gCache.get(form);
  let df = 0;
  for (const d of docs) {
    if (d.lcTitle.includes(form) || d.lcTags.includes(form) || d.lcBody.includes(form)) df++;
  }
  const v = Math.log(docs.length / Math.max(df, 1));
  gCache.set(form, v);
  return v;
}
// "파워링크"(≈1)·"순위"처럼 흔한 말 몇 개로는 안 걸리고, FAQ 에 드문 말 하나나 제목 일치면 걸리는 정도
const UPDATE_MIN = 3;
const updateHits = updates.entries
  .map((e) => {
    const lcHead = e.heading.toLowerCase();
    // 제목에 있는 말은 그 공지의 주제라 두 배로 센다
    const w = (f) => (e.lc.includes(f) ? globalWeight(f) * (lcHead.includes(f) ? 2 : 1) : 0);
    let s = 0;
    for (const t of terms) {
      let best = w(t);
      if (t.length >= 3 && JOSA.test(t)) best = Math.max(best, w(t.slice(0, -1)) * 0.6);
      s += best;
    }
    return { e, s };
  })
  .filter((x) => x.s >= UPDATE_MIN)
  .sort((a, b) => b.s - a.s)
  .slice(0, 3);

if (opt.json) {
  console.log(JSON.stringify(top.map((r) => ({ ...strip(r.d), score: Number(r.score.toFixed(2)) })), null, 2));
  process.exit(0);
}

if (updateHits.length) {
  console.log(`최근 공지 (FAQ 스냅샷 이후 · references/UPDATES.md) — FAQ 원문보다 이쪽이 최신이다\n`);
  for (const { e } of updateHits) console.log(`  ▶ ${e.heading}`);
  console.log(`\n  읽기: references/UPDATES.md 의 해당 "## " 항목\n`);
}

if (!top.length) {
  console.log(`"${query}" — 걸리는 문서가 없습니다.

다르게 시도해 보세요:
  · 상품명을 넣는다 — 파워링크 / 쇼핑검색 / 파워컨텐츠 / 브랜드검색 / 플레이스 / 디스플레이광고
  · 더 짧은 낱말로 — "입찰가 어떻게 정하나요" 보다 "입찰가"
  · node scripts/search.mjs --tree 로 카테고리를 훑고 --cat 으로 좁힌다`);
  process.exit(0);
}

// 매치 주변 발췌
function snippet(d, hits) {
  const forms = [...hits].sort((a, b) => idf(b) - idf(a));
  for (const f of forms) {
    const i = d.lcBody.indexOf(f);
    if (i === -1) continue;
    const raw = d.body.replace(/\s+/g, ' ');
    const j = raw.toLowerCase().indexOf(f);
    if (j === -1) continue;
    const from = Math.max(0, j - 55);
    const to = Math.min(raw.length, j + f.length + 75);
    return (from > 0 ? '…' : '') + raw.slice(from, j) + '「' + raw.slice(j, j + f.length) + '」' + raw.slice(j + f.length, to) + (to < raw.length ? '…' : '');
  }
  return '';
}

console.log(`"${query}"${opt.cat ? ` (카테고리: ${opt.cat})` : ''} — ${scored.length}건 중 상위 ${top.length}건\n`);
top.forEach((r, i) => {
  const d = r.d;
  console.log(`${String(i + 1).padStart(2)}. ${d.file}  ${d.title}`);
  console.log(`      ${d.category} · 수정 ${d.updated} · 조회 ${d.reads.toLocaleString()}`);
  if (d.tags.length) console.log(`      태그: ${d.tags.join('·')}`);
  const s = snippet(d, r.hits);
  if (s) console.log(`      ${s}`);
  if (updates.overrides.has(d.seq)) console.log(`      ⚠ 이후 공지로 바뀜: ${updates.overrides.get(d.seq)}`);
  console.log('');
});
console.log(`원문 읽기:  references/faq/<파일명>   또는  node scripts/search.mjs --show <번호>`);
