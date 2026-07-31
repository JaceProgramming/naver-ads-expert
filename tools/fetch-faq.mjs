#!/usr/bin/env node
/**
 * 네이버 광고주센터 도움말(FAQ) 원문 수집기
 *
 * searchadvisor 쪽과 달리 이 사이트는 Next.js App Router 라 HTML 이 껍데기다.
 * (문서 페이지의 <title> 이 전부 "네이버 광고주센터: 도움말 조회" 하나뿐이다.)
 * 대신 뷰가 쓰는 공개 JSON API 가 무인증으로 열려 있어서 그쪽을 직접 읽는다.
 * 관측 결과와 함정은 NOTES.md 에 적어뒀다. 고치기 전에 먼저 읽을 것.
 *
 *   GET /sub/api/v1/faqs?categorySeq=0&pageSize=2000   전체 목록 (재귀. 1회면 끝)
 *   GET /sub/api/v1/faqs/categories/{seq}              카테고리 1단계 자식들
 *   GET /sub/api/v1/faqs/{seq}                         본문 (스마트에디터 HTML)
 *
 * 사용법
 *   node fetch-faq.mjs --list              목록만 (네트워크 1회)
 *   node fetch-faq.mjs --tree              카테고리 트리만
 *   node fetch-faq.mjs                     out/ 에 문서별 .md + INDEX.md
 *   node fetch-faq.mjs --limit 5           앞 5건만 (스모크 테스트용. out/ 을 비우지 않는다)
 *   node fetch-faq.mjs --since 2026-01-01  해당 날짜 이후 수정분만 (증분 재수집)
 *   node fetch-faq.mjs --json              위와 함께 out/_raw/{seq}.json 원본 보존
 *   node fetch-faq.mjs --all               고아 항목(categorySequence=0)까지 시도
 */

import { writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const BASE = 'https://ads.naver.com';
const API = `${BASE}/sub/api/v1/faqs`;
const PAGE = `${BASE}/help/faq`; // 사람이 보는 URL
const OUT = process.env.OUT || path.join(HERE, 'out');
const CONCURRENCY = Number(process.env.CONCURRENCY || 4);
const PAGE_SIZE = Number(process.env.PAGE_SIZE || 2000);
const MAX_DEPTH = Number(process.env.MAX_DEPTH || 4); // 관측된 트리 최대 깊이
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => {
  const i = argv.indexOf(f);
  return i === -1 || i + 1 >= argv.length ? d : argv[i + 1];
};

const LIST_ONLY = has('--list');
const TREE_ONLY = has('--tree');
const SAVE_JSON = has('--json');
const WITH_ORPHANS = has('--all');
const LIMIT = Number(val('--limit', 0));
const SINCE = val('--since', '');
const ONLY = new Set(
  val('--only', '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter(Boolean)
); // 변환 디버깅용: 특정 시퀀스만

if (SINCE && !/^\d{4}-\d{2}-\d{2}$/.test(SINCE)) {
  console.error(`--since 는 YYYY-MM-DD 형식이어야 합니다: "${SINCE}"`);
  process.exit(1);
}

/* ---------------------------------------------------------------- fetching */

async function getJson(url, tries = 3) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'ko' },
      });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        // 404 는 재시도해도 의미가 없다 (고아 항목이 실제로 이렇게 나온다)
        if (res.status === 404) throw Object.assign(err, { fatal: true });
        throw err;
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (err.fatal || i === tries) break;
      await new Promise((r) => setTimeout(r, 400 * i));
    }
  }
  throw Object.assign(new Error(`${url} → ${lastErr.message}`), { status: lastErr.status });
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

/* -------------------------------------------------------- category tree */

/**
 * 트리는 노드마다 자기 "자식 1단계"만 알려준다. 그래서 레벨별로 훑어 내려간다.
 * 깊이 4 가 잎이라 depth 4 노드는 호출하지 않는다 (호출 151회 vs 304회).
 * 잎 카테고리 상당수(관측 시점 303개 중 108개)가 이름이 'category_temp' 인
 * 플레이스홀더라, 경로를 만들 때는 그런 노드를 건너뛴다.
 */
async function fetchCategoryTree() {
  const nodes = new Map(); // seq -> { name, parent, depth }
  let level = [0];
  let depth = 0;
  let requests = 0;

  while (level.length && depth < MAX_DEPTH) {
    depth++;
    const responses = await pool(level, CONCURRENCY, async (seq) => {
      try {
        return await getJson(`${API}/categories/${seq}`);
      } catch {
        return null;
      }
    });
    requests += level.length;

    const next = [];
    for (const res of responses) {
      for (const c of res?.childCategories || []) {
        nodes.set(c.categorySequence, {
          name: c.name,
          parent: c.parentCategorySequence,
          depth: c.depth,
        });
        next.push(c.categorySequence);
      }
    }
    level = next;
  }

  // MAX_DEPTH 에서 멈췄으므로 그 아래가 정말 잎인지는 확인되지 않았다.
  // 표본 몇 개만 찔러 구조가 깊어졌는지 감지한다 (2026-07-30 관측: depth 4 가 잎).
  if (level.length) {
    const sample = level.slice(0, 5);
    const probes = await pool(sample, CONCURRENCY, async (seq) => {
      try {
        return (await getJson(`${API}/categories/${seq}`))?.childCategories?.length || 0;
      } catch {
        return 0;
      }
    });
    requests += sample.length;
    if (probes.some((n) => n > 0)) {
      console.warn(
        `  ! depth ${MAX_DEPTH} 아래에 카테고리가 더 있습니다 (표본 ${sample.length}개 중 ${probes.filter((n) => n > 0).length}개에 자식 존재).` +
          ` MAX_DEPTH=${MAX_DEPTH + 1} 로 다시 받으세요.`
      );
    }
  }
  return { nodes, requests };
}

/** 카테고리 시퀀스 → ["광고 운영", "캠페인", "정의"] */
function categoryPath(nodes, seq) {
  const out = [];
  let cur = seq;
  for (let guard = 0; cur && nodes.has(cur) && guard < 10; guard++) {
    const n = nodes.get(cur);
    if (n.name && n.name !== 'category_temp') out.unshift(n.name);
    cur = n.parent;
  }
  return out;
}

/** 최상위 카테고리의 order 로 정렬해야 사이트 메뉴 순서와 같아진다. */
function rootOf(nodes, seq) {
  let cur = seq;
  for (let guard = 0; cur && nodes.has(cur) && guard < 10; guard++) {
    const n = nodes.get(cur);
    if (n.depth === 1) return cur;
    cur = n.parent;
  }
  return 0;
}

/* ------------------------------------------------------- html → markdown */

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '_',
});
turndown.use(gfm);

/** 표 셀 안의 줄바꿈은 마크다운 표를 깨뜨린다. 셀 안에서만 <br> 를 그대로 남긴다. */
function insideTableCell(node) {
  for (let p = node.parentNode; p; p = p.parentNode) {
    if (p.nodeName === 'TD' || p.nodeName === 'TH') return true;
    if (p.nodeName === 'TABLE') return false;
  }
  return false;
}

turndown.addRule('lineBreak', {
  filter: 'br',
  replacement: (_c, node) => (insideTableCell(node) ? '<br>' : '  \n'),
});

turndown.addRule('seHorizontalLine', {
  filter: 'hr',
  replacement: () => '\n\n---\n\n',
});

const tagOf = (el) => String(el?.tagName || el?.name || '').toLowerCase();

/** 장식용 빈 문단 판별. 스마트에디터가 제로폭 공백(U+200B)만 든 <p> 를 잔뜩 심어둔다. */
function meaningful($, el) {
  const $el = $(el);
  if ($el.find('img').length) return true;
  return ($el.text() || '').replace(/[\s​ ㅤ﻿]+/g, '').length > 0;
}

const BLOCK = new Set(['p', 'div', 'li', 'ul', 'ol', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/**
 * 표 셀 안의 | 는 열 구분자로 먹혀 표를 깨뜨린다. turndown 도 turndown-plugin-gfm 도
 * 이걸 이스케이프해주지 않는다(확인함). 그런데 미리 "\|" 를 넣으면 turndown 이 역슬래시를
 * 다시 이스케이프해서 "\\|" 가 된다. 그래서 사용자 영역 문자로 표시해두고 변환 후 되돌린다.
 */
const PIPE = '\uE000'; // private use area — 본문에 나올 수 없는 문자

/**
 * 셀 안의 | 를 무해하게 만든다.
 *  - 본문 텍스트: 센티넬 → 변환 후 "\|"
 *  - href/src: 퍼센트 인코딩. URL 은 이스케이프해도 링크가 깨지므로 %7C 가 맞다.
 */
function maskPipes(root) {
  const walk = (n) => {
    for (const c of n.children || []) {
      if (c.type === 'text') {
        c.data = (c.data || '').replace(/\|/g, PIPE);
        continue;
      }
      for (const attr of ['href', 'src']) {
        const v = c.attribs?.[attr];
        if (v?.includes('|')) c.attribs[attr] = v.replace(/\|/g, '%7C');
      }
      if (c.children) walk(c);
    }
  };
  walk(root);
}

/**
 * 노드 안을 "인라인 HTML 한 줄"로 평탄화한다. 표 셀 전용.
 *
 * 셀 안은 <div><p>…</p></div> 에 <ul><li><p>…</p></li></ul> 까지 겹쳐 있다.
 * p·li 를 골라 html() 을 이어붙이는 식으로는 안 된다 —
 * li 를 고르면 안쪽 p 가 딸려와 줄바꿈이 새고, 둘 다 고르면 같은 문장이 두 번 들어간다.
 * 그래서 직접 순회하면서 블록 경계는 <br>, 인라인은 태그째 살린다.
 */
function inlineHtml($, node) {
  const parts = [];
  const pushBreak = () => {
    if (!parts.length) return;
    // 이미 줄바꿈이거나, 방금 찍은 불릿 마커 바로 뒤면 넣지 않는다
    if (/(?:<br>|•)\s*$/.test(parts[parts.length - 1])) return;
    parts.push('<br>');
  };

  const walk = (n) => {
    for (const child of n.children || []) {
      if (child.type === 'text') {
        parts.push(child.data || '');
        continue;
      }
      if (child.type === 'comment') continue;
      const tag = tagOf(child);
      if (tag === 'br') {
        parts.push('<br>');
        continue;
      }
      if (BLOCK.has(tag)) {
        pushBreak();
        if (tag === 'li') parts.push('• ');
        walk(child);
        continue;
      }
      parts.push($.html(child)); // b, span, a, img, u, em …
    }
  };
  walk(node);

  return parts
    .join('')
    .replace(/(?:<br>\s*)+/g, '<br>')
    .replace(/^(?:\s|<br>)+|(?:\s|<br>)+$/g, '')
    .trim();
}

/**
 * 스마트에디터 본문을 마크다운으로.
 *
 * 손봐야 하는 지점 넷:
 *  1. <script class="__se_module_data"> — 컴포넌트별 JSON 이 본문 사이에 박혀 있다. 지운다.
 *  2. 제로폭 공백만 든 빈 <p> 가 문단 사이·문서 끝에 널려 있다. 지운다.
 *  3. 표에 thead/th 가 없다 — 첫 행을 <th> 로 올려 <thead> 로 감싸야 GFM 표로 변환된다.
 *  4. 셀 안 중첩 블록은 inlineHtml() 로 한 줄로 만든다.
 */
function extractBody(contentHtml) {
  if (!contentHtml || !contentHtml.trim()) return null;

  const $ = cheerio.load(contentHtml);
  const body = $('.se-main-container').first().length
    ? $('.se-main-container').first()
    : $('.se-viewer').first();
  if (!body.length) return null;

  body.find('script, style').remove();

  // (2) 내용이 없는 장식용 문단 제거. <br> 만 든 문단은 의도된 빈 줄이라 남긴다.
  body.find('p').each((_, el) => {
    const $el = $(el);
    if ($el.find('img, br').length) return;
    if (!meaningful($, el)) $el.remove();
  });

  // 상대 경로 이미지·링크를 절대 URL 로 (원문 대조 가능하도록)
  body.find('img[src]').each((_, el) => {
    const src = $(el).attr('src') || '';
    if (src.startsWith('//')) $(el).attr('src', `https:${src}`);
    else if (src.startsWith('/')) $(el).attr('src', BASE + src);
  });
  body.find('a[href]').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href') || '';
    // 스마트에디터는 이미지를 라이트박스용 <a href="#"> 로 감싼다 → [![](url)](#) 가 되므로 벗긴다
    if (href.startsWith('#') && $a.find('img').length) {
      $a.replaceWith($a.html() || '');
      return;
    }
    if (href.startsWith('/')) $a.attr('href', BASE + href);
  });

  body.find('table').each((_, table) => {
    const $t = $(table);
    const rows = $t.find('tr').toArray();
    if (!rows.length) return;

    // (2) 첫 행 td → th 승격 후 thead 로 이동.
    //     first-row 휴리스틱에 맡기면 셀 사이 공백 텍스트 노드 때문에 판정이 실패한다.
    if (!$t.find('thead').length) {
      const $first = $(rows[0]);
      for (const td of $first.children('td').toArray()) {
        const $td = $(td);
        $td.replaceWith(`<th>${$td.html() ?? ''}</th>`);
      }
      $t.prepend($('<thead></thead>').append($first));
    }

    // (4) 셀 안을 인라인 한 줄로 평탄화하고, 셀 안 | 는 센티넬로 감춰둔다
    for (const cell of $t.find('th, td').toArray()) {
      $(cell).html(inlineHtml($, cell));
      maskPipes(cell);
    }
  });

  // 제로폭 공백은 스마트에디터 잔재다. 남겨두면 grep 이 조용히 빗나간다.
  // (줄 끝 공백은 건드리지 않는다 — turndown 이 <br> 를 "␣␣\n" 하드 개행으로 쓴다)
  const md = turndown
    .turndown(body.html() || '')
    .replace(/\u200b/g, '')
    .replace(new RegExp(PIPE, 'g'), '\\|')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return md || null;
}

/* ------------------------------------------------------------ front matter */

const ymd = (s) => (typeof s === 'string' && s.length >= 10 ? s.slice(0, 10) : '');
const yamlStr = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const yamlList = (arr) => `[${arr.map((v) => (typeof v === 'number' ? v : yamlStr(v))).join(', ')}]`;

function frontMatter(doc, detail) {
  const lines = [
    '---',
    `title: ${yamlStr(doc.title)}`,
    `category: ${yamlStr(doc.categoryPath.join(' > ') || '(미분류)')}`,
    `faq_seq: ${doc.seq}`,
    `source: ${yamlStr(`${PAGE}/${doc.seq}`)}`,
  ];
  if (doc.tags?.length) lines.push(`tags: ${yamlList(doc.tags)}`);
  if (doc.updated) lines.push(`updated: ${yamlStr(doc.updated)}`);
  if (doc.created) lines.push(`created: ${yamlStr(doc.created)}`);
  if (typeof doc.readCount === 'number') lines.push(`read_count: ${doc.readCount}`);
  const related = (detail.relatedFAQs || []).map((r) => r.faqSequence).filter(Boolean);
  if (related.length) lines.push(`related: ${yamlList(related)}`);
  lines.push('---', '');
  return lines.join('\n');
}

const fileNameOf = (seq) => `faq-${String(seq).padStart(4, '0')}.md`;

/* ------------------------------------------------------------------- main */

console.log('목록 조회…');
const listRes = await getJson(`${API}?categorySeq=0&pageSize=${PAGE_SIZE}`);
const raw = listRes.results || [];

if (raw.length < listRes.totalCount) {
  console.warn(
    `  ! 목록이 잘렸습니다: ${raw.length}/${listRes.totalCount}. PAGE_SIZE 를 올리거나 page 파라미터로 나눠 받으세요.`
  );
}

// categorySequence 0 = 카테고리에 붙지 않은 고아 항목. 상세가 404 로 떨어진다.
const orphans = raw.filter((x) => x.categorySequence === 0);
let entries = WITH_ORPHANS ? raw : raw.filter((x) => x.categorySequence !== 0);

console.log(
  `전체 ${listRes.totalCount}건 / 수집 대상 ${entries.length}건` +
    (orphans.length ? ` / 고아 항목 ${orphans.length}건 ${WITH_ORPHANS ? '포함' : '제외'}` : '')
);

if (SINCE) {
  const before = entries.length;
  entries = entries.filter((x) => ymd(x.modYmdt) && ymd(x.modYmdt) >= SINCE);
  console.log(`  --since ${SINCE} → ${entries.length}건 (${before - entries.length}건 제외)`);
}

console.log('카테고리 트리 조회…');
const { nodes: cats, requests: catRequests } = await fetchCategoryTree();
console.log(`  카테고리 ${cats.size}개 (요청 ${catRequests}회)`);

if (TREE_ONLY) {
  const roots = [...cats.entries()].filter(([, n]) => n.depth === 1);
  for (const [seq] of roots) {
    const walk = (parent, indent) => {
      for (const [s, n] of cats) {
        if (n.parent !== parent) continue;
        const count = entries.filter((e) => e.categorySequence === s).length;
        console.log(`${indent}${n.name}  (${s}${count ? `, 직속 ${count}건` : ''})`);
        walk(s, indent + '  ');
      }
    };
    console.log(`\n${cats.get(seq).name}  (${seq})`);
    walk(seq, '  ');
  }
  process.exit(0);
}

const docs = entries.map((e) => ({
  seq: e.faqSequence,
  title: e.title || `FAQ ${e.faqSequence}`,
  categorySeq: e.categorySequence,
  categoryPath: categoryPath(cats, e.categorySequence),
  root: rootOf(cats, e.categorySequence),
  tags: e.tags || [],
  updated: ymd(e.modYmdt),
  created: ymd(e.regYmdt),
  readCount: e.readCount,
}));

// 사이트 메뉴 순서(최상위 노드가 응답에 실려온 순서) → 카테고리 경로 → 시퀀스
const rootOrder = new Map(
  [...cats.entries()]
    .filter(([, n]) => n.depth === 1)
    .map(([seq], i) => [seq, i])
);
docs.sort((a, b) => {
  const ra = rootOrder.get(a.root) ?? 999;
  const rb = rootOrder.get(b.root) ?? 999;
  if (ra !== rb) return ra - rb;
  const pa = a.categoryPath.join(' > ');
  const pb = b.categoryPath.join(' > ');
  if (pa !== pb) return pa < pb ? -1 : 1;
  return a.seq - b.seq;
});

if (LIST_ONLY) {
  let cur = '';
  for (const d of docs) {
    const p = d.categoryPath.join(' > ') || '(미분류)';
    if (p !== cur) {
      cur = p;
      console.log(`\n## ${p}`);
    }
    console.log(`  ${String(d.seq).padStart(4)}  ${d.title}  (수정 ${d.updated || '?'})`);
  }
  console.log(`\n합계 ${docs.length}건`);
  process.exit(0);
}

let targets = ONLY.size ? docs.filter((d) => ONLY.has(d.seq)) : docs;
if (LIMIT > 0) targets = targets.slice(0, LIMIT);
const partial = LIMIT > 0 || Boolean(SINCE) || ONLY.size > 0;

if (ONLY.size && targets.length < ONLY.size) {
  const missing = [...ONLY].filter((s) => !targets.some((d) => d.seq === s));
  console.warn(`  ! --only 에 지정한 ${missing.join(', ')} 는 수집 대상 목록에 없습니다 (고아 항목이거나 삭제됨)`);
}

// 전량 수집일 때만 비운다. 부분 수집이 기존 결과를 날리면 안 된다.
if (!partial) await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
if (SAVE_JSON) await mkdir(path.join(OUT, '_raw'), { recursive: true });

console.log(
  `\n본문 수집 ${targets.length}건 (동시 ${CONCURRENCY})` +
    (partial ? ' — 부분 수집이라 기존 out/ 을 유지합니다' : '')
);

const failed = [];
let done = 0;

await pool(targets, CONCURRENCY, async (doc) => {
  try {
    const detail = await getJson(`${API}/${doc.seq}`);
    if (SAVE_JSON) {
      await writeFile(path.join(OUT, '_raw', `${doc.seq}.json`), JSON.stringify(detail, null, 2));
    }

    const md = extractBody(detail.content);
    if (!md) throw new Error('본문이 비어 있음 (se-main-container 없음/공백)');

    // 상세 쪽 제목·태그가 목록보다 최신인 경우가 있어 있으면 덮어쓴다
    if (detail.title) doc.title = detail.title;
    if (detail.tags?.length) doc.tags = detail.tags;
    if (detail.modYmdt) doc.updated = ymd(detail.modYmdt);

    const file = fileNameOf(doc.seq);
    await writeFile(
      path.join(OUT, file),
      `${frontMatter(doc, detail)}# ${doc.title}\n\n${md}\n`
    );
    doc.file = file;
    doc.chars = md.length;
    done++;
    console.log(`  ✓ ${file}  ${String(md.length).padStart(6)}자  ${doc.title.slice(0, 44)}`);
  } catch (err) {
    failed.push({ ...doc, error: err.message });
    console.log(`  ✗ ${doc.seq}  ${err.message}`);
  }
});

/* ----------------------------------------------------------------- index */

await writeFile(
  path.join(OUT, '_categories.json'),
  JSON.stringify(
    Object.fromEntries(
      [...cats.entries()].map(([seq, n]) => [
        seq,
        { name: n.name, depth: n.depth, parent: n.parent, path: categoryPath(cats, seq) },
      ])
    ),
    null,
    2
  )
);

// 부분 수집이면 INDEX 를 덮어쓰지 않는다 (전체 목록을 담을 수 없으므로)
if (!partial) {
  const lines = [
    '# 네이버 광고주센터 도움말 (FAQ)',
    '',
    `출처: ${PAGE}`,
    `수집: ${targets.length - failed.length} / ${targets.length}건` +
      (orphans.length ? ` (고아 항목 ${orphans.length}건 제외)` : ''),
    '',
  ];
  let cur = '';
  for (const d of docs) {
    if (!d.file) continue;
    const p = d.categoryPath.join(' > ') || '(미분류)';
    if (p !== cur) {
      cur = p;
      lines.push('', `## ${p}`, '');
    }
    const meta = [d.updated && `수정 ${d.updated}`, d.tags.length && d.tags.join('·')]
      .filter(Boolean)
      .join(', ');
    lines.push(`- [${d.title}](${d.file})${meta ? ` — ${meta}` : ''}`);
  }
  if (failed.length) {
    lines.push('', '## 수집 실패', '');
    for (const f of failed) lines.push(`- ${f.seq} ${f.title}: ${f.error}`);
  }
  if (orphans.length) {
    lines.push(
      '',
      '## 카테고리 미배정(고아) 항목',
      '',
      '목록 API 에는 있지만 상세가 404 로 떨어진다. `--all` 로 강제 시도할 수 있다.',
      ''
    );
    for (const o of orphans) lines.push(`- ${o.faqSequence} ${o.title}`);
  }
  await writeFile(path.join(OUT, 'INDEX.md'), lines.join('\n') + '\n');
}

const total = docs.reduce((s, d) => s + (d.chars || 0), 0);
console.log(
  `\n완료: ${done}/${targets.length}건, 총 ${total.toLocaleString()}자 → ${path.relative(process.cwd(), OUT) || OUT}/`
);
if (failed.length) {
  console.log(`실패 ${failed.length}건: ${failed.slice(0, 10).map((f) => f.seq).join(', ')}${failed.length > 10 ? ' …' : ''}`);
  process.exitCode = 1;
}
