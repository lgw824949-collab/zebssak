# 잽싸게 (Zeb-ssak)

인천 지하철 빈자리, 눈치 보지 말고 잽싸게 잡으세요.

## 서비스 개요
인천 지하철 1·2호선 하차 예정자와 착석 희망자를
실시간 P2P 매칭하는 서비스

## 기술 스택
- Frontend: Next.js 14 (App Router)
- Backend: Next.js API Routes
- Database: Supabase
- 실시간: Supabase Realtime
- 스타일: Tailwind CSS

## 매칭 핵심 규칙
- 목적지 입력 필수 (없으면 참여 불가)
- 목적지까지 최소 3역 이상 남아야 참여 가능
- 우선순위: 교통약자 → 남은 역 수 → 요청 시각
- 매칭 알림 수락 시간: 30초
- 혼잡도 7 이상 시 기능 전면 정지
- 노쇼 3회 누적 시 7일 이용 정지

## 폴더 구조
/app
  /api
    /auth
    /users
    /stations
    /trains
    /match-requests
    /matches
    /notifications
    /congestion
    /penalties
/lib
  supabase.ts
/types
  index.ts

## DB 테이블
users
stations
trains
match_requests
matches
points
notifications
congestion_logs
penalties
cancellations

## 화면 목록
1. 회원가입
2. 로그인
3. 메인 홈
4. 탑승 화면
5. 착석 희망 대기
6. 하차 예정 등록
7. 매칭 알림
8. 매칭 완료
9. 포인트 내역
10. 프로필 설정
11. 노쇼 패널티 안내
12. 혼잡도 기능 정지 안내
13. 매칭 실패

## 외부 API
- 인천교통공사 실시간 열차 위치 API
- 인천교통공사 혼잡도 API
- 인천데이터포털 역사 정보 API
- 카카오맵 API
- T-money API

## 환경변수 (.env.local)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
INCHEON_METRO_API_KEY=
KAKAO_MAP_API_KEY=

## 개발 진행 상황
- [ ] DB 테이블 생성
- [ ] 인증 API 구현
- [ ] 매칭 알고리즘 구현
- [ ] 혼잡도 API 연동
- [ ] 프론트엔드 화면 구현
- [ ] 인천교통공사 API 연동
- [ ] 테스트 및 버그 수정
- [ ] 시연 영상 촬영

## 마감
2026년 6월 12일 (금) 18:00
인천광역시 공공데이터·AI 활용 창업경진대회