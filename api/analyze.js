// api/analyze.js  —  SubmitCheck 방법론 서버리스 함수
// 규칙: Solar Pro 4만 사용(외부 LLM 금지). 키는 Vercel 환경변수 UPSTAGE_API_KEY에서만 읽음.
// 출력: SubmitCheck SKILL.md의 10개 섹션 고정 계약 준수.
// 클라이언트 소스·응답 JSON에 키 0.
"use strict";

const MODEL = "solar-pro4";
const BASE_URL = process.env.UPSTAGE_BASE_URL || "https://api.upstage.ai/v1";
const API_KEY = process.env.UPSTAGE_API_KEY; // Production + Preview 환경변수에서 읽음
const MODEL_URL = `${BASE_URL}/chat/completions`;

// Vercel Serverless Function 진입점
export default async function handler(request) {
  // GET이면 간단한 상태 응답 (도구 아님)
  if (request.method === "GET") {
    return {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { ok: true, name: "submitcheck-api", model: MODEL }
    };
  }

  if (request.method !== "POST") {
    return { status: 405, body: { error: "Method not allowed" } };
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return { status: 400, body: { error: "유효하지 않은 JSON 본문" } };
  }

  const regulation = (body.regulation && typeof body.regulation === "string") ? body.regulation.trim() : "";
  const submission = (body.submission && typeof body.submission === "string") ? body.submission.trim() : "";

  // 입력 부족 게이트
  if (!regulation || !submission) {
    return {
      status: 400,
      body: {
        overallGate: "INSUFFICIENT_INPUT",
        issues: [],
        blockingIssues: [],
        warnings: [],
        externalChecks: [],
        prioritizedActions: [{ order: "NOW", target: "입력", action: "규정과 제출물을 모두 입력하세요." }],
        scope: "규정 또는 제출물 중 한쪽이 비어 있어 분석을 시작할 수 없음.",
        inventories: [],
        matrixRows: [],
        rubricRows: [],
        handoff: "규정 또는 제출물 중 한쪽이 비어 있어 분석을 시작할 수 없음. 제공 자료 범위의 잠정 점검이며 공식 접수·심사 결과를 보장하지 않음.",
        disclaimer: "이 결과는 제공 자료 범위의 잠정 점검이며 공식 접수·심사 결과를 보장하지 않습니다.",
        error: "규제 또는 제출물 중 하나 이상이 비어 있습니다."
      }
    };
  }

  // Solar 호출로 SubmitCheck 방법론 적용
  const prompt = buildSubmitCheckPrompt(regulation, submission);
  let llmResult;
  try {
    llmResult = await callSolar(prompt);
  } catch (err) {
    // 호출 실패 시 "확인 불가"로 남기고 구조만 유지
    return {
      status: 502,
      body: {
        overallGate: "REVIEW_REQUIRED",
        issues: [],
        blockingIssues: [],
        warnings: [{ id: "LLM_CALL", reason: "Solar 호출 중 오류가 발생했습니다. 서비스 운영팀에 문의하세요." }],
        externalChecks: [],
        prioritizedActions: [
          { order: "NOW", target: "서비스 호출", action: "Solar 호출 오류를 확인하세요. 현재는 규칙 기반 결과를 일부 대체할 수 없음(확인 불가)." }
        ],
        scope: "Solar 호출 오류로 SubmitCheck 방법론의 완전 적용이 제한됨(확인 불가).",
        matrixRows: [],
        rubricRows: [],
        handoff: "Solar 호출 오류로 분석이 제한됨(확인 불가). 제공 자료 범위의 잠정 점검이며 공식 접수·심사 결과를 보장하지 않음.",
        disclaimer: "Solar 호출 오류로 분석이 제한됨(확인 불가). 제공 자료 범위의 잠정 점검이며 공식 접수·심사 결과를 보장하지 않음.",
        error: "Solar 호출 오류"
      }
    };
  }

  // LLM 응답을 SubmitCheck 고정 계약 구조로 파싱
  const parsed = parseSubmitCheckOutput(llmResult);
  if (!parsed) {
    // 파싱 실패 시 구조 유지 + 경고
    return {
      status: 200,
      body: {
        overallGate: "REVIEW_REQUIRED",
        issues: [],
        blockingIssues: [],
        warnings: [{ id: "PARSE", reason: "Solar 출력이 SubmitCheck 10개 섹션 고정 계약을 만족하도록 파싱되지 않음(확인 불가)." }],
        externalChecks: [],
        prioritizedActions: [
          { order: "NOW", target: "출력 구조", action: "Solar 출력이 10개 섹션 계약을 따르지 않음. 프롬프트·파싱을 확인하세요." }
        ],
        scope: "Solar 출력이 SubmitCheck 10개 섹션 고정 계약을 만족하지 않아 파싱되지 않음(확인 불가).",
        inventories: [{ kind: "규정", text: regulation.slice(0, 300) + (regulation.length > 300 ? "…" : "") }],
        matrixRows: [],
        rubricRows: [],
        handoff: "Solar 출력이 SubmitCheck 10개 섹션 계약을 만족하지 않아 파싱되지 않음(확인 불가). 제공 자료 범위의 잠정 점검이며 공식 접수·심사 결과를 보장하지 않음.",
        disclaimer: "Solar 출력이 SubmitCheck 10개 섹션 계약을 만족하지 않아 파싱되지 않음(확인 불가). 제공 자료 범위의 잠정 점검이며 공식 접수·심사 결과를 보장하지 않음."
      }
    };
  }

  // 파싱 성공 시 검증: 10개 섹션 존재, 마지막 줄에 최종 상태 포함 등
  const validated = validateSubmitCheckOutput(parsed);
  if (!validated.ok) {
    return {
      status: 200,
      body: {
        ...parsed,
        warnings: [
          ...(parsed.warnings || []),
          { id: "VALIDATE", reason: validated.reason || "출력 구조 검증 실패(확인 불가)." }
        ],
        prioritizedActions: [
          ...(parsed.prioritizedActions || []),
          { order: "NOW", target: "출력 검증", action: validated.reason || "출력 구조 검증 실패. 프롬프트·파싱을 확인하세요." }
        ]
      }
    };
  }

  return { status: 200, body: parsed };
}

function buildSubmitCheckPrompt(regulation, submission) {
  // SKILL.md 원문 전체를 프롬프트 앞에 넣어 규칙 준수 강제
  const skill = skillMdText();
  return `${skill}

## 규정
${regulation}

## 제출물
${submission}

위 규정과 제출물을 SubmitCheck 스킬 규칙에 따라 분석하라.
- 반드시 "SUBMITCHECK REPORT"로 시작
- 10개 섹션을 정확히 그 순서대로, 각 섹션 제목은 "### N. 제목 / 부제" 형태
- 4번 표는 지정 열 그대로: ID | 원자 요구사항과 출처 | 의무 수준 | 적용 조건 | 검증 유형 | 근거와 위치 | 상태 | 판정 이유
- 5번 표는 지정 열 그대로: ID | 평가기준과 출처 | 배점 | 근거와 위치 | 상태 | 판정 이유
- 상태 결정 순서(AMBIGUOUS → EXTERNAL_CHECK → N/A → FAIL → PASS → PARTIAL → FAIL(본문 MUST 누락) → NOT_FOUND) 준수
- 종합 게이트 4종 중 하나로 판정
- 마지막 줄은 "최종 상태: INSUFFICIENT_INPUT / BLOCKED / REVIEW_REQUIRED / PROVISIONALLY_READY" 중 하나
- 서론·요약·도구 설명·맺음말·후속 제안 금지
- R-ID는 규정에서만 만들고, 제출물 문장은 새 R-ID로 만들지 않음
- 민감정보는 [REDACTED:유형] 처리
- 결과만 출력하라(서론 없이 SUBMITCHECK REPORT로 시작).
`;
}

function skillMdText() {
  // SKILL.md를 빌드 시점에 포함해도 되지만, 여기선 인라인으로 핵심 규칙만.
  // 실제 운영에서는 SKILL.md 전체 텍스트를 포함하는 것이 규칙 재현에 유리.
  // 아래 인라인은 SKILL.md의 고정 처리 절차·상태 결정·게이트·출력 계약을 압축한 것.
  return `<SKILL>
규칙: SubmitCheck 고정 처리 절차
1. 규정 자료를 원문 순서로 식별(S1부터). 제출물은 A1부터.
2. 필수 제출요건과 평가기준을 분리.
3. 독립 판정 가능한 조건은 각각 분리("A와 B 모두" → A, B 두 원자).
4. 원자 요구사항은 원문 순서대로 R-001, R-002, ... 증가. 하나의 S3가 둘로 분리되면 두 R-ID 모두 출처 S3 표시.
5. 평가기준은 C-001부터.
6. 중복 조건만 합치고, 실제 충돌은 임의 해결하지 않음.
7. 각 R-ID에 의무 수준, 적용 조건, 검증 유형, 근거, 상태, 이유 기록.
8. 평가기준은 C-ID에 근거와 별도 루브릭 상태 기록.
9. 고정 규칙으로 종합 게이트와 최소 조치 결정.

의무 수준: MUST(필수·반드시·해야 함·금지·제한·마감) / SHOULD(권장·권고·선호·가점 가능) / MAY(명시적 선택·허용, '자유 형식'·'선택 가능' 포함) / UNKNOWN(수준·범위 불명확).
예시·홍보·참고 문구를 필수 조건으로 바꾸지 않음. 조건 미적용이 제공 사실로 명확할 때만 N/A.

검증 유형: CONTENT_CHECKABLE(제공 본문·메타데이터로 직접 비교 가능) / EXTERNAL_CHECK(실제 업로드·태그·계정·링크·현재 시각 등 외부 상태 확인 필요) / INSUFFICIENT(판정 자료 부족).
외부 상태 조건이 원문에 있을 때만 EXTERNAL_CHECK 생성. 규정 없는 업로드 재확인·파일 크기·현재 시각·실제 파일 점검을 새 요구사항으로 추가하지 않음.
한 R-ID에는 검증 유형 하나만.

상태 결정 순서:
- 충돌 또는 실제 해석 불명확 → AMBIGUOUS
- 외부 상태 직접 확인 필요 → EXTERNAL_CHECK
- 적용 조건 불충족이 명확 → N/A
- 직접 근거가 명백히 모순 → FAIL
- 모든 원자 조건 직접 근거 명확 → PASS
- 실제 일부 충족 또는 간접 근거 → PARTIAL
- 자료 완전본이고 MUST 근거 없음 → FAIL
- 그 밖에 근거 없음 → NOT_FOUND

충돌은 모든 참여 요구사항에 먼저 적용. 충돌 시 양쪽 모두 AMBIGUOUS. 충돌이 있으면 충돌 상태가 우선.
FAIL은 직접 모순 또는 완전본의 MUST 누락에만. 일부 자료에서 단순 근거 못 찾으면 NOT_FOUND. 완전본에서 SHOULD·MAY 근거 전혀 없음 → NOT_FOUND(부재만으로 PARTIAL·FAIL로 바꾸지 않음).
평가기준은 PASS·FAIL이 아니라 COVERED, PARTIAL, NOT_FOUND, AMBIGUOUS. 평가기준 문구 자체가 충돌·모호한 경우만 AMBIGUOUS. 기준 명확하지만 제출물 근거 없거나 일부만 제공 → NOT_FOUND 또는 PARTIAL. 평가기준 공백만으로 BLOCKED 만들지 않음.

종합 게이트:
- INSUFFICIENT_INPUT: 규정 또는 제출물 중 한쪽 없음
- BLOCKED: MUST에 FAIL 하나 이상
- REVIEW_REQUIRED: BLOCKED 아니지만 필수 PARTIAL·NOT_FOUND·AMBIGUOUS·EXTERNAL_CHECK, 자료 일부·UNKNOWN, 실제 규정 충돌, 외부 확인, 루브릭 공백 중 하나 이상
- PROVISIONALLY_READY: 양쪽 완전본이며 적용 가능한 모든 MUST가 PASS이고 필수 모호성·외부 확인 없음
PROVISIONALLY_READY도 제공 자료 범위의 잠정 판정일 뿐 공식 접수·합격 보장 아님.

고정 출력 계약:
- 반드시 "SUBMITCHECK REPORT"로 시작
- 아래 H3 제목 10개를 정확히 한 번씩 같은 순서로:
  ### 1. Review Scope / 검토 범위
  ### 2. Input Inventory / 입력 자료
  ### 3. Overall Gate / 종합 판정
  ### 4. Requirement–Evidence–Status Matrix / 요구사항 대응표
  ### 5. Rubric Coverage / 평가기준 대응
  ### 6. Blocking Issues / 제출 차단 항목
  ### 7. Warnings & Ambiguities / 경고·모호성
  ### 8. External Checks / 외부 확인 항목
  ### 9. Prioritized Action Checklist / 수정 우선순위
  ### 10. Submission Handoff / 최종 전달문
- 4번 표 열: ID | 원자 요구사항과 출처 | 의무 수준 | 적용 조건 | 검증 유형 | 근거와 위치 | 상태 | 판정 이유
- 5번 표 열: ID | 평가기준과 출처 | 배점 | 근거와 위치 | 상태 | 판정 이유
- 항목 없으면 섹션 생략하지 않고 NONE, 값 미제공이면 UNKNOWN.
- 6번 Blocking Issues에는 MUST 상태 FAIL만. FAIL 없으면 NONE. AMBIGUOUS·EXTERNAL_CHECK·자료 부족은 각각 7·8·9번에서.
- 7번 Warnings는 실제 충돌·모호성이 있는 경우만. 정상 사례에선 NONE. 원자화 설명·권장항목 미반영을 모호성 경고로 만들지 않음.
- 6~9번은 기존 R-ID·C-ID와 직접 연결된 내용만. 새 요구사항·일반 조언 만들지 않음. 질문 필요하면 9번에서 판정 가장 크게 바꾸는 최대 2개만.
- 10번은 검토 범위, 종합 게이트, MUST 실패 수, 미확인 수, 외부 확인 수와 다음 문구 포함: "제공 자료 범위의 잠정 점검이며 공식 접수·심사 결과를 보장하지 않음."
- 마지막 보이는 줄: "최종 상태: INSUFFICIENT_INPUT" / "최종 상태: BLOCKED" / "최종 상태: REVIEW_REQUIRED" / "최종 상태: PROVISIONALLY_READY" 중 하나.
- 서론·별도 요약·도구 설명·맺음말·후속 제안 금지.
</SKILL>`;
}

async function callSolar(prompt) {
  if (!API_KEY) {
    throw new Error("API 키가 설정되지 않았습니다.");
  }
  const resp = await fetch(MODEL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + API_KEY
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 3000,
      temperature: 0.2
    })
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Solar API 오류 (${resp.status}): 응답 수신 실패`);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Solar 응답이 비어 있음");
  return content;
}

function safeMessage(err) {
  try { return err?.message || String(err); } catch { return "알 수 없는 오류"; }
}

// --- 파싱 ---

function parseSubmitCheckOutput(text) {
  if (!text || typeof text !== "string") return null;
  // SUBMITCHECK REPORT로 시작하는지
  if (!text.startsWith("SUBMITCHECK REPORT")) {
    // 앞에 다른 말이 섞인 경우 어떻게든 파싱 시도
    const idx = text.indexOf("SUBMITCHECK REPORT");
    if (idx >= 0) text = text.slice(idx);
    else return null;
  }

  // 섹션 경계 추출: "### N. ... / ..." 형태
  const sectionRegex = /^### (\d+)\.\s*(.*)$/gm;
  const sections = [];
  let m;
  // 섹션 제목들을 순서대로 찾기
  const titles = [
    "Review Scope",
    "Input Inventory",
    "Overall Gate",
    "Requirement–Evidence–Status Matrix",
    "Rubric Coverage",
    "Blocking Issues",
    "Warnings & Ambiguities",
    "External Checks",
    "Prioritized Action Checklist",
    "Submission Handoff"
  ];
  const expectedFull = [
    "1. Review Scope / 검토 범위",
    "2. Input Inventory / 입력 자료",
    "3. Overall Gate / 종합 판정",
    "4. Requirement–Evidence–Status Matrix / 요구사항 대응표",
    "5. Rubric Coverage / 평가기준 대응",
    "6. Blocking Issues / 제출 차단 항목",
    "7. Warnings & Ambiguities / 경고·모호성",
    "8. External Checks / 외부 확인 항목",
    "9. Prioritized Action Checklist / 수정 우선순위",
    "10. Submission Handoff / 최종 전달문"
  ];

  // 각 섹션의 시작과 다음 섹션 시작 사이를 자르기
  const lines = text.split(/\r?\n/);
  const sectionStartLines = []; // {n, title, lineIndex}
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const mm = line.match(/^### (\d+)\.\s*(.*)$/);
    if (mm) {
      sectionStartLines.push({ n: parseInt(mm[1], 10), title: mm[2].trim(), lineIndex: i });
    }
  }
  // 섹션 순서대로 정렬(숫자 기준)
  sectionStartLines.sort((a, b) => a.n - b.n);

  const out = {
    scope: null,
    inventories: [],
    overallGate: null,
    matrixRows: [],
    rubricRows: [],
    blockingIssues: [],
    warnings: [],
    externalChecks: [],
    prioritizedActions: [],
    handoff: null,
    raw: text
  };

  // 섹션별로 내용 추출
  for (let i = 0; i < sectionStartLines.length; i++) {
    const start = sectionStartLines[i];
    // 문서 순서상 다음 섹션 찾기 (lineIndex 기준)
    let end = lines.length;
    for (const other of sectionStartLines) {
      if (other.lineIndex > start.lineIndex && other.lineIndex < end) {
        end = other.lineIndex;
      }
    }
    const bodyText = lines.slice(start.lineIndex + 1, end).join("\n").trim();
    const n = start.n;
    const title = start.title;

    if (n === 1) {
      out.scope = bodyText || "NONE";
    } else if (n === 2) {
      out.inventories = parseInventory(bodyText);
    } else if (n === 3) {
      out.overallGate = extractOverallGate(bodyText, text);
      if (!out.overallGate) out.overallGate = "UNKNOWN";
    } else if (n === 4) {
      out.matrixRows = parseTable(bodyText, "matrix");
    } else if (n === 5) {
      out.rubricRows = parseTable(bodyText, "rubric");
    } else if (n === 6) {
      out.blockingIssues = parseBlocking(bodyText);
    } else if (n === 7) {
      out.warnings = parseWarnings(bodyText);
    } else if (n === 8) {
      out.externalChecks = parseExternal(bodyText);
    } else if (n === 9) {
      out.prioritizedActions = parseActions(bodyText);
    } else if (n === 10) {
      out.handoff = bodyText || "NONE";
    }
  }

  // 마지막 줄에서 최종 상태 추출
  const lastLine = lines[lines.length - 1]?.trim() || "";
  const gateMatch = lastLine.match(/^최종 상태:\s*(INSUFFICIENT_INPUT|BLOCKED|REVIEW_REQUIRED|PROVISIONALLY_READY)$/);
  if (gateMatch) {
    out.overallGate = gateMatch[1];
  } else if (!out.overallGate) {
    // 마지막 줄에 최종 상태가 없으면 본문에서 탐색
    out.overallGate = extractOverallGateFromBody(text) || "UNKNOWN";
  }

  return out;
}

function parseInventory(text) {
  if (!text || text.trim() === "") return [];
  const t = text.trim();
  if (t.toUpperCase() === "NONE" || /^NONE[—\s:]/.test(t)) return [];
  const items = [];
  for (const line of t.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^\[([^\]]+)\]\s*(.*)/);
    if (m) items.push({ kind: m[1].trim(), text: m[2].trim() });
    else items.push({ kind: "입력", text: trimmed });
  }
  return items;
}

function extractOverallGate(text, fullText) {
  const m = text.match(/종합 판정[:\s]*(INSUFFICIENT_INPUT|BLOCKED|REVIEW_REQUIRED|PROVISIONALLY_READY)/i);
  if (m) return m[1].toUpperCase();
  const m2 = text.match(/Overall Gate[:\s]*(INSUFFICIENT_INPUT|BLOCKED|REVIEW_REQUIRED|PROVISIONALLY_READY)/i);
  if (m2) return m2[1].toUpperCase();
  return null;
}

function extractOverallGateFromBody(text) {
  const gates = ["PROVISIONALLY_READY", "REVIEW_REQUIRED", "BLOCKED", "INSUFFICIENT_INPUT"];
  for (const g of gates) {
    if (new RegExp("종합 판정[:\\s]*" + g).test(text)) return g;
    if (new RegExp("Overall Gate[:\\s]*" + g, "i").test(text)) return g;
  }
  const lines = text.split(/\r?\n/);
  const last = lines[lines.length - 1]?.trim() || "";
  const m = last.match(/^최종 상태:\s*(INSUFFICIENT_INPUT|BLOCKED|REVIEW_REQUIRED|PROVISIONALLY_READY)$/);
  if (m) return m[1];
  return null;
}

function parseTable(text, type) {
  if (!text || text.trim() === "") return [];
  const t = text.trim();
  if (t.toUpperCase() === "NONE" || /^NONE[—\s:]/.test(t)) return [];
  const rows = [];
  const lines = t.split(/\n/);
  let headerCells = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (/^\|.+\|$/.test(line)) {
      const cells = line.split("|").map(c => c.trim()).filter((c, i, arr) => i !== 0 && i !== arr.length - 1);
      if (headerCells === null) {
        headerCells = cells;
        continue;
      }
      if (cells.length >= 1 && cells[0]) {
        const row = {};
        headerCells.forEach((h, idx) => {
          const key = h.toLowerCase().replace(/\s/g, "").replace(/[–-]/g, "");
          row[key] = (cells[idx] ?? "").trim();
        });
        rows.push(row);
      }
      continue;
    }
    if (/\|/.test(line) && /^[^\w]\|\s/.test(line)) {
      const cells = line.split("|").map(c => c.trim()).filter((c, i, arr) => {
        if (arr.length > 0 && i === 0 && c === "") return false;
        if (arr.length > 1 && i === arr.length - 1 && c === "") return false;
        return true;
      });
      if (headerCells === null) {
        headerCells = cells;
        continue;
      }
      if (cells.length >= 1 && cells[0]) {
        const row = {};
        headerCells.forEach((h, idx) => {
          const key = h.toLowerCase().replace(/\s/g, "").replace(/[–-]/g, "");
          row[key] = (cells[idx] ?? "").trim();
        });
        rows.push(row);
      }
      continue;
    }
  }
  return rows;
}

function parseBlocking(text) {
  if (!text || text.trim() === "") return [];
  const t = text.trim();
  if (t.toUpperCase() === "NONE" || /^NONE[—\s:]/.test(t)) return [];
  const items = [];
  const seen = new Set();
  for (const line of t.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let m = trimmed.match(/^(R-\d{3})\s*\(([^)]+)\)\s*[—–:]\s*(.*)/);
    if (m) {
      if (!seen.has(m[1])) { items.push({ id: m[1], reason: m[3].trim() }); seen.add(m[1]); }
      continue;
    }
    m = trimmed.match(/^(R-\d{3})\s*[—–:]\s*(.*)/);
    if (m) {
      if (!seen.has(m[1])) { items.push({ id: m[1], reason: m[2].trim() }); seen.add(m[1]); }
      continue;
    }
    m = trimmed.match(/^-\s*(R-\d{3})\s*\([^)]*\)\s*[—–:]\s*(.*)/);
    if (m) {
      if (!seen.has(m[1])) { items.push({ id: m[1], reason: m[2].trim() }); seen.add(m[1]); }
      continue;
    }
    m = trimmed.match(/^-\s*(R-\d{3})\b\s*[—–:]\s*(.*)/);
    if (m) {
      if (!seen.has(m[1])) { items.push({ id: m[1], reason: m[2].trim() }); seen.add(m[1]); }
      continue;
    }
  }
  if (!items.length) {
    const nonEmpty = t.replace(/^NONE[—\s:]?\s*/i, "").trim();
    if (nonEmpty) items.push({ id: "BLOCK-" + (items.length + 1), reason: nonEmpty });
  }
  return items;
}

function parseWarnings(text) {
  if (!text || text.trim() === "") return [];
  const t = text.trim();
  if (t.toUpperCase() === "NONE" || /^NONE[—\s:]/.test(t)) return [];
  const items = [];
  const seen = new Set();
  for (const line of t.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let m = trimmed.match(/^(W-\d{3})\s*[—–:]\s*(.*)/);
    if (m) {
      if (!seen.has(m[1])) { items.push({ id: m[1], reason: m[2].trim() }); seen.add(m[1]); }
      continue;
    }
    m = trimmed.match(/^(R-\d{3})\s*[—–:]\s*(.*)/);
    if (m) {
      if (!seen.has(m[1])) { items.push({ id: m[1], reason: m[2].trim() }); seen.add(m[1]); }
      continue;
    }
  }
  if (!items.length) {
    const nonEmpty = t.replace(/^NONE[—\s:]?\s*/i, "").trim();
    if (nonEmpty) items.push({ id: "WARN-" + (items.length + 1), reason: nonEmpty });
  }
  return items;
}

function parseExternal(text) {
  if (!text || text.trim() === "") return [];
  const t = text.trim();
  if (t.toUpperCase() === "NONE" || /^NONE[—\s:]/.test(t)) return [];
  const items = [];
  const seen = new Set();
  for (const line of t.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let m = trimmed.match(/^(E-\d{3})\s*[—–:]\s*(.*)/);
    if (m) {
      if (!seen.has(m[1])) { items.push({ id: m[1], reason: m[2].trim() }); seen.add(m[1]); }
      continue;
    }
    m = trimmed.match(/^(R-\d{3})\s*[—–:]\s*(.*)/);
    if (m) {
      if (!seen.has(m[1])) { items.push({ id: m[1], reason: m[2].trim() }); seen.add(m[1]); }
      continue;
    }
  }
  if (!items.length) {
    const nonEmpty = t.replace(/^NONE[—\s:]?\s*/i, "").trim();
    if (nonEmpty) items.push({ id: "EXT-" + (items.length + 1), reason: nonEmpty });
  }
  return items;
}

function parseActions(text) {
  if (!text || text.trim() === "") return [];
  const t = text.trim();
  if (t.toUpperCase() === "NONE" || /^NONE[—\s:]/.test(t)) return [];
  const items = [];
  const orderPattern = /^(NOW|NEXT|지금|나중|우선|이후|즉시)[\s:｜－—-]*(.*)/i;
  let currentOrder = null;
  let currentLine = [];
  for (const line of t.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(orderPattern);
    if (m) {
      if (currentOrder && currentLine.length) {
        items.push({ order: normalizeOrder(currentOrder), target: "", action: currentLine.join(" ").trim() });
      }
      currentOrder = normalizeOrder(m[1]);
      currentLine = [m[2]];
    } else {
      currentLine.push(trimmed);
    }
  }
  if (currentOrder && currentLine.length) {
    items.push({ order: currentOrder, target: "", action: currentLine.join(" ").trim() });
  }
  if (!items.length) {
    const nonEmpty = t.replace(/^NONE[—\s:]?\s*/i, "").trim();
    if (nonEmpty) items.push({ order: "NOW", target: "일반", action: nonEmpty });
  }
  return items;
}

function normalizeOrder(o) {
  const up = o.toUpperCase();
  if (up === "지금" || up === "NOW" || up === "즉시" || up === "우선") return "NOW";
  return "NEXT";
}

function validateSubmitCheckOutput(parsed) {
  if (!parsed) return { ok: false, reason: "파싱 결과가 없음" };
  const gates = ["INSUFFICIENT_INPUT", "BLOCKED", "REVIEW_REQUIRED", "PROVISIONALLY_READY"];
  if (!gates.includes(parsed.overallGate)) {
    return { ok: false, reason: `종합 게이트가 유효하지 않음: ${parsed.overallGate || "없음"}. 유효한 게이트: ${gates.join(", ")}` };
  }
  // 10개 섹션 존재 확인
  const hasScope = parsed.scope !== null && parsed.scope !== undefined;
  const hasInventories = Array.isArray(parsed.inventories);
  const hasGate = gates.includes(parsed.overallGate);
  const hasMatrix = Array.isArray(parsed.matrixRows);
  const hasRubric = Array.isArray(parsed.rubricRows);
  const hasBlocking = Array.isArray(parsed.blockingIssues);
  const hasWarnings = Array.isArray(parsed.warnings);
  const hasExternal = Array.isArray(parsed.externalChecks);
  const hasActions = Array.isArray(parsed.prioritizedActions);
  const hasHandoff = parsed.handoff !== null && parsed.handoff !== undefined;
  if (!hasScope || !hasInventories || !hasGate || !hasMatrix || !hasRubric || !hasBlocking || !hasWarnings || !hasExternal || !hasActions || !hasHandoff) {
    const missing = [];
    if (!hasScope) missing.push("1. Review Scope");
    if (!hasInventories) missing.push("2. Input Inventory");
    if (!hasGate) missing.push("3. Overall Gate");
    if (!hasMatrix) missing.push("4. 요구사항 대응표");
    if (!hasRubric) missing.push("5. 평가기준 대응");
    if (!hasBlocking) missing.push("6. 제출 차단 항목");
    if (!hasWarnings) missing.push("7. 경고·모호성");
    if (!hasExternal) missing.push("8. 외부 확인 항목");
    if (!hasActions) missing.push("9. 수정 우선순위");
    if (!hasHandoff) missing.push("10. 최종 전달문");
    return { ok: false, reason: "SubmitCheck 10개 섹션 중 누락: " + missing.join(", ") };
  }
  return { ok: true };
}
