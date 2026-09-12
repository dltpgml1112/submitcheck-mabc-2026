# submitcheck-mabc-2026

MABC 2026 Finalist — SubmitCheck: 제출 전 필수요건 점검 서비스

## 구성

- `index.html` — 정적 웹 UI (규정·제출물 입력, 예시 데이터 버튼, 결과 렌더링, 보고서 내려받기)
- `api/analyze.js` — Vercel 서버리스 함수 (POST `/api/analyze`). Solar Pro 4로 SubmitCheck 방법론을 적용하고 10섹션 고정 계약 구조로 파싱·검증해 반환.

## 로컬 확인 (배포 전)

Node.js로 서버리스 핸들러만 검증 가능. 실제 Solar 호출은 UPSTAGE_API_KEY가 있어야 하며, 없으면 호출 실패 경로로 빠진다.

```
node final-verify.js
```

위 스크립트는 다음을 확인한다.

- SubmitCheck 출력 파싱: BLOCKED 시나리오 등의 10섹션 구조 파싱
- API 핸들러: 정상 입력, 빈 입력, 한쪽만 입력, GET 상태 응답, 이상 입력, 허용되지 않은 메서드, 유효하지 않은 JSON 본문
- 응답 JSON에 UPSTAGE_API_KEY / up_ 패턴 누출 여부

결과 예시는 이 저장소 `final-verify.js` 실행 출력 참조.

## 배포 전 필수 설정 (Vercel)

- 환경변수 `UPSTAGE_API_KEY` 설정 (Production + Preview). 키는 클라이언트에 노출되지 않으며 서버리스 함수 내부에서만 사용한다.
- `UPSTAGE_BASE_URL`은 기본값이 `https://api.upstage.ai/v1`이며 필요 시 재정의.

## 제한

- 이 결과는 제공 자료 범위의 잠정 점검이며 공식 접수·심사 결과를 보장하지 않는다.
- 외부 상태(실제 업로드·링크·계정·현재 시각 등) 확인이 필요한 항목은 서비스에서 직접 확인하지 않고 EXTERNAL_CHECK로 표시한다.
- 실제 Solar 호출 성공 여부는 이 저장소의 로컬 확인만으로는 검증하지 않는다(UPSTAGE_API_KEY 필요). 배포 후 실제 호출로 확인.

## 배포

배포는 아직 하지 않음. 배포 직전 상태.
