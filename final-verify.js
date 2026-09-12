// final-verify.js — 파싱 + API 핸들러 최종 통합 확인 (일회성)
const fs = require('fs');

const code = fs.readFileSync('api/analyze.js', 'utf8');

// parse + validate 함수만 추출
const startIdx = code.indexOf('function parseSubmitCheckOutput(text)');
const endIdx = code.indexOf('function validateSubmitCheckOutput(parsed)');
const extractEnd = code.indexOf('\n}', endIdx + 'function validateSubmitCheckOutput(parsed)'.length);
const extractCode = code.slice(startIdx, extractEnd + 2);

const fn = new Function('console', 'require', extractCode + '\nreturn { parseSubmitCheckOutput, validateSubmitCheckOutput };');
const { parseSubmitCheckOutput, validateSubmitCheckOutput } = fn(console, require);

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

const sampleOutput = `SUBMITCHECK REPORT

### 1. Review Scope / 검토 범위
사용자가 제공한 2026 AI 메이커 부트캠프 결선 제출 규정(S1)과 제출물 초안(A1)을 대상으로 분석.

### 2. Input Inventory / 입력 자료
- [규정] 2026 AI 메이커 부트캠프 결선 제출 규정 (S1) — 9개 항목
- [제출물] 제출물 초안 (A1)

### 3. Overall Gate / 종합 판정
BLOCKED

### 4. Requirement–Evidence–Status Matrix / 요구사항 대응표
| ID | 원자 요구사항과 출처 | 의무 수준 | 적용 조건 | 검증 유형 | 근거와 위치 | 상태 | 판정 이유 |
| R-001 | 제출물은 반드시 PDF 형식이어야 함 / S1-1 | MUST | 규정 전체 적용 | CONTENT_CHECKABLE | A1 "파일 형식: PDF" | PASS | 제출물에 PDF로 명시 |
| R-002 | 제출물 파일명은 반드시 "submission.pdf"여야 함 / S1-2 | MUST | 규정 전체 적용 | CONTENT_CHECKABLE | A1 "파일명: my_entry.pdf" | FAIL | 규정 요구 "submission.pdf" vs 제출물 "my_entry.pdf" |
| R-003 | 제출물은 10페이지를 초과하면 안 됨 / S1-3 | MUST | 규정 전체 적용 | CONTENT_CHECKABLE | A1 "페이지 수: 12페이지" | FAIL | 12페이지는 10페이지 초과 |

### 5. Rubric Coverage / 평가기준 대응
| ID | 평가기준과 출처 | 배점 | 근거와 위치 | 상태 | 판정 이유 |
| C-001 | 제출물 형식·파일명·분량 준수 (S1-1, S1-2, S1-3) | UNKNOWN | R-001~R-003 | PARTIAL | PDF는 PASS, 파일명·분량은 FAIL |

### 6. Blocking Issues / 제출 차단 항목
- R-002 (파일명) — MUST FAIL: 파일명 수정 필요.
- R-003 (분량) — MUST FAIL: 페이지 수 조정 필요.

### 7. Warnings & Ambiguities / 경고·모호성
NONE

### 8. External Checks / 외부 확인 항목
NONE

### 9. Prioritized Action Checklist / 수정 우선순위
NOW — 파일명을 "submission.pdf"로 변경 (R-002)
NOW — 페이지 수를 10페이지 이하로 조정 (R-003)

### 10. Submission Handoff / 최종 전달문
검토 범위: S1 규정(9개 항목)과 A1 제출물 초안. 종합 게이트: BLOCKED. MUST 실패 2건. 제공 자료 범위의 잠정 점검이며 공식 접수·심사 결과를 보장하지 않음.

최종 상태: BLOCKED`;

console.log('=== 파트 1: 파싱 테스트 ===');
{
  const p = parseSubmitCheckOutput(sampleOutput);
  assert(p !== null, '파싱 결과 null 아님');
  assert(p.scope && p.scope.includes('분석'), 'scope 확인');
  assert(p.overallGate === 'BLOCKED', '게이트 BLOCKED');
  assert(p.matrixRows.length === 3, 'matrix 3행');
  assert(p.matrixRows[0].id === 'R-001' && p.matrixRows[0].상태 === 'PASS', '첫 행 PASS');
  assert(p.matrixRows[1].상태 === 'FAIL', '둘째 행 FAIL');
  assert(p.matrixRows[2].상태 === 'FAIL', '셋째 행 FAIL');
  assert(p.blockingIssues.length === 2, 'blocking 2건');
  assert(p.blockingIssues[0].id === 'R-002', 'blocking R-002');
  assert(p.blockingIssues[1].id === 'R-003', 'blocking R-003');
  assert(p.warnings.length === 0, 'warnings 없음');
  assert(p.externalChecks.length === 0, 'external 없음');
  assert(p.prioritizedActions.length === 2, 'actions 2건');
  assert(p.prioritizedActions[0].order === 'NOW', 'action NOW');
  assert(p.handoff && p.handoff.includes('BLOCKED'), 'handoff 게이트');
  console.log('PASS: BLOCKED 시나리오 파싱');
}

// === 파트 2: API 핸들러 테스트 ===
(async () => {
console.log('=== 파트 2: API 핸들러 테스트 ===');

  // analyze.js를 CommonJS로 변환해서 require
  // export default async function handler → async function handler
  let converted = code
    .replace(/^export\s+default\s+async\s+function\s+(\w+)/m, 'async function $1')
    .replace(/^export\s+(const|let|var|function|class)\s+/gm, '$1 ');
  const withExports = converted + '\nmodule.exports = { handler };\n';

  const tmpFile = '.tmp-analyze-cjs.js';
  fs.writeFileSync(tmpFile, withExports);
  const { handler } = require('./' + tmpFile);
  fs.unlinkSync(tmpFile);

  function mockReq(method, body) {
    return {
      method,
      url: '/api/analyze',
      headers: {},
      json: async () => body,
      text: async () => JSON.stringify(body)
    };
  }

  // 테스트 1: 정상 입력 → 키 없음 → REVIEW_REQUIRED
  const r1 = await handler(mockReq('POST', { regulation: '제출물은 PDF여야 함', submission: '파일: test.pdf' }));
  assert(r1.body.overallGate === 'REVIEW_REQUIRED', '정상 입력 → REVIEW_REQUIRED');
  assert(r1.body.warnings.some(w => w.id === 'LLM_CALL'), 'LLM_CALL 경고');
  assert(!JSON.stringify(r1.body).includes('UPSTAGE_API_KEY'), '응답에 UPSTAGE_API_KEY 없음');
  assert(!/up_[a-zA-Z0-9]{16,}/.test(JSON.stringify(r1.body)), '응답에 up_ 패턴 없음');
  console.log('PASS: 정상 입력 → REVIEW_REQUIRED + 키 노출 없음');

  // 테스트 2: 빈 입력 → INSUFFICIENT_INPUT
  const r2 = await handler(mockReq('POST', { regulation: '', submission: '' }));
  assert(r2.body.overallGate === 'INSUFFICIENT_INPUT', '빈 입력 → INSUFFICIENT_INPUT');
  console.log('PASS: 빈 입력 → INSUFFICIENT_INPUT');

  // 테스트 3: 규정만 → INSUFFICIENT_INPUT
  const r3 = await handler(mockReq('POST', { regulation: '규정', submission: '' }));
  assert(r3.body.overallGate === 'INSUFFICIENT_INPUT', '규정만 → INSUFFICIENT_INPUT');
  console.log('PASS: 규정만 → INSUFFICIENT_INPUT');

  // 테스트 4: GET 상태 응답
  const r4 = await handler({ method: 'GET', url: '/api/analyze', headers: {} });
  assert(r4.status === 200 && r4.body.ok === true, 'GET 상태 응답');
  console.log('PASS: GET 상태 응답');

  // 테스트 5: 이상 입력 → REVIEW_REQUIRED
  const r5 = await handler(mockReq('POST', { regulation: '@@@!!!', submission: '###$$$' }));
  assert(r5.body.overallGate === 'REVIEW_REQUIRED', '이상 입력 → REVIEW_REQUIRED');
  console.log('PASS: 이상 입력 → REVIEW_REQUIRED');

  // 테스트 6: POST 아닌 메서드 → 405
  const r6 = await handler({ method: 'PUT', url: '/api/analyze', headers: {} });
  assert(r6.status === 405, 'PUT → 405');
  console.log('PASS: PUT → 405');

  // 테스트 7: 유효하지 않은 JSON 본문 → 400
  const r7 = await handler({
    method: 'POST',
    url: '/api/analyze',
    headers: { 'Content-Type': 'application/json' },
    json: async () => { throw new Error('invalid json'); },
    text: async () => 'bad json'
  });
  assert(r7.status === 400, '유효하지 않은 JSON → 400');
  console.log('PASS: 유효하지 않은 JSON → 400');

  console.log('\n=== 최종 확인 완료 ===');
  console.log('파싱: BLOCKED 시나리오 PASS');
  console.log('API 핸들러: 정상/빈입력/규정만/GET/이상입력/메서드/JSON오류 PASS');
  console.log('키 노출: 응답 JSON에 UPSTAGE_API_KEY / up_ 패턴 없음 PASS');
  console.log('실제 Solar 호출: UPSTAGE_API_KEY 환경변수 없음 → 미검증 (Vercel 배포 시 확인)');
  console.log('배포: 하지 않음 (배포 직전 상태)');
})();
