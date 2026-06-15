/**
 * API 연동 전 목업용 역·혼잡도 데이터 (인천 1·2호선, 서울 1~9호선)
 */

export type LineNumber = 1 | 2

export interface MockStation {
  id: string
  name: string
  lineNumber: LineNumber
  order: number
}

export interface MockCongestionEntry {
  lineNumber: LineNumber
  congestionLevel: number
  recordedAt: string
}

/** 1~10 정수 랜덤 혼잡도 */
function randomCongestionLevel(): number {
  return Math.floor(Math.random() * 10) + 1
}

/** 인천 호선 역 이름 배열 → MockStation[] */
function buildIncheonStations(
  names: readonly string[],
  lineNumber: LineNumber
): MockStation[] {
  return names.map((name, index) => ({
    id: `l${lineNumber}-${String(index + 1).padStart(2, '0')}`,
    name,
    lineNumber,
    order: index + 1,
  }))
}

/** 서울 호선 역 이름 배열 → MockStation[] (id: s{n}-01 형식) */
function buildSeoulStations(
  seoulLine: number,
  names: readonly string[]
): MockStation[] {
  const prefix = `s${seoulLine}`
  return names.map((name, index) => ({
    id: `${prefix}-${String(index + 1).padStart(2, '0')}`,
    name,
    lineNumber: 2,
    order: index + 1,
  }))
}

/** 인천 1호선 */
const LINE_1_STATION_NAMES = [
  '검단호수공원',
  '신검단중앙',
  '아라',
  '계양',
  '귤현',
  '박촌',
  '임학',
  '계산',
  '경인교대입구',
  '작전',
  '갈산',
  '부평구청',
  '부평시장',
  '부평',
  '동수',
  '부평삼거리',
  '간석오거리',
  '인천시청',
  '예술회관',
  '인천터미널',
  '문학경기장',
  '선학',
  '신연수',
  '원인재',
  '동춘',
  '캠퍼스타운',
  '테크노파크',
  '지식정보단지',
  '인천대입구',
  '센트럴파크',
  '국제업무지구',
] as const

/** 인천 2호선 */
const LINE_2_STATION_NAMES = [
  '운연',
  '인천대공원',
  '삼산체육관',
  '마전',
  '구월산',
  '어진',
  '인천시청',
  '석바위시장',
  '인천가좌',
  '서부여성회관',
  '검암',
  '왕길',
  '검단오류',
] as const

/** 서울 1호선 (소요산 ~ 신창) */
const LINE_S1_STATION_NAMES = [
  '소요산',
  '동두천',
  '보산',
  '동두천중앙',
  '지행',
  '덕정',
  '덕계',
  '양주',
  '녹양',
  '가능',
  '의정부',
  '회룡',
  '망월사',
  '도봉산',
  '도봉',
  '방학',
  '창동',
  '녹천',
  '월계',
  '광운대',
  '석계',
  '신이문',
  '외대앞',
  '회기',
  '청량리',
  '제기동',
  '신설동',
  '동묘앞',
  '동대문',
  '종로5가',
  '종로3가',
  '종각',
  '서울역',
  '남영',
  '용산',
  '노량진',
  '대방',
  '신길',
  '영등포',
  '신도림',
  '구로',
  '구일',
  '개봉',
  '오류동',
  '온수',
  '역곡',
  '소사',
  '부천',
  '중동',
  '송내',
  '부개',
  '부평',
  '백운',
  '동암',
  '간석',
  '주안',
  '도화',
  '제물포',
  '도원',
  '동인천',
  '인천',
  '가산디지털단지',
  '독산',
  '금천구청',
  '석수',
  '관악',
  '안양',
  '명학',
  '금정',
  '군포',
  '당정',
  '의왕',
  '성균관대',
  '화서',
  '수원',
  '세류',
  '병점',
  '세마',
  '오산대',
  '오산',
  '진위',
  '송탄',
  '서정리',
  '지제',
  '평택',
  '성환',
  '직산',
  '두정',
  '천안',
  '봉명',
  '쌍용',
  '아산',
  '배방',
  '온양온천',
  '신창',
] as const

/** 서울 2호선 (순환+지선) */
const LINE_S2_STATION_NAMES = [
  '시청',
  '을지로입구',
  '을지로3가',
  '을지로4가',
  '동대문역사문화공원',
  '신당',
  '상왕십리',
  '왕십리',
  '한양대',
  '뚝섬',
  '성수',
  '건대입구',
  '구의',
  '강변',
  '잠실나루',
  '잠실',
  '신천',
  '종합운동장',
  '삼성',
  '선릉',
  '역삼',
  '강남',
  '교대',
  '서초',
  '방배',
  '사당',
  '낙성대',
  '서울대입구',
  '봉천',
  '신림',
  '신대방',
  '구로디지털단지',
  '대림',
  '신도림',
  '문래',
  '영등포구청',
  '당산',
  '합정',
  '홍대입구',
  '신촌',
  '이대',
  '아현',
  '충정로',
  '까치산',
  '신정네거리',
  '양천구청',
  '도림천',
] as const

/** 서울 3호선 */
const LINE_S3_STATION_NAMES = [
  '대화',
  '주엽',
  '정발산',
  '마두',
  '백석',
  '대곡',
  '화정',
  '원당',
  '원흥',
  '삼송',
  '지축',
  '구파발',
  '연신내',
  '불광',
  '녹번',
  '홍제',
  '무악재',
  '독립문',
  '경복궁',
  '안국',
  '종로3가',
  '을지로3가',
  '충무로',
  '동대입구',
  '약수',
  '금호',
  '옥수',
  '압구정',
  '신사',
  '잠원',
  '고속터미널',
  '교대',
  '남부터미널',
  '양재',
  '매봉',
  '도곡',
  '대치',
  '학여울',
  '대청',
  '일원',
  '수서',
  '가락시장',
  '경찰병원',
  '오금',
] as const

/** 서울 4호선 */
const LINE_S4_STATION_NAMES = [
  '진접',
  '오남',
  '별내별가람',
  '당고개',
  '상계',
  '노원',
  '창동',
  '쌍문',
  '수유',
  '미아',
  '미아사거리',
  '길음',
  '성신여대입구',
  '한성대입구',
  '혜화',
  '동대문',
  '동대문역사문화공원',
  '충무로',
  '명동',
  '회현',
  '서울역',
  '숙대입구',
  '삼각지',
  '신용산',
  '이촌',
  '동작',
  '총신대입구',
  '사당',
  '남태령',
  '선바위',
  '경마공원',
  '대공원',
  '과천',
  '정부과천청사',
  '인덕원',
  '평촌',
  '범계',
  '금정',
  '산본',
  '수리산',
  '대야미',
  '반월',
  '상록수',
  '한대앞',
  '중앙',
  '고잔',
  '초지',
  '안산',
  '신길온천',
  '정왕',
  '오이도',
] as const

/** 서울 5호선 */
const LINE_S5_STATION_NAMES = [
  '방화',
  '개화산',
  '김포공항',
  '송정',
  '마곡',
  '발산',
  '우장산',
  '화곡',
  '까치산',
  '신정',
  '목동',
  '오목교',
  '양평',
  '영등포구청',
  '영등포시장',
  '신길',
  '여의도',
  '여의나루',
  '마포',
  '공덕',
  '애오개',
  '충정로',
  '서대문',
  '광화문',
  '종로3가',
  '을지로4가',
  '동대문역사문화공원',
  '청구',
  '신금호',
  '행당',
  '왕십리',
  '마장',
  '답십리',
  '장한평',
  '군자',
  '아차산',
  '광나루',
  '천호',
  '강동',
  '길동',
  '굽은다리',
  '명일',
  '고덕',
  '상일동',
  '둔촌동',
  '올림픽공원',
  '방이',
  '오금',
  '개롱',
  '거여',
  '마천',
] as const

/** 서울 6호선 */
const LINE_S6_STATION_NAMES = [
  '응암',
  '역촌',
  '불광',
  '독바위',
  '연신내',
  '구산',
  '새절',
  '증산',
  '디지털미디어시티',
  '월드컵경기장',
  '마포구청',
  '망원',
  '합정',
  '상수',
  '광흥창',
  '대흥',
  '공덕',
  '효창공원앞',
  '삼각지',
  '녹사평',
  '이태원',
  '한강진',
  '버티고개',
  '약수',
  '청구',
  '신당',
  '동묘앞',
  '창신',
  '보문',
  '안암',
  '고려대',
  '월곡',
  '상월곡',
  '돌곶이',
  '석계',
  '태릉입구',
  '화랑대',
  '봉화산',
  '신내',
] as const

/** 서울 7호선 */
const LINE_S7_STATION_NAMES = [
  '장암',
  '도봉산',
  '수락산',
  '마들',
  '노원',
  '중계',
  '하계',
  '공릉',
  '태릉입구',
  '먹골',
  '중화',
  '상봉',
  '면목',
  '사가정',
  '용마산',
  '중곡',
  '군자',
  '어린이대공원',
  '건대입구',
  '뚝섬유원지',
  '청담',
  '강남구청',
  '학동',
  '논현',
  '반포',
  '고속터미널',
  '내방',
  '이수',
  '남성',
  '숭실대입구',
  '상도',
  '장승배기',
  '신대방삼거리',
  '보라매',
  '신풍',
  '대림',
  '남구로',
  '가산디지털단지',
  '철산',
  '광명사거리',
  '천왕',
  '온수',
  '까치울',
  '부천종합운동장',
  '춘의',
  '신중동',
  '부천시청',
  '상동',
  '삼산체육관',
  '굴포천',
  '부평구청',
  '산곡',
  '석남',
] as const

/** 서울 8호선 */
const LINE_S8_STATION_NAMES = [
  '암사',
  '천호',
  '강동구청',
  '몽촌토성',
  '잠실',
  '석촌',
  '송파',
  '가락시장',
  '문정',
  '장지',
  '복정',
  '산성',
  '남위례',
  '단대오거리',
  '신흥',
  '수진',
  '모란',
] as const

/** 서울 9호선 */
const LINE_S9_STATION_NAMES = [
  '개화',
  '김포공항',
  '공항시장',
  '신방화',
  '마곡나루',
  '양천향교',
  '가양',
  '증미',
  '등촌',
  '염창',
  '신목동',
  '선유도',
  '당산',
  '국회의사당',
  '여의도',
  '샛강',
  '노량진',
  '노들',
  '흑석',
  '동작',
  '구반포',
  '신반포',
  '고속터미널',
  '사평',
  '신논현',
  '언주',
  '선정릉',
  '삼성중앙',
  '봉은사',
  '종합운동장',
  '삼전',
  '석촌고분',
  '석촌',
  '송파나루',
  '한성백제',
  '올림픽공원',
  '둔촌오륜',
  '중앙보훈병원',
] as const

export const MOCK_LINE_1_STATIONS: MockStation[] = buildIncheonStations(
  LINE_1_STATION_NAMES,
  1
)

export const MOCK_LINE_2_STATIONS: MockStation[] = buildIncheonStations(
  LINE_2_STATION_NAMES,
  2
)

export const MOCK_LINE_S1_STATIONS: MockStation[] = buildSeoulStations(
  1,
  LINE_S1_STATION_NAMES
)

export const MOCK_LINE_S2_STATIONS: MockStation[] = buildSeoulStations(
  2,
  LINE_S2_STATION_NAMES
)

export const MOCK_LINE_S3_STATIONS: MockStation[] = buildSeoulStations(
  3,
  LINE_S3_STATION_NAMES
)

export const MOCK_LINE_S4_STATIONS: MockStation[] = buildSeoulStations(
  4,
  LINE_S4_STATION_NAMES
)

export const MOCK_LINE_S5_STATIONS: MockStation[] = buildSeoulStations(
  5,
  LINE_S5_STATION_NAMES
)

export const MOCK_LINE_S6_STATIONS: MockStation[] = buildSeoulStations(
  6,
  LINE_S6_STATION_NAMES
)

export const MOCK_LINE_S7_STATIONS: MockStation[] = buildSeoulStations(
  7,
  LINE_S7_STATION_NAMES
)

export const MOCK_LINE_S8_STATIONS: MockStation[] = buildSeoulStations(
  8,
  LINE_S8_STATION_NAMES
)

export const MOCK_LINE_S9_STATIONS: MockStation[] = buildSeoulStations(
  9,
  LINE_S9_STATION_NAMES
)

export const MOCK_ALL_STATIONS: MockStation[] = [
  ...MOCK_LINE_1_STATIONS,
  ...MOCK_LINE_2_STATIONS,
  ...MOCK_LINE_S1_STATIONS,
  ...MOCK_LINE_S2_STATIONS,
  ...MOCK_LINE_S3_STATIONS,
  ...MOCK_LINE_S4_STATIONS,
  ...MOCK_LINE_S5_STATIONS,
  ...MOCK_LINE_S6_STATIONS,
  ...MOCK_LINE_S7_STATIONS,
  ...MOCK_LINE_S8_STATIONS,
  ...MOCK_LINE_S9_STATIONS,
]

/** 호선별 최신 목업 혼잡도 (1~10) */
export const MOCK_CONGESTION_BY_LINE: Record<LineNumber, MockCongestionEntry> = {
  1: {
    lineNumber: 1,
    congestionLevel: randomCongestionLevel(),
    recordedAt: new Date().toISOString(),
  },
  2: {
    lineNumber: 2,
    congestionLevel: randomCongestionLevel(),
    recordedAt: new Date().toISOString(),
  },
}

/** 호선별 혼잡도 이력 목업 (최근 5건, 1~10 랜덤) */
export const MOCK_CONGESTION_RECENT: MockCongestionEntry[] = ([1, 2] as const).flatMap(
  (lineNumber) =>
    Array.from({ length: 5 }, (_, index) => ({
      lineNumber,
      congestionLevel: randomCongestionLevel(),
      recordedAt: new Date(Date.now() - index * 60_000).toISOString(),
    }))
)
