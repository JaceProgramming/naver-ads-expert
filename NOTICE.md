# 저작권 및 출처 고지 (NOTICE)

## 원문 자료

`references/faq/` 아래 1148개 Markdown 문서는 **네이버 광고주센터 도움말**
(<https://ads.naver.com/help/faq>)의 공개 문서를 Markdown 으로 변환한 것입니다.

- **저작권자: 네이버 주식회사 (NAVER Corp.)**
- 본 저장소는 네이버(주)와 아무런 관련이 없으며, 공식 제공물이나 승인을 받은 배포물이 아닙니다.
- 문서 본문에는 어떠한 수정·요약·재해석도 가하지 않았습니다. HTML → Markdown 형식 변환만 수행했습니다.
- 각 파일은 front matter 에 원문 URL(`source`)과 네이버가 명시한 수정일(`updated`)을 보존합니다.
- 본문의 이미지는 **내려받지 않고 네이버 서버의 원본 URL(`ads-home-phinf.pstatic.net`)을 그대로 참조**합니다.
  이미지 파일 자체는 이 저장소에 포함되어 있지 않습니다.
- 문서 중 367건은 제목에 `[AI작성]` 이 붙어 있습니다. 네이버 쪽에서 AI 로 작성해 게시한 도움말이며,
  이 표기 역시 네이버 원문 그대로입니다.
- 수집 시점: 2026년 7월 31일. 이후 원문이 변경되었을 수 있으므로,
  **정확한 최신 내용은 항상 `source` 의 원문을 확인하십시오.**

재배포 목적은 AI 에이전트가 오프라인에서 정확한 근거 자료를 참조하도록 하는 것입니다.
네이버 광고는 상품마다 규칙이 다르고 광고주센터가 개편되어, AI 가 기억으로 답하면 사용자가 실제로
보고 있는 화면과 어긋납니다. 요약본을 쓰면 그 과정에서 금액·기간·정책이 왜곡되므로 원문을 그대로 두었습니다.

**네이버(주)의 요청이 있을 경우 `references/faq/` 전체를 즉시 삭제하고,
사용자가 `tools/fetch-faq.mjs` 로 직접 내려받는 방식으로 전환합니다.**
이슈 또는 저장소 소유자에게 연락 주시기 바랍니다.

## 이 저장소가 직접 작성한 부분

다음은 이 프로젝트의 창작물이며 MIT 라이선스를 따릅니다 ([LICENSE](LICENSE)).

- `SKILL.md` — 스킬 지침, 상품 지도, 워크플로
- `scripts/search.mjs` — 1148건 랭킹 검색 스크립트
- `tools/fetch-faq.mjs` — 수집 스크립트
- `tools/build-index.mjs` — 색인·카테고리 지도 생성
- `README.md`, `NOTICE.md`, `references/CATEGORIES.md`, `references/INDEX.md`
- `references/UPDATES.md` — 네이버 광고 공지사항(<https://ads.naver.com/notice>)의 변경 내용을 이 프로젝트가
  요약·정리한 것. 원문 전재가 아니며, 각 항목에 공지 URL과 확인한 2차 출처를 밝힌다.

## 상표

NAVER, 네이버, 네이버광고주센터, 파워링크, 파워컨텐츠, 쇼핑검색광고, 브랜드검색, ADVoost 는
네이버 주식회사의 상표입니다. 이 저장소에서는 식별 목적으로만 사용합니다.

---

# Copyright Notice (English)

The 1,148 Markdown documents under `references/faq/` are Markdown conversions of the publicly
available **NAVER Advertiser Center Help** (<https://ads.naver.com/help/faq>).

- **Copyright: NAVER Corporation**
- This repository is **not** affiliated with, endorsed by, or approved by NAVER Corporation.
- Document bodies are unmodified — only HTML-to-Markdown format conversion was applied.
- Images are **not** redistributed; documents reference NAVER's original image URLs.
- Each file preserves the original URL (`source`) and NAVER's stated revision date (`updated`)
  in its front matter. Snapshot taken 31 July 2026 — always verify against the `source` URL.
- 367 documents carry an `[AI작성]` ("AI-written") prefix in their titles. That label is NAVER's
  own, applied to help articles NAVER generated with AI.

Redistribution serves to give AI agents offline access to accurate primary sources. Naver's ad
products follow different rules per product and the advertiser center was recently redesigned, so
an agent answering from memory contradicts what the user actually sees on screen.

**If NAVER Corporation requests removal, `references/faq/` will be deleted immediately** and
replaced with a fetch-it-yourself flow via `tools/fetch-faq.mjs`.

Original work in this repository (`SKILL.md`, `scripts/`, `tools/`, docs) is MIT licensed.
NAVER, Powerlink, Shopping Search Ad, Brand Search, and ADVoost are trademarks of NAVER
Corporation, used here for identification purposes only.
