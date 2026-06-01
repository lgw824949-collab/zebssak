'use client'

/**
 * 메인 히어로 — 지하철 객실 일러스트 (가벼움, 500 오류 없음).
 * 실사를 쓰려면 public/images/home-hero.webp 추가 후 아래 USE_HERO_PHOTO 를 true 로.
 */
const USE_HERO_PHOTO = false
const HERO_IMAGE_PATH = '/images/home-hero.webp'

function SubwayInteriorIllustration() {
  return (
    <svg
      viewBox="0 0 360 200"
      className="h-full w-full"
      aria-hidden
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id="car-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E8EDF5" />
          <stop offset="100%" stopColor="#D4DCE8" />
        </linearGradient>
        <linearGradient id="window-glow" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#B8D4F0" stopOpacity="0.3" />
          <stop offset="50%" stopColor="#E8F4FF" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#B8D4F0" stopOpacity="0.3" />
        </linearGradient>
        <linearGradient id="seat-empty" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#D4F574" />
          <stop offset="100%" stopColor="#9BCB2E" />
        </linearGradient>
      </defs>

      <rect width="360" height="200" fill="url(#car-floor)" />
      <rect x="0" y="0" width="360" height="52" fill="#0B1F4B" opacity="0.92" />

      {[72, 180, 288].map((x) => (
        <g key={x}>
          <rect x={x - 28} y="12" width="56" height="8" rx="4" fill="#1E3A6E" />
          <rect x={x - 20} y="16" width="40" height="4" rx="2" fill="#C6FF00" opacity="0.85" />
        </g>
      ))}

      <rect x="16" y="54" width="328" height="58" rx="6" fill="#8FA8C4" opacity="0.35" />
      <rect x="24" y="58" width="152" height="50" rx="4" fill="url(#window-glow)" />
      <rect x="184" y="58" width="152" height="50" rx="4" fill="url(#window-glow)" />
      <rect x="0" y="118" width="360" height="5" rx="2" fill="#9AA8BC" />
      {[48, 120, 240, 312].map((x) => (
        <rect key={x} x={x} y="112" width="6" height="28" rx="3" fill="#7B8DA6" />
      ))}

      <g opacity="0.55">
        <rect x="28" y="132" width="44" height="36" rx="8" fill="#B8C5D6" />
        <rect x="78" y="132" width="44" height="36" rx="8" fill="#B8C5D6" />
        <rect x="238" y="132" width="44" height="36" rx="8" fill="#B8C5D6" />
        <rect x="288" y="132" width="44" height="36" rx="8" fill="#B8C5D6" />
        <rect x="188" y="132" width="44" height="36" rx="8" fill="#B8C5D6" />
      </g>
      <g>
        <rect x="128" y="128" width="48" height="40" rx="10" fill="url(#seat-empty)" />
        <text x="152" y="154" textAnchor="middle" fontSize="10" fontWeight="700" fill="#0B1F4B" opacity="0.65">
          빈자리
        </text>
      </g>

      <rect x="0" y="178" width="360" height="22" fill="#C5CED9" opacity="0.5" />
    </svg>
  )
}

export default function HomeHeroVisual() {
  return (
    <div className="relative mx-auto mb-6 w-full max-w-[340px] overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white shadow-[0_12px_40px_rgba(11,31,75,0.08)]">
      <div
        className="relative aspect-[17/10] w-full overflow-hidden bg-gradient-to-b from-[#0B1F4B] via-[#1a3a6e] to-[#E8EDF5]"
        style={
          USE_HERO_PHOTO
            ? {
                backgroundImage: `url(${HERO_IMAGE_PATH})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }
            : undefined
        }
      >
        {!USE_HERO_PHOTO ? <SubwayInteriorIllustration /> : null}
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0B1F4B]/75 via-[#0B1F4B]/25 to-transparent"
          aria-hidden
        />
      </div>

      <div className="absolute bottom-0 left-0 right-0 px-4 pb-3 pt-8">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#C6FF00]">
          Real-time seat share
        </p>
        <p className="mt-0.5 text-[13px] font-semibold text-white/90">
          지금 이 칸, 비어 있을 수 있어요
        </p>
      </div>
    </div>
  )
}
