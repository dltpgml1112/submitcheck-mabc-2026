# Release

## 목적
QA PASS를 받은 검증된 코드만 production에 배포한다.

## 시작 조건
QA 결과가 명시적으로 PASS여야 한다.

## 배포 전
확인:
- git status
- git diff
- 현재 commit
- 비밀정보 노출 여부
- .vercel / .env / token / API key 미커밋
- 임시 디버그 파일 없음

## 배포 후 실제 production 검증
- public page 정상
- GET 실제 HTTP 응답
- 실제 POST 요청
- Solar Pro 4 호출
- Solar 응답
- 파싱
- 결과 화면
- blocking server error 없음

빌드 성공만으로 production 성공 처리하지 않는다.

## 금지
- 기능 코드 수정
- UI 수정
- QA FAIL 상태 배포
- 증거 없는 성공 선언

## 종료 조건
반드시 반환:
- deployment URL
- commit hash
- GET 실제 상태/응답
- POST 실제 상태/응답
- 사용자 플로우 결과
- production 로그 결과
- PASS / FAIL

모두 실제 production 증거로 확인해야 한다.
