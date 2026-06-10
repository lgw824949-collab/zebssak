/** 막차 이후·첫차 이전(한국 표준시 00:00~05:29) — 대체 목업 열차 비표시 기준 */
const OPERATING_START_MINUTES = 5 * 60 + 30

export const SUBWAY_OUTSIDE_OPERATING_HOURS_MESSAGE =
  '지금은 운행 시간이 아닙니다. 첫차 이후에 다시 시도해 주세요.'

/** 한국 표준시 기준 당일 0시부터 경과 분 */
export function getKoreaMinutesOfDay(now: Date = new Date()): number {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = formatter.formatToParts(now)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
  return hour * 60 + minute
}

/** 서울·인천 지하철 운행 시간 여부(05:30~24:00 KST) */
export function isSubwayOperatingHours(line: string, now: Date = new Date()): boolean {
  void line
  const minutes = getKoreaMinutesOfDay(now)
  return minutes >= OPERATING_START_MINUTES
}
