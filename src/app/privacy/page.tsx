'use client'

import Link from 'next/link'

const PRIVACY_SECTIONS = [
  {
    title: '수집 항목',
    lines: [
      '회원가입: 아이디, 비밀번호(암호화 저장)',
      '서비스 이용: 목적지·열차·좌석 등 매칭 정보',
      '위치 정보: 출발역 확인용 (선택·1회성)',
      '기기 정보: 푸시 알림 수신 시 토큰',
    ],
  },
  {
    title: '이용 목적',
    lines: [
      '빈자리 찾기·자리 넘기기 매칭 제공',
      '매칭 알림·서비스 안내',
      '이용 제한·부정 이용 방지',
    ],
  },
  {
    title: '보관 및 파기',
    lines: [
      '회원 탈퇴 또는 목적 달성 시 지체 없이 파기',
      '관련 법령에 따른 보관 기간이 있으면 해당 기간 준수',
    ],
  },
  {
    title: '제3자 제공',
    lines: [
      '법령 근거 또는 이용자 동의 없이 외부에 제공하지 않습니다.',
      '서비스 운영을 위해 클라우드(DB·알림) 업체에 처리를 위탁할 수 있습니다.',
    ],
  },
] as const

/**
 * 개인정보 처리방침
 */
export default function PrivacyPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#F7F8FA]">
      <header className="zeb-app-header justify-between">
        <Link
          href="/"
          className="zeb-touch-target flex shrink-0 items-center text-sm font-medium text-[#6B7280]"
        >
          ← 홈
        </Link>
        <h1 className="flex-1 text-center text-[17px] font-bold text-[#1A1A1A]">개인정보 처리방침</h1>
        <span className="zeb-touch-target w-12 shrink-0" aria-hidden />
      </header>

      <main className="zeb-no-scrollbar mx-auto w-full max-w-md flex-1 overflow-y-auto px-4 py-6">
        <p className="text-[14px] font-medium leading-relaxed text-[#6B7280]">
          잽싸게(빈자리, 잽싸게)는 이용자의 개인정보를 소중히 하며, 관련 법령을 준수합니다.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          {PRIVACY_SECTIONS.map((section) => (
            <section
              key={section.title}
              className="rounded-2xl border border-[#EBEBEB] bg-white px-4 py-4"
            >
              <h2 className="text-[15px] font-bold text-[#1A1A1A]">{section.title}</h2>
              <ul className="mt-2.5 flex flex-col gap-1.5">
                {section.lines.map((line) => (
                  <li key={line} className="text-[14px] leading-snug text-[#4B5563]">
                    · {line}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <p className="mt-4 text-[12px] font-medium text-[#9CA3AF]">시행일: 2026년 6월 11일</p>
      </main>
    </div>
  )
}
