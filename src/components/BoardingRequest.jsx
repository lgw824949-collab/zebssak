import { useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import SubwaySeatMap, { mapSeatIdToApi } from "@/components/SubwaySeatMap";
import { formatExitDoorDisplayLabel } from "@/lib/match-display";
import { handleUnauthorizedResponse } from "@/lib/auth-client";
import { normalizeDirectionForStorage } from "@/lib/match-direction";
import {
  isSubwayOperatingHours,
  SUBWAY_OUTSIDE_OPERATING_HOURS_MESSAGE,
} from "@/lib/subway-operating-hours";

function resolveApiLineFromLineProp(lineLabel) {
  const compact = normalizeLineLabelCompact(lineLabel);
  const seoulMatch = compact.match(/^서울([1-9])호선$/);
  if (seoulMatch?.[1]) {
    return `seoul${seoulMatch[1]}`;
  }

  const incheonMatch = compact.match(/^인천([12])호선$/);
  if (incheonMatch?.[1]) {
    return `incheon${incheonMatch[1]}`;
  }

  return null;
}

/** 서울 1~9호선 — 실시간·좌석 선택 지원 */
function isSeoulLineFromLineProp(lineLabel) {
  const apiLine = resolveApiLineFromLineProp(lineLabel);
  return typeof apiLine === "string" && apiLine.startsWith("seoul");
}

function resolveLineNumberFromLineProp(lineLabel) {
  const normalized = (lineLabel || "").replace(/\s+/g, "");
  if (normalized === "인천1호선" || /^서울1호선$/.test(normalized)) return 1;
  return 2;
}

function resolveStationCodePrefixFromLineProp(lineLabel) {
  const normalized = (lineLabel || "").replace(/\s+/g, "");
  const incheonMatch = normalized.match(/^인천([12])호선$/);
  if (incheonMatch?.[1]) return `l${incheonMatch[1]}`;
  const seoulMatch = normalized.match(/^서울([1-9])호선$/);
  if (seoulMatch?.[1]) return `s${seoulMatch[1]}`;
  return "s1";
}

/** 호선별 객실 레이아웃 (SubwaySeatMap LINE_CAR_LAYOUT과 동일) */
const LINE_CAR_LAYOUT = {
  seoul1: {
    doorCount: 4,
    seatsPerSection: 8,
    prioritySeats: 3,
    carCount: 10,
  },
  seoul2: {
    doorCount: 4,
    seatsPerSection: 7,
    prioritySeats: 3,
    carCount: 10,
  },
  seoul3: { doorCount: 4, seatsPerSection: 7, prioritySeats: 3, carCount: 6 },
  seoul4: { doorCount: 4, seatsPerSection: 7, prioritySeats: 3, carCount: 6 },
  seoul5: { doorCount: 4, seatsPerSection: 7, prioritySeats: 3, carCount: 6 },
  seoul6: { doorCount: 4, seatsPerSection: 7, prioritySeats: 3, carCount: 6 },
  seoul7: { doorCount: 4, seatsPerSection: 7, prioritySeats: 3, carCount: 8 },
  seoul8: { doorCount: 4, seatsPerSection: 7, prioritySeats: 3, carCount: 6 },
  seoul9: { doorCount: 4, seatsPerSection: 7, prioritySeats: 3, carCount: 6 },
  incheon1: { doorCount: 4, seatsPerSection: 7, prioritySeats: 3, carCount: 6 },
  incheon2: { doorCount: 4, seatsPerSection: 7, prioritySeats: 3, carCount: 6 },
  defaultMetro: {
    doorCount: 4,
    seatsPerSection: 7,
    prioritySeats: 3,
    carCount: 6,
  },
};

const DEFAULT_CAR_LAYOUT = LINE_CAR_LAYOUT.defaultMetro;

function normalizeLineLabelCompact(lineLabel) {
  const primary = (lineLabel || "").split("·")[0].trim();
  return primary.replace(/\s+/g, "");
}

function resolveLineLayoutKey(lineLabel) {
  const normalized = normalizeLineLabelCompact(lineLabel);
  if (/^서울1호선$/.test(normalized)) return "seoul1";
  if (/^서울2호선$/.test(normalized)) return "seoul2";
  const seoulN = normalized.match(/^서울([3-9])호선$/);
  if (seoulN?.[1]) return `seoul${seoulN[1]}`;
  const incheonN = normalized.match(/^인천([12])호선$/);
  if (incheonN?.[1]) return `incheon${incheonN[1]}`;
  const bare = normalized.match(/^([1-9])호선$/);
  if (bare?.[1] === "1") return "seoul1";
  if (bare?.[1] === "2") return "seoul2";
  if (bare?.[1]) return "defaultMetro";
  return "defaultMetro";
}

function resolveCarLayout(lineLabel) {
  const key = resolveLineLayoutKey(lineLabel);
  return LINE_CAR_LAYOUT[key] ?? DEFAULT_CAR_LAYOUT;
}

function resolveApiLineKeyFromLineProp(lineLabel) {
  const apiLine = resolveApiLineFromLineProp(lineLabel);
  if (apiLine) return apiLine;
  const normalized = normalizeLineLabelCompact(lineLabel);
  if (/^서울1호선$/.test(normalized)) return "seoul1";
  if (/^서울2호선$/.test(normalized)) return "seoul2";
  return "seoul2";
}

const STATION_LIST_CACHE_MS = 30 * 60 * 1000;
/** @type {Map<string, { stations: unknown[], fetchedAt: number }>} */
const stationListCache = new Map();

/** 호선별 역 목록 (서버 API — 클라이언트 메모리 캐시로 중복 요청 방지) */
async function fetchStationsForLine(lineLabel) {
  const apiLine = resolveApiLineFromLineProp(lineLabel);
  if (!apiLine) return null;

  const cached = stationListCache.get(apiLine);
  if (cached && Date.now() - cached.fetchedAt < STATION_LIST_CACHE_MS) {
    return cached.stations;
  }

  try {
    const response = await fetch(
      `/api/stations?line=${encodeURIComponent(apiLine)}`,
      { cache: "default" }
    );
    const payload = await response.json();
    if (!response.ok || !payload?.success || !Array.isArray(payload.stations)) {
      return cached?.stations ?? null;
    }
    stationListCache.set(apiLine, {
      stations: payload.stations,
      fetchedAt: Date.now(),
    });
    return payload.stations;
  } catch {
    return cached?.stations ?? null;
  }
}

function stationMatchesSearch(stationName, rawQuery) {
  const searchName = normalizeStationSearchTerm(stationName);
  const searchTerm = normalizeStationSearchTerm(rawQuery);
  if (!searchTerm) return false;
  return searchName.includes(searchTerm);
}

const VOICE_PARSE_PENDING_KEY = "voiceParsePending";
/** GPS 자동 출발역 설정 최대 반경 (km) */
const GPS_MAX_RADIUS_KM = 1;
const BOARDING_GPS_CACHE_TTL_MS = 5 * 60 * 1000;
const TRAIN_LIST_REFRESH_MS = 30000;
const TRAIN_LIST_FETCH_TIMEOUT_MS = 8000;
/** @type {Map<string, { apiTrains: unknown[], stationOrder: unknown[], fetchedAt: number }>} */
const trainListPrefetchCache = new Map();

function buildTrainListCacheKey(apiLine, destination, currentStation) {
  return `${apiLine}|${(destination || "").trim()}|${(currentStation || "").trim()}`;
}

/** 목적지 선택 직후 열차 목록을 미리 받아 step 2 진입 지연을 줄입니다. */
async function prefetchTrainListForBoarding({ apiLine, destination, boardingStation }) {
  if (!apiLine || !destination?.trim() || !isSubwayOperatingHours(apiLine)) {
    return;
  }

  const cacheKey = buildTrainListCacheKey(apiLine, destination, boardingStation);
  const cached = trainListPrefetchCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < TRAIN_LIST_REFRESH_MS) {
    return;
  }

  try {
    const params = new URLSearchParams({
      line: apiLine,
      station: destination.trim(),
    });
    if (boardingStation?.trim()) {
      params.set("current_station", boardingStation.trim());
    }

    const response = await fetch(`/api/trains?${params.toString()}`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(TRAIN_LIST_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return;

    const payload = await response.json();
    trainListPrefetchCache.set(cacheKey, {
      apiTrains: Array.isArray(payload?.trains) ? payload.trains : [],
      stationOrder: Array.isArray(payload?.station_order) ? payload.station_order : [],
      fetchedAt: Date.now(),
    });
  } catch {
    // 프리페치 실패 시 step 2에서 다시 조회합니다.
  }
}
/** seek 모드 출입문 라벨(2-1 등) → API 제출용 car / seat_side / seat_number */
function mapSeekDoorToSubmission(doorLabel, lineLabel) {
  const match = String(doorLabel || "").match(/^출?(\d+)-(\d+)$/);
  if (!match) return null;

  const layout = resolveCarLayout(lineLabel);
  const car = Number.parseInt(match[1], 10);
  const door = Number.parseInt(match[2], 10);
  if (
    !Number.isInteger(car) ||
    car < 1 ||
    car > layout.carCount ||
    !Number.isInteger(door) ||
    door < 1 ||
    door > layout.doorCount
  ) {
    return null;
  }

  const sectionDoor = door <= 3 ? door : 3;
  const seatInSection =
    door >= layout.doorCount
      ? layout.seatsPerSection - 1
      : Math.floor(layout.seatsPerSection / 2);
  const seatApi = mapSeatIdToApi(
    `left-d${sectionDoor}-s${seatInSection}`,
    layout.seatsPerSection
  );
  if (!seatApi?.seatSide || !seatApi?.seatNumber) {
    return null;
  }

  return {
    car,
    door,
    doorLabel: formatExitDoorDisplayLabel(car, door),
    seatSide: seatApi.seatSide,
    seatNumber: seatApi.seatNumber,
  };
}

const SEEK_SEAT_LETTERS = ["A", "B", "C", "D", "E", "F", "G"];

function resolveSeekSideLabel(side) {
  return side === "right" || side === "우측" ? "우측" : "좌측";
}

function buildSeekPickResultLine({ station, side, car, door, seatLetter }) {
  const parts = [
    station ? `${formatStationDisplayName(station)} 방향` : null,
    resolveSeekSideLabel(side),
    car && door ? formatExitDoorDisplayLabel(car, door) : null,
    seatLetter ? `${seatLetter}열` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

function buildSeekPickFromSeatInfo(seat, station, fallbackCar) {
  const car = seat?.car ?? fallbackCar;
  const door = seat?.door;
  const seatLetter = seat?.seatLetter || seat?.seatColumn;
  const side = resolveSeekSideLabel(seat?.side);
  const doorLabel = car && door ? formatExitDoorDisplayLabel(car, door) : "";
  const pickResultLine = buildSeekPickResultLine({ station, side, car, door, seatLetter });
  return { car, door, doorLabel, side, seatLetter, pickResultLine };
}

/** seek 좌석열(A~G) → API seat_side / seat_number */
function mapSeekSelectionToSubmission({ car, door, doorLabel, side, seatLetter, lineLabel }) {
  const layout = resolveCarLayout(lineLabel);
  if (
    !Number.isInteger(car) ||
    car < 1 ||
    car > layout.carCount ||
    !Number.isInteger(door) ||
    door < 1 ||
    door > layout.doorCount
  ) {
    return null;
  }

  const seatIndex = SEEK_SEAT_LETTERS.indexOf(String(seatLetter || "").trim().toUpperCase());
  if (seatIndex < 0) return null;

  const sectionDoor = door >= 4 ? 3 : door;
  const gridSide = side === "우측" ? "right" : "left";
  const seatApi = mapSeatIdToApi(
    `${gridSide}-d${sectionDoor}-s${seatIndex}`,
    layout.seatsPerSection
  );
  if (!seatApi?.seatSide || !seatApi?.seatNumber) return null;

  return {
    car,
    door,
    doorLabel: doorLabel || formatExitDoorDisplayLabel(car, door),
    seatSide: seatApi.seatSide,
    seatNumber: seatApi.seatNumber,
  };
}

/** SubwaySeatMap 안내·중복 UI 숨김 + 이중 스크롤 제거 */
function applySeekSeatMapShellLayout(container) {
  const root = container?.firstElementChild;
  if (!root) return;

  root.style.padding = "0";
  root.style.maxWidth = "100%";
  root.style.removeProperty("min-width");

  for (const child of root.children) {
    const style = (child.getAttribute("style") || "").toLowerCase();
    const text = child.textContent || "";

    const isCarBody =
      (style.includes("border-radius: 14") || style.includes("borderradius: 14")) &&
      style.includes("2px solid");

    if (isCarBody) {
      child.style.removeProperty("display");
      child.style.maxHeight = "none";
      child.style.overflow = "visible";
      continue;
    }

    const shouldHide =
      text.includes("A(위)") ||
      text.includes("맨 위부터") ||
      text.includes("노약자석") ||
      text.includes("빈 자리") ||
      text.includes("곧 하차") ||
      text.includes("선택한 자리") ||
      text.includes("탭)") ||
      text.includes("좌측「문」") ||
      text.includes("방향 ↑") ||
      (text.includes("방면") && style.includes("background") && !style.includes("border-radius: 14"));

    if (shouldHide) {
      child.style.display = "none";
    }
  }
}

function distanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * GPS 좌표로 현재 노선 1km 이내 가장 가까운 역 탐색
 * @returns {{ stationName: string | null, reason: string }}
 */
function detectNearestStationFromGps(lineLabel) {
  if (typeof window === "undefined" || !navigator.geolocation) {
    return Promise.resolve({ stationName: null, reason: "unsupported" });
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void (async () => {
          try {
            const stations = await fetchStationsForLine(lineLabel);
            if (!stations?.length) {
              resolve({ stationName: null, reason: "no_coords" });
              return;
            }

            let nearestWithinRadius = null;
            let nearestAny = null;
            for (const station of stations) {
              if (
                !station?.name ||
                typeof station.lat !== "number" ||
                typeof station.lng !== "number"
              ) {
                continue;
              }
              const dist = distanceKm(
                position.coords.latitude,
                position.coords.longitude,
                station.lat,
                station.lng
              );
              if (!nearestAny || dist < nearestAny.dist) {
                nearestAny = { name: station.name, dist };
              }
              if (dist <= GPS_MAX_RADIUS_KM) {
                if (!nearestWithinRadius || dist < nearestWithinRadius.dist) {
                  nearestWithinRadius = { name: station.name, dist };
                }
              }
            }

            if (nearestWithinRadius?.name) {
              resolve({
                stationName: nearestWithinRadius.name,
                reason: "ok",
                distanceKm: nearestWithinRadius.dist,
              });
              return;
            }

            if (nearestAny?.name) {
              resolve({ stationName: null, reason: "out_of_range" });
              return;
            }

            resolve({ stationName: null, reason: "no_coords" });
          } catch {
            resolve({ stationName: null, reason: "weak" });
          }
        })();
      },
      () => resolve({ stationName: null, reason: "denied" }),
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 60000,
      }
    );
  });
}

function normalizeStationLabel(name) {
  return normalizeStationSearchTerm((name || "").trim().replace(/역$/u, ""));
}

function saveBoardingGpsLocation(
  lineLabel,
  stationName,
  { within1km = true, distanceKmValue = null } = {}
) {
  try {
    sessionStorage.setItem(
      "boardingDetectedLocation",
      JSON.stringify({
        lineLabel,
        nearestStationName: stationName,
        within1km,
        manual: !within1km,
        distanceKm: distanceKmValue,
        detectedAt: Date.now(),
      })
    );
  } catch {
    // 저장 실패 시 화면 상태만 유지합니다.
  }
}

/** /api/voice/parse로 음성 텍스트에서 목적지·모드 추출 */
async function parseVoiceIntentWithApi(transcript, lineLabel) {
  const token = localStorage.getItem("token");
  const apiLine = lineLabel ? resolveApiLineFromLineProp(lineLabel) : null;
  const response = await fetch("/api/voice/parse", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      transcript,
      ...(apiLine ? { line: apiLine } : {}),
    }),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw new Error("음성 해석 응답을 처리할 수 없습니다.");
  }

  if (handleUnauthorizedResponse(response)) {
    throw new Error("로그인이 필요합니다.");
  }

  if (!response.ok || payload?.success === false) {
    throw new Error(
      typeof payload?.error === "string" && payload.error.trim()
        ? payload.error
        : "음성 해석에 실패했습니다."
    );
  }

  const destination =
    typeof payload?.data?.destination === "string"
      ? payload.data.destination.trim().replace(/역$/u, "")
      : "";
  const mode = payload?.data?.mode === "leave" ? "leave" : payload?.data?.mode === "seek" ? "seek" : null;

  return {
    destination: destination || null,
    mode,
  };
}

/** 음성 문장에서 노선 역 목록 기준 목적지(마지막 매칭 역) 추출 */
function findDestinationInTranscript(transcript, stationRows) {
  const normalizedText = (transcript || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/역/gu, "");
  if (!normalizedText || !Array.isArray(stationRows)) {
    return null;
  }

  const matches = [];
  for (const row of stationRows) {
    const name = row?.name?.trim();
    if (!name) continue;
    const normalizedStation = name.replace(/\s+/g, "").replace(/역$/u, "");
    if (normalizedStation.length < 2) continue;
    const index = normalizedText.indexOf(normalizedStation);
    if (index >= 0) {
      matches.push({ name, index });
    }
  }

  if (matches.length === 0) return null;
  matches.sort((a, b) => a.index - b.index);
  return matches[matches.length - 1].name;
}

/** 음성 문장에서 모드 추출 — seek/leave 공통 */
function extractModeFromVoiceTranscript(transcript) {
  const text = (transcript || "").trim();
  if (/내려|내릴/u.test(text)) {
    return "leave";
  }
  if (/앉고|안고|싶어/u.test(text)) {
    return "seek";
  }
  return null;
}

const VOICE_CONVERSATIONAL_LETTERS = ["A", "B", "C", "D", "E", "F"];

const VOICE_SENTENCE_GUIDE_TITLE = "플랫폼에서 한 번에 말해 주세요";

const VOICE_SENTENCE_GUIDE_SUB = "목적지 · 출입문(1-1~1-4) · 방향 · 열(선택)";

const VOICE_SENTENCE_RETRY_TEXT =
  "인식에 실패했습니다.\n목적지 · 출입문 · 방향을 다시 말씀해 주세요.";

/** 한 문장 음성 — 노선 역 목록 우선 + API 폴백으로 필드 파싱 */
async function parseVoiceSentenceWithApi(transcript, lineLabel) {
  const stations = await fetchStationsForLine(lineLabel);
  let destination = findDestinationInTranscript(transcript, stations);
  if (destination) {
    destination = destination.replace(/역$/u, "");
  }

  let mode = extractModeFromVoiceTranscript(transcript);

  if (!destination) {
    try {
      const apiParsed = await parseVoiceIntentWithApi(transcript, lineLabel);
      destination = apiParsed.destination;
      mode = mode ?? apiParsed.mode;
    } catch {
      // API 실패 시 로컬 출입문·방향만으로 재시도합니다.
    }
  }

  const door = extractDoorFromTranscript(transcript, lineLabel);
  const side = extractDirectionFromTranscript(transcript);
  const seatLetter = extractSeatLetterFromTranscript(transcript);

  return {
    destination,
    mode,
    door,
    side,
    seatLetter,
  };
}

/** 음성 인식 한글 숫자 → 1~9 */
function parseSpokenDigitToken(token) {
  const trimmed = String(token || "").trim();
  if (!trimmed) return null;
  if (/^\d+$/u.test(trimmed)) {
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isInteger(parsed) ? parsed : null;
  }
  const koreanDigitMap = {
    일: 1,
    한: 1,
    이: 2,
    삼: 3,
    사: 4,
    오: 5,
    육: 6,
    칠: 7,
    팔: 8,
    구: 9,
  };
  return koreanDigitMap[trimmed] ?? null;
}

/** 호차·출입문 번호가 레이아웃 범위 안이면 door 객체 반환 */
function buildDoorFromCarAndDoor(car, door, lineLabel) {
  const layout = resolveCarLayout(lineLabel);
  if (
    !Number.isInteger(car) ||
    car < 1 ||
    car > layout.carCount ||
    !Number.isInteger(door) ||
    door < 1 ||
    door > layout.doorCount
  ) {
    return null;
  }
  return {
    car,
    door,
    doorLabel: formatExitDoorDisplayLabel(car, door),
  };
}

/** 음성 문장에서 출입문(호차-문) 추출 */
function extractDoorFromTranscript(transcript, lineLabel) {
  const raw = (transcript || "").trim();
  const compact = raw.replace(/\s+/g, "");
  if (!compact) return null;

  const patterns = [
    /출?(\d+)[-호~](\d+)/u,
    /(\d+)호차\s*(\d+)번?/u,
    /(\d+)호차(\d+)/u,
    /(\d+)칸\s*(\d+)번?/u,
    /출(\d)(\d)(?:번)?/u,
    /(\d)(\d)번?출입문/u,
  ];

  for (const pattern of patterns) {
    const match = compact.match(pattern);
    if (!match) continue;
    const built = buildDoorFromCarAndDoor(
      Number.parseInt(match[1], 10),
      Number.parseInt(match[2], 10),
      lineLabel
    );
    if (built) return built;
  }

  const spacedDash = raw.match(/(\d+)\s*[-~·]\s*(\d+)/u);
  if (spacedDash) {
    const built = buildDoorFromCarAndDoor(
      Number.parseInt(spacedDash[1], 10),
      Number.parseInt(spacedDash[2], 10),
      lineLabel
    );
    if (built) return built;
  }

  const koreanCarDoor = raw.match(
    /([일이삼사오육칠팔구한\d]+)\s*호차\s*([일이삼사오육칠팔구\d]+)\s*번?/u
  );
  if (koreanCarDoor) {
    const built = buildDoorFromCarAndDoor(
      parseSpokenDigitToken(koreanCarDoor[1]),
      parseSpokenDigitToken(koreanCarDoor[2]),
      lineLabel
    );
    if (built) return built;
  }

  const koreanDash = raw.match(
    /([일이삼사오육칠팔구한\d]+)\s*[-~]\s*([일이삼사오육칠팔구\d]+)/u
  );
  if (koreanDash) {
    const built = buildDoorFromCarAndDoor(
      parseSpokenDigitToken(koreanDash[1]),
      parseSpokenDigitToken(koreanDash[2]),
      lineLabel
    );
    if (built) return built;
  }

  return null;
}

/** 음성 문장에서 좌측/우측 추출 */
function extractDirectionFromTranscript(transcript) {
  const text = (transcript || "").trim();
  if (/우측|유측|오른쪽|오른편|오른/u.test(text)) {
    return "우측";
  }
  if (/좌측|왼쪽|왼편|왼/u.test(text)) {
    return "좌측";
  }
  return null;
}

/** 음성 문장에서 좌석 열(A~F) 추출 — 한글 발음·영문 단일 문자 모두 지원 */
function extractSeatLetterFromTranscript(transcript) {
  const raw = (transcript || "").trim();
  if (!raw) return null;

  const compactUpper = raw.replace(/\s+/g, "").toUpperCase();
  if (/^[A-F]$/.test(compactUpper)) {
    return compactUpper;
  }

  const compactLower = raw.replace(/\s+/g, "").toLowerCase();
  const koreanLetterMap = [
    ["에프", "F"],
    ["에이", "A"],
    ["비", "B"],
    ["씨", "C"],
    ["시", "C"],
    ["디", "D"],
    ["이", "E"],
  ];
  for (const [spoken, letter] of koreanLetterMap) {
    if (compactLower.includes(spoken)) {
      return letter;
    }
  }

  const upper = raw.toUpperCase();
  const letterMatch = upper.match(/(?:^|[^A-Z])([A-F])(?:열)?(?:[^A-Z]|$)/);
  if (letterMatch?.[1] && VOICE_CONVERSATIONAL_LETTERS.includes(letterMatch[1])) {
    return letterMatch[1];
  }

  const isolated = upper.match(/\b([A-F])\b/);
  if (isolated?.[1]) {
    return isolated[1];
  }

  return null;
}

/** 파싱된 목적지 문자열을 현재 노선 역 목록에서 매칭 */
async function resolveStationNameFromDestination(destination, lineLabel) {
  const term = normalizeStationSearchTerm(destination);
  if (!term) return null;

  const stations = await fetchStationsForLine(lineLabel);
  if (!stations?.length) return null;

  const exact = stations.find(
    (row) => normalizeStationSearchTerm(row?.name) === term
  );
  if (exact?.name) return exact.name.trim();

  const partialMatches = stations
    .map((row) => row?.name?.trim())
    .filter((name) => name && stationMatchesSearch(name, destination))
    .sort((a, b) => a.length - b.length);

  return partialMatches[0] ?? null;
}

/** 역명으로 station_code·순서 조회 */
async function lookupStationMeta(stationName, lineLabel) {
  const searchName = normalizeStationSearchTerm(stationName);
  if (!searchName) return null;

  const stations = await fetchStationsForLine(lineLabel);
  if (!stations?.length) return null;

  const prefix = resolveStationCodePrefixFromLineProp(lineLabel);
  const exactIndex = stations.findIndex(
    (row) => normalizeStationSearchTerm(row?.name) === searchName
  );
  const partialIndex =
    exactIndex >= 0
      ? exactIndex
      : stations.findIndex((row) => stationMatchesSearch(row?.name, stationName));

  if (partialIndex < 0) return null;

  const row = stations[partialIndex];
  const order = row.order ?? partialIndex + 1;
  const stationCode = `${prefix}-${String(order).padStart(2, "0")}`;

  return {
    stationCode,
    stationName: row.name,
    stationOrder: order,
    stationIndex: partialIndex,
  };
}

function normalizeDirectionKeyForStops(direction) {
  const value = (direction || "").trim();
  if (value === "상행" || value === "내선" || value === "1") return "up";
  if (value === "하행" || value === "외선" || value === "2" || value === "0") return "down";
  return null;
}

function resolveStationIndexByOrder(stations, stationMeta) {
  if (!Array.isArray(stations) || stations.length === 0 || !stationMeta) {
    return -1;
  }

  const order = stationMeta.stationOrder;
  if (Number.isFinite(order)) {
    const byOrder = stations.findIndex((row) => row.order === order);
    if (byOrder >= 0) {
      return byOrder;
    }
  }

  if (Number.isFinite(stationMeta.stationIndex) && stationMeta.stationIndex >= 0) {
    const row = stations[stationMeta.stationIndex];
    if (
      row &&
      normalizeStationSearchTerm(row.name) ===
        normalizeStationSearchTerm(stationMeta.stationName)
    ) {
      return stationMeta.stationIndex;
    }
  }

  const searchName = normalizeStationSearchTerm(stationMeta.stationName);
  if (!searchName) return -1;
  return stations.findIndex(
    (row) => normalizeStationSearchTerm(row?.name) === searchName
  );
}

/** 서울 1~9호선 · 인천 1~2호선 — 동일 노선 역순 기준 남은 역 수 */
function resolveRemainingStops(
  stations,
  boardingMeta,
  destinationMeta,
  lineLabel,
  direction
) {
  const boardingIndex = resolveStationIndexByOrder(stations, boardingMeta);
  const destinationIndex = resolveStationIndexByOrder(stations, destinationMeta);
  const count = Array.isArray(stations) ? stations.length : 0;

  if (
    count === 0 ||
    boardingIndex < 0 ||
    destinationIndex < 0 ||
    boardingIndex === destinationIndex
  ) {
    return 3;
  }

  const layoutKey = resolveLineLayoutKey(lineLabel);

  // 2호선: 순환 — 열차 방향 기준 (환승·타 호선 제외, 동일 노선 역 목록만 사용)
  if (layoutKey === "seoul2") {
    const dirKey = normalizeDirectionKeyForStops(direction);
    const distForward = (destinationIndex - boardingIndex + count) % count;
    const distBackward = (boardingIndex - destinationIndex + count) % count;

    if (dirKey === "down") {
      return Math.max(3, distForward === 0 ? count : distForward);
    }
    if (dirKey === "up") {
      return Math.max(3, distBackward === 0 ? count : distBackward);
    }
    return Math.max(
      3,
      Math.min(distForward === 0 ? count : distForward, distBackward === 0 ? count : distBackward)
    );
  }

  // 서울 1·3~9호선, 인천 1~2호선: station_order(역 목록 순서) 차이
  const orderDelta =
    (destinationMeta?.stationOrder ?? destinationIndex + 1) -
    (boardingMeta?.stationOrder ?? boardingIndex + 1);
  const indexDelta = destinationIndex - boardingIndex;
  const dirKey = normalizeDirectionKeyForStops(direction);

  if (dirKey === "down") {
    if (indexDelta > 0) return Math.max(3, indexDelta);
    if (indexDelta < 0) return Math.max(3, Math.abs(indexDelta));
  }
  if (dirKey === "up") {
    if (indexDelta < 0) return Math.max(3, Math.abs(indexDelta));
    if (indexDelta > 0) return Math.max(3, indexDelta);
  }

  if (orderDelta !== 0) {
    return Math.max(3, Math.abs(orderDelta));
  }
  return Math.max(3, Math.abs(indexDelta));
}

/** 열차 방면 표시(예: 역삼 방면) → 빠른하차 drtnInfo */
function resolveDrtnInfoFromDirectionDisplay(directionDisplay) {
  const value = (directionDisplay || "").trim();
  const match = value.match(/^(.+?)\s*방면$/);
  if (!match?.[1]) return "";
  return match[1].trim().replace(/역$/, "");
}

function normalizeLineLabel(lineLabel) {
  const value = typeof lineLabel === "string" ? lineLabel.trim() : "";
  if (value && !value.includes("??") && value.includes("호선")) {
    return value;
  }

  if (typeof window !== "undefined") {
    const fromQuery = new URLSearchParams(window.location.search).get("lineLabel");
    const queryValue = fromQuery?.trim() || "";
    if (queryValue && !queryValue.includes("??") && queryValue.includes("호선")) {
      return queryValue;
    }
  }

  return "서울 1호선";
}

// ─── 색상 ────────────────────────────────────────────────────────
const LINE_OLIVE = "#747F00";
const LINE_OLIVE_LIGHT = "rgba(116, 127, 0, 0.14)";
const LINE_OLIVE_LIGHT_BG = "#EEF0E0";

const C = {
  primary: LINE_OLIVE,
  primaryLight: LINE_OLIVE_LIGHT_BG,
  primaryBorder: "#B8BF7A",
  bg: "#F7F8FA",
  card: "#FFFFFF",
  border: "#E2E8F0",
  text: "#1A1A1A",
  muted: "#888",
  priority: { bg: "#FFF3E0", border: "#FFB74D", text: "#E65100" },
  occupied: { bg: "#EBEBEB", border: "#D0D0D0", text: "#888" },
};

/** 모바일 터치·타이포 기준 (iOS 자동 줌 방지) */
const MOBILE = {
  pageX: 16,
  inputFontSize: 16,
  touchMin: 44,
};

/** 검색어 정규화 — "강남역" → "강남" (역명 목록 기준) */
function normalizeStationSearchTerm(value) {
  return (value || "").trim().replace(/\s+/g, "").replace(/역$/u, "");
}

/** 검색어와 역명이 완전히 일치하는 경우만 반환 */
function findExactStationName(rawQuery, stationRows) {
  const term = normalizeStationSearchTerm(rawQuery);
  if (!term || !Array.isArray(stationRows)) return null;

  const matches = stationRows
    .map((row) => row?.name?.trim())
    .filter(Boolean)
    .filter((name) => normalizeStationSearchTerm(name) === term);

  return matches.length === 1 ? matches[0] : null;
}

function formatStationDisplayName(stationName) {
  const name = (stationName || "").trim();
  if (!name) return "";
  return name.endsWith("역") ? name : `${name}역`;
}

/** 헤더 원형 배지 라벨 — 서울 N호선 → N호선 */
function resolveLineBadgeLabel(lineLabel) {
  const primary = (lineLabel || "").split("·")[0].trim();
  const compact = primary.replace(/\s+/g, "");
  const seoulLineNo = compact.match(/^서울([1-9])호선$/);
  if (seoulLineNo?.[1]) return `${seoulLineNo[1]}호선`;
  const incheonMatch = compact.match(/^인천([12])호선$/);
  if (incheonMatch?.[1]) return `인천${incheonMatch[1]}`;
  return "7호선";
}

function formatDestinationDirectionTitle(station, direction) {
  const name = (station || "").trim();
  if (name) {
    const display = formatStationDisplayName(name);
    return display.endsWith("방면") ? display : `${display} 방면`;
  }
  const dir = (direction || "").trim();
  if (dir) {
    return dir.endsWith("방면") ? dir : `${dir} 방면`;
  }
  return "목적지 방면";
}

function CarNumberSlider({
  carNumbers,
  activeCar,
  onSelect,
  disabled = false,
  lineColor = LINE_OLIVE,
}) {
  const scrollRef = useRef(null);
  const buttonRefs = useRef({});

  useEffect(() => {
    const el = buttonRefs.current[activeCar];
    if (!el || !scrollRef.current) return;
    el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [activeCar]);

  return (
    <div
      ref={scrollRef}
      className="zeb-no-scrollbar"
      style={{
        display: "flex",
        gap: 8,
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        paddingBottom: 4,
        scrollbarWidth: "none",
        msOverflowStyle: "none",
      }}
    >
      {carNumbers.map((carNum) => {
        const isActive = activeCar === carNum;
        return (
          <button
            key={carNum}
            ref={(node) => {
              buttonRefs.current[carNum] = node;
            }}
            type="button"
            className="zeb-touch-target"
            disabled={disabled}
            onClick={() => onSelect(carNum)}
            aria-label={`${carNum}호차`}
            aria-pressed={isActive}
            style={{
              flexShrink: 0,
              minWidth: 72,
              minHeight: 44,
              padding: "0 14px",
              borderRadius: 999,
              border: `1.5px solid ${isActive ? lineColor : C.border}`,
              background: isActive ? lineColor : C.card,
              color: isActive ? "#fff" : C.text,
              fontSize: 14,
              fontWeight: 700,
              cursor: disabled ? "default" : "pointer",
              opacity: disabled ? 0.55 : 1,
            }}
          >
            {carNum}호차
          </button>
        );
      })}
    </div>
  );
}

function LineCircleBadge({ line, size = 36 }) {
  const label = resolveLineBadgeLabel(line);
  const fontSize = label.length <= 3 ? 11 : 10;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "50%",
        fontSize,
        fontWeight: 700,
        color: "#fff",
        background: LINE_OLIVE,
        flexShrink: 0,
        lineHeight: 1.1,
        textAlign: "center",
      }}
    >
      {label}
    </span>
  );
}

// ─── 공통 컴포넌트 ────────────────────────────────────────────────
function Header({ step, onBack, title, line }) {
  return (
    <div className="zeb-app-header">
      <button
        type="button"
        className="zeb-touch-target"
        onClick={onBack}
        style={{
        background: "none", border: "none", cursor: "pointer",
        padding: 0, color: C.text, fontSize: 20, lineHeight: 1,
        display: "flex", alignItems: "center", justifyContent: "center",
        width: MOBILE.touchMin, height: MOBILE.touchMin,
      }}>
        ←
      </button>
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
        <LineCircleBadge line={line} />
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{title}</div>
      </div>
      <div style={{
        fontSize: 11, color: C.primary, fontWeight: 600,
        background: C.primaryLight, borderRadius: 20, padding: "3px 10px",
      }}>
        {step} / 3
      </div>
    </div>
  );
}

function LoadingSpinner({ size = 18, color = "#fff" }) {
  return (
    <span
      aria-hidden
      className="zeb-loading-spinner"
      style={{
        width: size,
        height: size,
        border: `2px solid rgba(255,255,255,0.35)`,
        borderTopColor: color,
        borderRadius: "50%",
        flexShrink: 0,
        display: "inline-block",
      }}
    />
  );
}

function StepFade({ stepKey, children }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(false);
    const frame = requestAnimationFrame(() => {
      setVisible(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [stepKey]);

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        opacity: visible ? 1 : 0,
        transition: "opacity 0.3s ease",
      }}
    >
      {children}
    </div>
  );
}

function SubmitSkeletonOverlay() {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 5,
        background: "rgba(247, 248, 250, 0.88)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: "20px 16px",
        pointerEvents: "none",
      }}
    >
      {[72, 48, 120].map((height, index) => (
        <div
          key={height}
          className="zeb-loading-skeleton"
          style={{
            height,
            borderRadius: 10,
            animationDelay: `${index * 0.12}s`,
          }}
        />
      ))}
    </div>
  );
}

// ─── Step 1: 목적지 선택 (출발역은 GPS 자동) ─────────────────────
function StepStation({
  line,
  mode,
  boardingStationName,
  isDetectingBoardingStation,
  needsManualBoardingStation,
  boardingGpsMessage,
  onBoardingStationChange,
  onBoardingStationClear,
  onNext,
  onBack,
  onParsedModeChange,
  onVoiceSeekRegister,
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [boardingQuery, setBoardingQuery] = useState("");
  const [boardingResults, setBoardingResults] = useState([]);
  const [boardingSearchError, setBoardingSearchError] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [isVoiceExpanded, setIsVoiceExpanded] = useState(false);
  const [voiceSentenceActive, setVoiceSentenceActive] = useState(false);
  const [voiceParseResult, setVoiceParseResult] = useState(null);
  const [voiceTrains, setVoiceTrains] = useState([]);
  const [voiceSelectedTrain, setVoiceSelectedTrain] = useState(null);
  const [voiceTrainsLoading, setVoiceTrainsLoading] = useState(false);
  const [voiceTrainsError, setVoiceTrainsError] = useState("");
  const guideSeenStorageKey =
    mode === "leave" ? "boardingLeaveGuideSeen" : "boardingGuideSeen";
  const [isGuideExpanded, setIsGuideExpanded] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return !sessionStorage.getItem(guideSeenStorageKey);
    } catch {
      return true;
    }
  });
  const [isListening, setIsListening] = useState(false);
  const [isParsingVoice, setIsParsingVoice] = useState(false);
  const [stationRows, setStationRows] = useState([]);
  const [isStationListLoading, setIsStationListLoading] = useState(true);
  const [stationListLoadError, setStationListLoadError] = useState("");
  const [isDestinationComposing, setIsDestinationComposing] = useState(false);
  const inputRef = useRef(null);
  const boardingInputRef = useRef(null);
  const destinationResultsRef = useRef(null);
  const recognitionRef = useRef(null);
  const apiLine = resolveApiLineFromLineProp(line);
  useEffect(() => {
    if (!selected || !apiLine) return;
    void prefetchTrainListForBoarding({
      apiLine,
      destination: selected,
      boardingStation: boardingStationName,
    });
  }, [selected, apiLine, boardingStationName]);

  useEffect(() => {
    if (needsManualBoardingStation) {
      boardingInputRef.current?.focus();
      return;
    }
    inputRef.current?.focus();
  }, [needsManualBoardingStation]);

  async function applyParsedVoice({ destination, parsedMode }) {
    if (parsedMode && parsedMode !== mode) {
      try {
        if (destination) {
          sessionStorage.setItem(
            VOICE_PARSE_PENDING_KEY,
            JSON.stringify({ destination })
          );
        }
      } catch {
        // sessionStorage 실패 시 모드만 변경합니다.
      }
      onParsedModeChange?.(parsedMode);
      return;
    }

    if (!destination) {
      setVoiceError("어디까지 가세요?를 찾지 못했습니다. 역 이름을 다시 말씀해 주세요.");
      return;
    }

    const stationName = await resolveStationNameFromDestination(destination, line);
    if (!stationName) {
      setQuery(destination);
      setSelected(null);
      setVoiceError(`"${destination}" 역을 이 노선에서 찾지 못했습니다.`);
      return;
    }

    setQuery(stationName);
    setSelected(stationName);
    setVoiceError("");
    onNext(stationName);
  }

  async function resolveVoiceParse(transcript) {
    const localMode = extractModeFromVoiceTranscript(transcript);
    const stations = await fetchStationsForLine(line);
    const localDestination = findDestinationInTranscript(transcript, stations);
    let destination = localDestination
      ? localDestination.replace(/역$/u, "")
      : null;
    let apiMode = null;

    if (!destination) {
      try {
        const parsed = await parseVoiceIntentWithApi(transcript, line);
        destination = parsed.destination;
        apiMode = parsed.mode;
      } catch {
        // API 실패 시 로컬 목적지·모드만 사용합니다.
      }
    }

    return {
      destination,
      mode: localMode ?? apiMode ?? null,
    };
  }

  async function processVoiceTranscript(transcript) {
    setIsParsingVoice(true);
    setVoiceError("");
    try {
      const parsed = await resolveVoiceParse(transcript);
      await applyParsedVoice({
        destination: parsed.destination,
        parsedMode: parsed.mode,
      });
    } catch (err) {
      const message =
        err instanceof Error && err.message ? err.message : "음성 처리 중 오류가 발생했습니다.";
      setVoiceError(message);
      setSelected(null);
    } finally {
      setIsParsingVoice(false);
    }
  }

  useEffect(() => {
    let active = true;

    const runPendingVoice = async () => {
      try {
        const raw = sessionStorage.getItem(VOICE_PARSE_PENDING_KEY);
        if (!raw) return;
        sessionStorage.removeItem(VOICE_PARSE_PENDING_KEY);
        const pending = JSON.parse(raw);
        const destination =
          typeof pending?.destination === "string" ? pending.destination.trim() : "";
        if (!destination || !active) return;

        const stationName = await resolveStationNameFromDestination(destination, line);
        if (!active) return;

        if (stationName) {
          setQuery(stationName);
          setSelected(stationName);
          setVoiceError("");
          onNext(stationName);
          return;
        }

        setQuery(destination);
        setVoiceError(`"${destination}" 역을 이 노선에서 찾지 못했습니다.`);
      } catch {
        if (!active) return;
        setVoiceError("음성으로 받은 어디까지 가세요?를 처리하지 못했습니다.");
      }
    };

    void runPendingVoice();
    return () => {
      active = false;
    };
  }, [line, onNext]);

  function stopVoiceRecognition() {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.abort();
      } catch {
        // abort 실패 시 무시합니다.
      }
      recognitionRef.current = null;
    }
    setIsListening(false);
  }

  function resetVoiceTrainSelection() {
    setVoiceTrains([]);
    setVoiceSelectedTrain(null);
    setVoiceTrainsLoading(false);
    setVoiceTrainsError("");
  }

  function closeVoicePanel() {
    if (typeof window !== "undefined") {
      window.speechSynthesis?.cancel();
    }
    stopVoiceRecognition();
    setVoiceSentenceActive(false);
    setVoiceParseResult(null);
    resetVoiceTrainSelection();
    setIsVoiceExpanded(false);
    setIsParsingVoice(false);
  }

  function startVoiceListening(onTranscript) {
    if (typeof window === "undefined" || isParsingVoice) {
      return;
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceError("이 브라우저는 음성 입력을 지원하지 않습니다.");
      return;
    }

    stopVoiceRecognition();
    try {
      const recognition = new SpeechRecognition();
      recognition.lang = "ko-KR";
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.maxAlternatives = 1;
      recognitionRef.current = recognition;
      setIsListening(true);
      setVoiceError("");

      recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          if (!result.isFinal) {
            continue;
          }
          const transcript = result[0]?.transcript?.trim();
          if (!transcript) {
            continue;
          }
          stopVoiceRecognition();
          onTranscript(transcript);
          return;
        }
      };
      recognition.onerror = () => {
        setVoiceError("음성을 인식하지 못했습니다. 다시 시도해 주세요.");
        setIsListening(false);
      };
      recognition.onend = () => {
        setIsListening(false);
        recognitionRef.current = null;
      };
      recognition.start();
    } catch {
      setIsListening(false);
      setVoiceError("음성 입력을 시작할 수 없습니다.");
    }
  }

  async function processVoiceSentenceTranscript(transcript) {
    setIsParsingVoice(true);
    setVoiceError("");
    setVoiceParseResult(null);
    resetVoiceTrainSelection();
    stopVoiceRecognition();
    try {
      let parsed;
      try {
        parsed = await parseVoiceSentenceWithApi(transcript, line);
      } catch (err) {
        if (err instanceof Error && err.message === "로그인이 필요합니다.") {
          setVoiceError(err.message);
          return;
        }
        setVoiceError(VOICE_SENTENCE_RETRY_TEXT);
        return;
      }

      if (parsed.mode && parsed.mode !== mode) {
        try {
          if (parsed.destination) {
            sessionStorage.setItem(
              VOICE_PARSE_PENDING_KEY,
              JSON.stringify({ destination: parsed.destination })
            );
          }
        } catch {
          // sessionStorage 실패 시 모드만 변경합니다.
        }
        onParsedModeChange?.(parsed.mode);
        closeVoicePanel();
        return;
      }

      const { destination, door, side, seatLetter } = parsed;
      if (!destination || !door?.doorLabel || !side) {
        const missing = [];
        if (!destination) missing.push("목적지");
        if (!door?.doorLabel) missing.push("출입문(예: 1-1)");
        if (!side) missing.push("방향(좌측/우측)");
        setVoiceError(
          missing.length > 0
            ? `인식에 실패했습니다.\n${missing.join(" · ")}을 다시 말씀해 주세요.`
            : VOICE_SENTENCE_RETRY_TEXT
        );
        return;
      }

      const stationName = await resolveStationNameFromDestination(destination, line);
      if (!stationName) {
        setVoiceError(VOICE_SENTENCE_RETRY_TEXT);
        return;
      }

      setVoiceParseResult({
        stationName,
        car: door.car,
        door: door.door,
        doorLabel: door.doorLabel,
        side,
        seatLetter: seatLetter || null,
      });
      setQuery(stationName);
      setSelected(stationName);
      setVoiceError("");
    } catch {
      setVoiceError(VOICE_SENTENCE_RETRY_TEXT);
    } finally {
      setIsParsingVoice(false);
    }
  }

  function beginVoiceSentenceListening() {
    startVoiceListening((nextTranscript) => {
      void processVoiceSentenceTranscript(nextTranscript);
    });
  }

  function retryVoiceSentence() {
    setVoiceError("");
    setVoiceParseResult(null);
    resetVoiceTrainSelection();
    beginVoiceSentenceListening();
  }

  useEffect(() => {
    if (!voiceParseResult?.stationName || !boardingStationName?.trim()) {
      resetVoiceTrainSelection();
      return undefined;
    }

    let active = true;

    async function loadVoiceTrains() {
      setVoiceTrainsLoading(true);
      setVoiceTrainsError("");
      try {
        const trains = await fetchTrainsForVoicePanel({
          lineLabel: line,
          destination: voiceParseResult.stationName,
          boardingStation: boardingStationName,
        });
        if (!active) {
          return;
        }
        setVoiceTrains(trains);
        setVoiceSelectedTrain(null);
        if (trains.length === 0) {
          setVoiceTrainsError("현재 열차를 찾지 못했습니다. 잠시 후 다시 시도해 주세요.");
        }
      } catch {
        if (!active) {
          return;
        }
        setVoiceTrains([]);
        setVoiceSelectedTrain(null);
        setVoiceTrainsError("열차 정보를 불러오지 못했습니다.");
      } finally {
        if (active) {
          setVoiceTrainsLoading(false);
        }
      }
    }

    void loadVoiceTrains();
    return () => {
      active = false;
    };
  }, [boardingStationName, line, voiceParseResult?.stationName]);

  async function handleVoiceSentenceConfirm() {
    if (!voiceParseResult) {
      return;
    }

    const { stationName, car, door, doorLabel, side, seatLetter } = voiceParseResult;
    if (!stationName || !doorLabel || !side || !Number.isInteger(car) || !Number.isInteger(door)) {
      setVoiceError(VOICE_SENTENCE_RETRY_TEXT);
      return;
    }

    const mapped = seatLetter
      ? mapSeekSelectionToSubmission({
          car,
          door,
          doorLabel,
          side,
          seatLetter,
          lineLabel: line,
        })
      : mapSeekDoorToSubmission(doorLabel, line);

    if (!mapped?.seatSide || !mapped?.seatNumber) {
      setVoiceError("위치 정보를 변환할 수 없습니다. 다시 시도해 주세요.");
      return;
    }

    if (!boardingStationName?.trim()) {
      setVoiceError(
        "출발역을 먼저 선택해 주세요.\n직접 입력으로 전환해 출발지를 설정할 수 있습니다."
      );
      return;
    }

    if (!voiceSelectedTrain?.id) {
      setVoiceError("탑승할 열차를 선택해 주세요.");
      return;
    }

    if (onVoiceSeekRegister) {
      setIsParsingVoice(true);
      try {
        const outcome = await onVoiceSeekRegister({
          stationName,
          car,
          door,
          doorLabel,
          side,
          seatLetter,
          mapped,
          selectedTrain: voiceSelectedTrain,
        });
        setQuery(stationName);
        setSelected(stationName);
        if (outcome === "need_train") {
          closeVoicePanel();
          return;
        }
        if (outcome === "matched" || outcome === "waiting") {
          return;
        }
        closeVoicePanel();
      } catch (err) {
        const message =
          err instanceof Error && err.message ? err.message : "등록에 실패했습니다.";
        setVoiceError(message);
      } finally {
        setIsParsingVoice(false);
      }
      return;
    }

    setQuery(stationName);
    setSelected(stationName);
    closeVoicePanel();
    onNext(stationName);
  }

  function startVoiceSentenceFlow() {
    setVoiceError("");
    setVoiceParseResult(null);
    resetVoiceTrainSelection();
    if (mode !== "seek") {
      setIsVoiceExpanded(true);
      startVoiceSearchLeave();
      return;
    }
    setVoiceSentenceActive(true);
    setIsVoiceExpanded(true);
    beginVoiceSentenceListening();
  }

  function startVoiceSearchLeave() {
    setVoiceError("");
    if (typeof window === "undefined") return;
    if (isParsingVoice) return;

    startVoiceListening((transcript) => {
      void processVoiceTranscript(transcript);
    });
  }

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined") {
        window.speechSynthesis?.cancel();
      }
      stopVoiceRecognition();
    };
  }, []);

  useEffect(() => {
    let active = true;
    setIsStationListLoading(true);
    setStationListLoadError("");
    setStationRows([]);

    if (!apiLine) {
      setIsStationListLoading(false);
      setStationListLoadError("이 노선은 역 검색을 지원하지 않습니다.");
      return () => {
        active = false;
      };
    }

    void fetchStationsForLine(line).then((stations) => {
      if (!active) return;
      if (!stations?.length) {
        setStationRows([]);
        setStationListLoadError("역 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      } else {
        setStationRows(stations);
        setStationListLoadError("");
      }
      setIsStationListLoading(false);
    });

    return () => {
      active = false;
    };
  }, [line, apiLine]);

  const destinationSearchResults = useMemo(() => {
    if (selected) return [];
    const trimmed = query.trim();
    const searchTerm = normalizeStationSearchTerm(trimmed);
    if (searchTerm.length < 1) return [];
    if (!apiLine || isStationListLoading || stationListLoadError) return [];

    return stationRows
      .map((row) => row?.name?.trim())
      .filter((name) => name && stationMatchesSearch(name, trimmed))
      .slice(0, 5);
  }, [query, selected, apiLine, isStationListLoading, stationListLoadError, stationRows]);

  const destinationSearchError = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed || selected) return "";
    if (!apiLine) return stationListLoadError || "이 노선은 역 검색을 지원하지 않습니다.";
    if (stationListLoadError) return stationListLoadError;
    return "";
  }, [query, selected, apiLine, stationListLoadError]);

  useEffect(() => {
    if (destinationSearchResults.length > 0) {
      destinationResultsRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [destinationSearchResults]);

  useEffect(() => {
    if (!needsManualBoardingStation) {
      setBoardingQuery("");
      setBoardingResults([]);
      setBoardingSearchError("");
      return;
    }

    const trimmed = boardingQuery.trim();
    const searchTerm = normalizeStationSearchTerm(trimmed);
    if (searchTerm.length < 1) {
      setBoardingResults([]);
      setBoardingSearchError("");
      return;
    }

    if (!apiLine) {
      setBoardingResults([]);
      setBoardingSearchError(stationListLoadError || "이 노선은 역 검색을 지원하지 않습니다.");
      return;
    }

    if (isStationListLoading) {
      setBoardingResults([]);
      setBoardingSearchError("");
      return;
    }

    if (stationListLoadError) {
      setBoardingResults([]);
      setBoardingSearchError(stationListLoadError);
      return;
    }

    const names = stationRows
      .map((row) => row?.name?.trim())
      .filter((name) => name && stationMatchesSearch(name, trimmed))
      .slice(0, 5);

    setBoardingResults(names);
    const exactBoarding = findExactStationName(trimmed, stationRows);
    if (exactBoarding) {
      onBoardingStationChange?.(exactBoarding);
      setBoardingQuery(exactBoarding);
      setBoardingSearchError("");
    } else if (names.length === 0) {
      setBoardingSearchError(
        `'${trimmed}' 역을 이 노선에서 찾지 못했습니다. 목록에서 선택해 주세요.`
      );
    } else {
      setBoardingSearchError("");
    }
  }, [
    boardingQuery,
    apiLine,
    needsManualBoardingStation,
    stationRows,
    isStationListLoading,
    stationListLoadError,
    onBoardingStationChange,
  ]);

  const canProceedToTrainStep =
    Boolean(selected) && Boolean(boardingStationName) && !isDetectingBoardingStation;

  const proceedHint = (() => {
    if (canProceedToTrainStep) return "";
    if (isDetectingBoardingStation) return "위치를 확인하는 중입니다…";
    if (!boardingStationName) return "출발역을 선택해 주세요";
    if (!selected) return "목적지를 선택해 주세요";
    return "";
  })();

  function confirmBoardingFromKeyboard() {
    if (boardingResults.length >= 1) {
      const station = boardingResults[0];
      onBoardingStationChange?.(station);
      setBoardingQuery(station);
      setBoardingSearchError("");
    }
  }

  function confirmDestinationFromKeyboard() {
    if (destinationSearchResults.length >= 1) {
      setSelected(destinationSearchResults[0]);
      setQuery(destinationSearchResults[0]);
    }
  }

  function clearDestinationSelection() {
    setSelected(null);
    setQuery("");
    inputRef.current?.focus();
  }

  function clearBoardingSelection() {
    setBoardingQuery("");
    setBoardingResults([]);
    setBoardingSearchError("");
    onBoardingStationClear?.();
    boardingInputRef.current?.focus();
  }

  function toggleGuideExpanded() {
    setIsGuideExpanded((prev) => {
      const next = !prev;
      if (!next) {
        try {
          sessionStorage.setItem(guideSeenStorageKey, "1");
        } catch {
          // sessionStorage 실패 시 접기만 반영합니다.
        }
      }
      return next;
    });
  }

  const guideTitle = mode === "leave" ? "내릴게요 등록이란?" : "바로 앉기 등록이란?";
  const guideItems =
    mode === "leave"
      ? ["① 하차 예정·좌석 등록", "② 착석 희망자 자동 매칭", "③ 빈자리 실시간 전달"]
      : ["① 빈자리 실시간 알림", "② 목적지 입력 → 자동 매칭", "③ 호차·좌석 위치 안내"];

  const lineColor = LINE_OLIVE;
  const lineColorLight = LINE_OLIVE_LIGHT;
  const voiceHint =
    apiLine === "seoul7"
      ? '예: "논현 가고 싶어"'
      : apiLine === "seoul2"
        ? '예: "강남 가고 싶어"'
        : '예: "신도림 가고 싶어"';
  const showDestinationDropdown = !selected && destinationSearchResults.length > 0;
  const showBoardingDropdown =
    needsManualBoardingStation && boardingResults.length > 0 && !boardingStationName;
  const departureBoxClass = boardingStationName
    ? "bg-[#f0f5e8] border-gray-200"
    : needsManualBoardingStation
      ? "bg-amber-50 border-amber-300"
      : "bg-white border-gray-200";
  const destinationBoxClass = selected ? "bg-[#f0f5e8] border-gray-200" : "bg-white border-gray-200";
  const showLeaveVoicePanel =
    mode === "leave" && (isVoiceExpanded || isListening || isParsingVoice);
  const showSeekVoiceOverlay = voiceSentenceActive && mode === "seek";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: C.bg,
        letterSpacing: "-0.3px",
      }}
    >
      <div className="zeb-app-header">
        <button
          type="button"
          className="zeb-touch-target"
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
            color: C.text,
            fontSize: 20,
            lineHeight: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: MOBILE.touchMin,
            height: MOBILE.touchMin,
          }}
        >
          ←
        </button>
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <LineCircleBadge line={line} />
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text, textAlign: "left" }}>
            {showSeekVoiceOverlay ? "음성으로 등록" : "어디까지 가세요?"}
          </div>
        </div>
        {showSeekVoiceOverlay ? (
          <button
            type="button"
            className="zeb-touch-target"
            onClick={() => {
              setVoiceError("");
              closeVoicePanel();
            }}
            disabled={isParsingVoice}
            aria-label="음성 등록 닫기"
            style={{
              width: MOBILE.touchMin,
              height: MOBILE.touchMin,
              padding: 0,
              border: "none",
              background: "transparent",
              color: C.muted,
              fontSize: 22,
              lineHeight: 1,
              cursor: isParsingVoice ? "default" : "pointer",
              flexShrink: 0,
            }}
          >
            ×
          </button>
        ) : (
          <div
            style={{
              fontSize: 11,
              color: lineColor,
              fontWeight: 700,
              background: lineColorLight,
              borderRadius: 20,
              padding: "4px 10px",
              flexShrink: 0,
            }}
          >
            1 / 3
          </div>
        )}
      </div>

      {showSeekVoiceOverlay ? (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            padding: `20px ${MOBILE.pageX}px 0`,
          }}
        >
          <div
            className="zeb-no-scrollbar"
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: voiceParseResult ? "flex-start" : "center",
              textAlign: "center",
              padding: "8px 0 16px",
              overflowY: voiceParseResult ? "auto" : "hidden",
              width: "100%",
            }}
          >
            <span
              style={{
                width: 72,
                height: 72,
                borderRadius: "50%",
                background: lineColor,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                boxShadow: isListening ? `0 0 0 8px ${lineColorLight}` : "none",
                transition: "box-shadow 0.2s ease",
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fff"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            </span>
            <p
              style={{
                margin: "16px 0 0",
                fontSize: 16,
                fontWeight: 700,
                color: C.text,
                lineHeight: 1.45,
              }}
            >
              {VOICE_SENTENCE_GUIDE_TITLE}
            </p>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: C.muted, lineHeight: 1.5 }}>
              {VOICE_SENTENCE_GUIDE_SUB}
            </p>
            {isListening ? (
              <p style={{ margin: "14px 0 0", fontSize: 14, color: lineColor, fontWeight: 600 }}>
                듣는 중…
              </p>
            ) : null}
            {isParsingVoice ? (
              <p style={{ margin: "14px 0 0", fontSize: 14, color: C.muted, fontWeight: 600 }}>
                분석 중…
              </p>
            ) : null}
            {voiceParseResult ? (
              <>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    justifyContent: "center",
                    marginTop: 20,
                    maxWidth: "100%",
                  }}
                >
                  {[
                    formatStationDisplayName(voiceParseResult.stationName),
                    voiceParseResult.doorLabel,
                    voiceParseResult.side,
                    voiceParseResult.seatLetter
                      ? `${voiceParseResult.seatLetter}열`
                      : null,
                  ]
                    .filter(Boolean)
                    .map((label) => (
                      <span
                        key={label}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          padding: "6px 12px",
                          borderRadius: 999,
                          background: LINE_OLIVE_LIGHT_BG,
                          border: `1px solid ${C.primaryBorder}`,
                          fontSize: 13,
                          fontWeight: 600,
                          color: C.text,
                        }}
                      >
                        {label}
                      </span>
                    ))}
                </div>
                <p style={{ margin: "12px 0 0", fontSize: 12, color: C.muted }}>
                  아래 열차가 맞는지 확인해 주세요
                </p>

                <div style={{ width: "100%", marginTop: 16, textAlign: "left" }}>
                  <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 700, color: C.text }}>
                    탑승할 열차
                  </p>
                  {boardingStationName ? (
                    <p style={{ margin: "0 0 10px", fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
                      {formatStationDisplayName(boardingStationName)} 역 기준 ·{" "}
                      {formatStationDisplayName(voiceParseResult.stationName)} 방향
                    </p>
                  ) : null}

                  {voiceTrainsLoading ? (
                    <p style={{ margin: 0, fontSize: 13, color: C.muted }}>열차 불러오는 중…</p>
                  ) : null}

                  {!voiceTrainsLoading && voiceTrainsError ? (
                    <p style={{ margin: 0, fontSize: 13, color: "#DC2626", lineHeight: 1.5 }}>
                      {voiceTrainsError}
                    </p>
                  ) : null}

                  {!voiceTrainsLoading && voiceTrains.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {voiceTrains.map((train, index) => {
                        const isSelected = voiceSelectedTrain?.id === train.id;
                        return (
                          <button
                            key={train.id}
                            type="button"
                            onClick={() => setVoiceSelectedTrain(train)}
                            style={{
                              width: "100%",
                              textAlign: "left",
                              padding: "14px",
                              borderRadius: 14,
                              border: `2px solid ${isSelected ? lineColor : C.border}`,
                              background: isSelected ? lineColorLight : C.card,
                              cursor: "pointer",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "flex-start",
                                gap: 10,
                              }}
                            >
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div
                                  style={{
                                    fontSize: 26,
                                    fontWeight: 800,
                                    color: lineColor,
                                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                                    lineHeight: 1.1,
                                  }}
                                >
                                  {train.id}
                                </div>
                                <div
                                  style={{
                                    marginTop: 6,
                                    fontSize: 14,
                                    color: lineColor,
                                    fontWeight: 700,
                                  }}
                                >
                                  {formatVoiceTrainArrival(train, boardingStationName)}
                                </div>
                                <div
                                  style={{ marginTop: 4, fontSize: 13, color: C.text, fontWeight: 600 }}
                                >
                                  {train.eta}
                                </div>
                                <div style={{ marginTop: 4, fontSize: 12, color: C.muted }}>
                                  {train.direction}
                                  {train.current && train.current !== "정보 없음"
                                    ? ` · ${formatStationDisplayName(train.current)}`
                                    : ""}
                                </div>
                              </div>
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 700,
                                  color: index === 0 ? lineColor : C.muted,
                                  background: index === 0 ? lineColorLight : "#F0F4F8",
                                  borderRadius: 999,
                                  padding: "4px 10px",
                                  whiteSpace: "nowrap",
                                  flexShrink: 0,
                                }}
                              >
                                {index === 0 ? "곧 도착" : "다음 열차"}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}
            {voiceError ? (
              <p
                style={{
                  margin: "16px 0 0",
                  fontSize: 13,
                  color: "#DC2626",
                  lineHeight: 1.5,
                  whiteSpace: "pre-line",
                  maxWidth: 280,
                }}
              >
                {voiceError}
              </p>
            ) : null}
          </div>
        </div>
      ) : (
      <div
        className="zeb-no-scrollbar"
        style={{
          flex: 1,
          overflow: "auto",
          padding: `12px ${MOBILE.pageX}px 0`,
          scrollbarWidth: "none",
          msOverflowStyle: "none",
        }}
      >
        <div style={{ position: "relative" }}>
          <div className="bg-white rounded-2xl p-4 flex flex-col gap-2">
            <div className="w-full flex flex-col gap-1">
              <p className="m-0 text-sm font-semibold text-gray-700">출발지</p>
              <div
                className={`border rounded-xl px-4 py-3 flex items-center gap-1 min-h-[44px] ${departureBoxClass}`}
              >
                {isDetectingBoardingStation ? (
                  <p className="m-0 flex-1 text-sm text-gray-400">위치 감지중...</p>
                ) : needsManualBoardingStation ? (
                  <input
                    className="zeb-field flex-1 min-w-0 m-0 p-0 border-none bg-transparent outline-none text-sm text-gray-800 placeholder:text-gray-400"
                    ref={boardingInputRef}
                    value={boardingQuery}
                    onChange={(e) => setBoardingQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        confirmBoardingFromKeyboard();
                      }
                    }}
                    placeholder="역 검색"
                  />
                ) : boardingStationName ? (
                  <>
                    <p className="m-0 flex-1 min-w-0 text-sm font-medium text-gray-800 break-keep">
                      {formatStationDisplayName(boardingStationName)}
                    </p>
                    <button
                      type="button"
                      className="zeb-touch-target shrink-0"
                      onClick={clearBoardingSelection}
                      aria-label="출발역 다시 선택"
                      style={{
                        width: MOBILE.touchMin,
                        height: MOBILE.touchMin,
                        padding: 0,
                        border: "none",
                        borderRadius: "50%",
                        background: "transparent",
                        color: C.muted,
                        fontSize: 18,
                        lineHeight: 1,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      ×
                    </button>
                  </>
                ) : (
                  <p className="m-0 text-sm text-gray-400">역 검색</p>
                )}
              </div>
              {needsManualBoardingStation && boardingGpsMessage ? (
                <p className="m-0 px-1 text-xs leading-snug text-amber-700">{boardingGpsMessage}</p>
              ) : null}
              {needsManualBoardingStation && boardingSearchError ? (
                <p className="m-0 px-1 text-xs text-[#DC2626]">{boardingSearchError}</p>
              ) : null}
              {showBoardingDropdown ? (
                <div className="bg-white rounded-xl shadow-md overflow-hidden">
                  {boardingResults.map((station) => (
                    <button
                      key={`boarding-${station}`}
                      type="button"
                      className="zeb-touch-target w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-[#f0f5e8] cursor-pointer"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        onBoardingStationChange?.(station);
                        setBoardingQuery(station);
                        setBoardingSearchError("");
                      }}
                      style={{
                        background: "transparent",
                        fontSize: 15,
                        color: C.text,
                        minHeight: MOBILE.touchMin,
                      }}
                    >
                      {formatStationDisplayName(station)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <span className="text-[#6b9e3f] font-bold text-center leading-none">↓</span>
            <div className="w-full flex flex-col gap-1">
              <p className="m-0 text-sm font-semibold text-gray-700">목적지</p>
              <div
                className={`border rounded-xl px-4 py-3 flex items-center gap-1 min-h-[44px] ${destinationBoxClass}`}
              >
                {selected ? (
                  <>
                    <p className="m-0 flex-1 min-w-0 text-sm font-medium text-gray-800 break-keep">
                      {formatStationDisplayName(selected)}
                    </p>
                    <button
                      type="button"
                      className="zeb-touch-target shrink-0"
                      onClick={clearDestinationSelection}
                      aria-label="목적지 다시 선택"
                      style={{
                        width: MOBILE.touchMin,
                        height: MOBILE.touchMin,
                        padding: 0,
                        border: "none",
                        borderRadius: "50%",
                        background: "transparent",
                        color: C.muted,
                        fontSize: 18,
                        lineHeight: 1,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      ×
                    </button>
                  </>
                ) : (
                  <input
                    className="zeb-field w-full m-0 p-0 border-none bg-transparent outline-none text-sm text-gray-800 placeholder:text-gray-400"
                    ref={inputRef}
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setSelected(null);
                    }}
                    onCompositionStart={() => setIsDestinationComposing(true)}
                    onCompositionEnd={(e) => {
                      setIsDestinationComposing(false);
                      setQuery(e.currentTarget.value);
                      setSelected(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        confirmDestinationFromKeyboard();
                      }
                    }}
                    placeholder="목적지 선택"
                  />
                )}
              </div>
              {showDestinationDropdown ? (
                <div
                  ref={destinationResultsRef}
                  className="bg-white rounded-xl shadow-md overflow-hidden"
                >
                  {destinationSearchResults.map((station) => (
                    <button
                      key={station}
                      type="button"
                      className="zeb-touch-target w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-[#f0f5e8] cursor-pointer"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setSelected(station);
                        setQuery(station);
                        inputRef.current?.blur();
                      }}
                      style={{
                        background: "transparent",
                        fontSize: 15,
                        color: C.text,
                        minHeight: MOBILE.touchMin,
                      }}
                    >
                      {formatStationDisplayName(station)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {destinationSearchError ? (
          <p style={{ marginTop: 8, fontSize: 12, color: "#DC2626" }}>{destinationSearchError}</p>
        ) : null}

        {query.length >= 1 &&
          !selected &&
          destinationSearchResults.length === 0 &&
          !isStationListLoading &&
          !stationListLoadError &&
          !isDestinationComposing &&
          !voiceError &&
          !isParsingVoice &&
          query.length <= 12 && (
          <p style={{ margin: "8px 0 0", color: C.muted, fontSize: 13, textAlign: "center" }}>
            &quot;{query}&quot; 역을 찾지 못했어요
          </p>
        )}

        {showLeaveVoicePanel ? (
          <button
            type="button"
            className="zeb-touch-target"
            onClick={startVoiceSearchLeave}
            disabled={isListening || isParsingVoice}
            style={{
              marginTop: 14,
              width: "100%",
              padding: "14px 16px",
              borderRadius: 14,
              border: `1px solid ${C.border}`,
              background: C.card,
              cursor: isListening || isParsingVoice ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 14,
              textAlign: "left",
            }}
          >
            <span
              style={{
                width: 44,
                height: 44,
                borderRadius: "50%",
                background: lineColor,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fff"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span
                style={{
                  display: "block",
                  fontSize: 15,
                  fontWeight: 700,
                  color: C.text,
                  lineHeight: 1.45,
                }}
              >
                {isListening ? (
                  "듣는 중…"
                ) : isParsingVoice ? (
                  "분석 중…"
                ) : (
                  <>
                    <span style={{ display: "block" }}>음성으로 어디까지 가세요?</span>
                    <span style={{ display: "block" }}>말씀해 주세요</span>
                  </>
                )}
              </span>
              {!isListening && !isParsingVoice ? (
                <span style={{ display: "block", marginTop: 4, fontSize: 13, color: C.muted }}>
                  {voiceHint}
                </span>
              ) : null}
            </span>
          </button>
        ) : !voiceSentenceActive ? (
          <button
            type="button"
            className="zeb-touch-target"
            onClick={startVoiceSentenceFlow}
            disabled={isParsingVoice}
            style={{
              marginTop: 14,
              width: "100%",
              padding: "12px 14px",
              borderRadius: 14,
              border: `1px solid ${C.border}`,
              background: C.card,
              cursor: isParsingVoice ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 10,
              textAlign: "left",
            }}
          >
            <span
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: lineColor,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fff"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            </span>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>
              {mode === "seek" ? "음성으로 등록하기" : "음성으로 목적지 말하기"}
            </span>
          </button>
        ) : null}

        {voiceError && !voiceSentenceActive ? (
          <p style={{ marginTop: 8, fontSize: 12, color: "#DC2626" }}>{voiceError}</p>
        ) : null}

        <div className="bg-white rounded-2xl px-4 py-3 mt-4">
          <button
            type="button"
            className="zeb-touch-target w-full flex items-center justify-between gap-2 border-none bg-transparent p-0 cursor-pointer text-left"
            onClick={toggleGuideExpanded}
            aria-expanded={isGuideExpanded}
          >
            <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{guideTitle}</span>
            <span style={{ fontSize: 18, color: C.muted, lineHeight: 1 }}>{isGuideExpanded ? "−" : "+"}</span>
          </button>
          {isGuideExpanded ? (
            <ul
              style={{
                margin: "10px 0 0",
                padding: 0,
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {guideItems.map((item) => (
                <li
                  key={item}
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: C.text,
                    lineHeight: 1.45,
                    textAlign: "left",
                  }}
                >
                  {item}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      )}

      <div
        style={{
          padding: `12px ${MOBILE.pageX}px max(24px, env(safe-area-inset-bottom))`,
          background: C.card,
          borderTop: `1px solid ${C.border}`,
        }}
      >
        {showSeekVoiceOverlay ? (
          <>
            {voiceParseResult ? (
              <button
                type="button"
                className="zeb-touch-target"
                onClick={() => {
                  void handleVoiceSentenceConfirm();
                }}
                disabled={isParsingVoice || voiceTrainsLoading || !voiceSelectedTrain?.id}
                style={{
                  width: "100%",
                  minHeight: MOBILE.touchMin,
                  marginBottom: 10,
                  padding: "12px 0",
                  background:
                    isParsingVoice || voiceTrainsLoading || !voiceSelectedTrain?.id
                      ? "#D1D5DB"
                      : lineColor,
                  color: "#fff",
                  border: "none",
                  borderRadius: 12,
                  fontSize: 16,
                  fontWeight: 700,
                  cursor:
                    isParsingVoice || voiceTrainsLoading || !voiceSelectedTrain?.id
                      ? "default"
                      : "pointer",
                }}
              >
                {isParsingVoice
                  ? "매칭 등록 중..."
                  : voiceTrainsLoading
                    ? "열차 확인 중..."
                    : voiceSelectedTrain?.id
                      ? "확인 · 매칭 등록"
                      : "열차를 선택해 주세요"}
              </button>
            ) : null}
            {voiceError ? (
              <button
                type="button"
                className="zeb-touch-target"
                onClick={retryVoiceSentence}
                disabled={isListening || isParsingVoice}
                style={{
                  width: "100%",
                  minHeight: MOBILE.touchMin,
                  marginBottom: 10,
                  padding: "12px 0",
                  background: "#fff",
                  color: lineColor,
                  border: `1.5px solid ${lineColor}`,
                  borderRadius: 12,
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: isListening || isParsingVoice ? "default" : "pointer",
                }}
              >
                다시 말하기
              </button>
            ) : null}
            <div style={{ display: "flex", justifyContent: "center", gap: 16 }}>
              <button
                type="button"
                className="zeb-touch-target"
                onClick={() => {
                  setVoiceError("");
                  closeVoicePanel();
                }}
                disabled={isParsingVoice}
                style={{
                  padding: "8px 4px",
                  background: "transparent",
                  color: C.muted,
                  border: "none",
                  fontSize: 14,
                  fontWeight: 600,
                  textDecoration: "underline",
                  cursor: isParsingVoice ? "default" : "pointer",
                }}
              >
                직접 입력으로 전환
              </button>
            </div>
          </>
        ) : (
          <>
            {proceedHint ? (
              <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600, color: lineColor, textAlign: "center" }}>
                {proceedHint}
              </p>
            ) : null}
            <button
              type="button"
              className="zeb-touch-target"
              onClick={() => onNext(selected)}
              disabled={!canProceedToTrainStep}
              style={{
                width: "100%",
                minHeight: MOBILE.touchMin,
                padding: "12px 0",
                background: canProceedToTrainStep ? lineColor : "#D1D5DB",
                color: "#fff",
                border: "none",
                borderRadius: 12,
                fontSize: 16,
                fontWeight: 700,
                cursor: canProceedToTrainStep ? "pointer" : "default",
                transition: "background 0.2s",
              }}
            >
              다음 — 열차 선택
            </button>
          </>
        )}
      </div>
    </div>
  );
}
function estimateSeoulArrivalSeconds(trainStation, boardingStation, stationOrder, apiLine) {
  if (!Array.isArray(stationOrder) || stationOrder.length === 0) return null;

  const target = normalizeStationLabel(boardingStation);
  const trainAt = normalizeStationLabel(trainStation);
  if (!target || !trainAt) return null;

  const findIdx = (label) =>
    stationOrder.findIndex((name) => normalizeStationLabel(name) === label);

  const fromIdx = findIdx(target);
  const trainIdx = findIdx(trainAt);
  if (fromIdx < 0 || trainIdx < 0) return null;

  const count = stationOrder.length;
  const linear = Math.abs(trainIdx - fromIdx);
  const secondsPerStation = apiLine === "seoul2" ? 90 : 120;

  if (apiLine === "seoul2") {
    const wrap = count - linear;
    const distance = Math.min(linear, wrap);
    return distance === 0 ? 45 : distance * secondsPerStation;
  }

  return linear === 0 ? 45 : linear * secondsPerStation;
}

/** 음성·수동 등록 공통 — 실시간 열차 목록 조회 */
async function fetchTrainsForVoicePanel({
  lineLabel,
  destination,
  boardingStation,
  limit = 3,
}) {
  const apiLine = resolveApiLineFromLineProp(lineLabel);
  if (!apiLine || !isSubwayOperatingHours(apiLine)) {
    return [];
  }

  const dest = (destination || "").trim().replace(/역$/u, "");
  if (!dest) {
    return [];
  }

  try {
    const params = new URLSearchParams({
      line: apiLine,
      station: dest,
    });
    const boarding = (boardingStation || "").trim().replace(/역$/u, "");
    if (boarding) {
      params.set("current_station", boarding);
    }

    const response = await fetch(`/api/trains?${params.toString()}`, {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) {
      return [];
    }

    const payload = await response.json();
    if (payload?.is_operating_hours === false) {
      return [];
    }

    const apiTrains = Array.isArray(payload?.trains) ? payload.trains : [];
    return apiTrains
      .filter((entry) => entry?.train_no)
      .slice(0, limit)
      .map((row) => {
        const directionDisplay = String(row?.direction_display ?? row?.direction ?? "").trim();
        return {
          id: String(row.train_no),
          current: row?.station_name?.trim() || boarding || "정보 없음",
          eta: directionDisplay.endsWith("방면")
            ? directionDisplay
            : directionDisplay
              ? `${directionDisplay} 방면`
              : "하행",
          direction: row?.direction?.trim() || "하행",
          directionCode: row?.direction_code ?? row?.updnLine ?? null,
          updnLine: row?.updnLine ?? row?.direction_code ?? null,
          barvlDt: row?.barvl_dt ?? row?.barvlDt ?? null,
          arvlMsg2: row?.arvl_msg2 ?? row?.arvlMsg2 ?? null,
          bstatnNm: row?.bstatn_nm ?? row?.bstatnNm ?? null,
        };
      });
  } catch {
    return [];
  }
}

/** 음성 열차 카드 도착 문구 */
function formatVoiceTrainArrival(train, boardingStation) {
  const atBoarding =
    normalizeStationLabel(train?.current) === normalizeStationLabel(boardingStation);
  const seconds = train?.barvlDt != null ? Number(train.barvlDt) : Number.NaN;

  if (atBoarding || seconds === 0) {
    return "곧 도착";
  }
  if (Number.isFinite(seconds) && seconds > 0 && seconds < 60) {
    return `${seconds}초 후 도착`;
  }
  if (Number.isFinite(seconds) && seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    const remainSeconds = seconds % 60;
    if (remainSeconds > 0) {
      return `${minutes}분 ${remainSeconds}초 후 도착`;
    }
    return `${minutes}분 후 도착`;
  }

  const arrivalMessage = typeof train?.arvlMsg2 === "string" ? train.arvlMsg2.trim() : "";
  return arrivalMessage || "도착 정보 확인 중";
}

// ─── Step 2: 열차 선택 (탭 1회 → 매칭 시도) ───────────────────────
function StepTrain({
  line,
  station,
  currentStation,
  mode,
  isMatching,
  onTrainPick,
  onBack,
}) {
  const [trains, setTrains] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [selectedTrain, setSelectedTrain] = useState(null);
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(
    Math.floor(TRAIN_LIST_REFRESH_MS / 1000)
  );
  const [travelDirectionKey, setTravelDirectionKey] = useState(null);
  const [seoulStationOrder, setSeoulStationOrder] = useState([]);
  const [isOutsideOperatingHours, setIsOutsideOperatingHours] = useState(false);
  const apiLine = resolveApiLineFromLineProp(line);

  function resolveTrainDirectionKey(train) {
    const directionLabel = String(train?.direction ?? "").trim();
    if (directionLabel) {
      const fromLabel = normalizeDirectionKeyForStops(directionLabel);
      if (fromLabel) return fromLabel;
    }

    const code = String(train?.directionCode ?? train?.updnLine ?? "").trim();
    if (!code) return null;

    const layoutKey = resolveLineLayoutKey(line);
    if (layoutKey === "seoul2") {
      if (code === "1") return "up";
      if (code === "0") return "down";
    } else {
      if (code === "0") return "up";
      if (code === "1") return "down";
    }

    return normalizeDirectionKeyForStops(code);
  }

  useEffect(() => {
    let active = true;

    const resolveTravelDirection = async () => {
      if (!currentStation?.trim() || !station?.trim()) {
        setTravelDirectionKey(null);
        return;
      }

      const cachedStations = stationListCache.get(apiLine)?.stations;
      const stations =
        Array.isArray(cachedStations) && cachedStations.length > 0
          ? cachedStations
          : await fetchStationsForLine(line);
      if (!active) return;

      if (!Array.isArray(stations) || stations.length === 0) {
        setTravelDirectionKey(null);
        return;
      }

      const findIndex = (name) => {
        const target = normalizeStationLabel(name);
        return stations.findIndex((row) => normalizeStationLabel(row?.name) === target);
      };

      const fromIdx = findIndex(currentStation);
      const toIdx = findIndex(station);

      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) {
        setTravelDirectionKey(null);
        return;
      }

      const layoutKey = resolveLineLayoutKey(line);
      let dirKey = null;
      if (layoutKey === "seoul2") {
        const count = stations.length;
        const distDown = (toIdx - fromIdx + count) % count;
        const distUp = (fromIdx - toIdx + count) % count;
        if (distDown < distUp) dirKey = "down";
        else if (distUp < distDown) dirKey = "up";
      } else if (toIdx > fromIdx) {
        dirKey = "down";
      } else {
        dirKey = "up";
      }

      setTravelDirectionKey(dirKey);
    };

    void resolveTravelDirection();
    return () => {
      active = false;
    };
  }, [line, currentStation, station]);

  const directionFilteredTrains = (() => {
    if (travelDirectionKey == null) return trains;

    const filtered = trains.filter(
      (train) => resolveTrainDirectionKey(train) === travelDirectionKey
    );

    if (filtered.length === 0 && trains.length > 0) {
      return trains;
    }

    return filtered;
  })();

  function resolveDisplayArrivalSeconds(train) {
    const barvlRaw = resolveSeoulBarvlDtForTrain(
      train.current,
      currentStation,
      seoulStationOrder,
      apiLine,
      train.barvlDt
    );
    if (barvlRaw == null || barvlRaw === "") return Number.POSITIVE_INFINITY;

    const seconds = Number(barvlRaw);
    if (!Number.isFinite(seconds) || seconds < 0) return Number.POSITIVE_INFINITY;
    return seconds;
  }

  const displayTrains = (() => {
    const limit = 3;
    if (!Array.isArray(directionFilteredTrains) || directionFilteredTrains.length === 0) {
      return [];
    }

    return [...directionFilteredTrains]
      .sort((a, b) => resolveDisplayArrivalSeconds(a) - resolveDisplayArrivalSeconds(b))
      .slice(0, limit);
  })();

  function isTrainAtBoardingStation(trainStation) {
    return (
      normalizeStationLabel(trainStation) === normalizeStationLabel(currentStation)
    );
  }

  function resolveSeoulBarvlDtForTrain(trainStation, boardingStation, stationOrder, lineKey, barvlFromApi) {
    const parsed =
      barvlFromApi != null && barvlFromApi !== "" ? Number(barvlFromApi) : Number.NaN;

    if (Number.isFinite(parsed) && parsed > 0) return parsed;

    if (!lineKey?.startsWith("seoul") || !Array.isArray(stationOrder) || stationOrder.length === 0) {
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    }

    const atBoarding = isTrainAtBoardingStation(trainStation);
    if (parsed === 0 && atBoarding) return 0;

    const estimated = estimateSeoulArrivalSeconds(
      trainStation,
      boardingStation,
      stationOrder,
      lineKey
    );
    if (estimated != null) return estimated;

    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  function formatBarvlDtLabel(barvlRaw, { allowZeroSoon = false } = {}) {
    if (barvlRaw == null || barvlRaw === "") return null;

    const totalSeconds = Number(barvlRaw);
    if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return null;

    if (totalSeconds === 0) {
      return allowZeroSoon ? "곧 도착" : null;
    }

    if (totalSeconds < 30) return "곧 도착";

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes === 0) return `${seconds}초 후 도착`;
    if (seconds > 0) return `${minutes}분 ${seconds}초 후 도착`;
    return `${minutes}분 후 도착`;
  }

  function isArrivalStatusMessage(text) {
    if (!text) return false;
    return /\[?\d*\s*번째\s*전역|전역\s*도착|진입|출발|도착/.test(text);
  }

  function extractTerminalFromArvlMsg2(arvlMsg2) {
    const text = String(arvlMsg2 ?? "").trim();
    if (!text) return null;

    const parenMatch = text.match(/\(([^)]+)\)\s*$/);
    if (parenMatch?.[1]) {
      return parenMatch[1].trim().replace(/역$/u, "");
    }

    return null;
  }

  function resolveTrainDirectionEta(row) {
    const directionDisplay = String(row?.direction_display ?? "").trim();
    if (directionDisplay.endsWith("방면") && !isArrivalStatusMessage(directionDisplay)) {
      return directionDisplay;
    }

    const terminalName = String(row?.bstatn_nm ?? row?.bstatnNm ?? "").trim().replace(/역$/u, "");
    if (terminalName) {
      return `${terminalName} 방면`;
    }

    const arvlMsg2 = String(row?.arvl_msg2 ?? row?.arvlMsg2 ?? "").trim();
    const terminalFromArvl = extractTerminalFromArvlMsg2(arvlMsg2);
    if (terminalFromArvl) {
      return `${terminalFromArvl} 방면`;
    }

    if (directionDisplay && !isArrivalStatusMessage(directionDisplay)) {
      return directionDisplay.endsWith("방면") ? directionDisplay : `${directionDisplay} 방면`;
    }

    return "운행 정보";
  }

  function resolveTrainDirectionEtaFromMapped(train) {
    const eta = String(train?.eta ?? "").trim();
    if (isArrivalStatusMessage(eta)) {
      const terminalFromEta = extractTerminalFromArvlMsg2(eta);
      if (terminalFromEta) {
        return `${terminalFromEta} 방면`;
      }
    } else if (eta.endsWith("방면")) {
      return eta;
    }

    const terminalName = String(train?.bstatnNm ?? "").trim().replace(/역$/u, "");
    if (terminalName) {
      return `${terminalName} 방면`;
    }

    const terminalFromArvl = extractTerminalFromArvlMsg2(train?.arvlMsg2);
    if (terminalFromArvl) {
      return `${terminalFromArvl} 방면`;
    }

    if (isArrivalStatusMessage(eta)) {
      const terminalFromEta = extractTerminalFromArvlMsg2(eta);
      if (terminalFromEta) {
        return `${terminalFromEta} 방면`;
      }
    }

    const direction = String(train?.direction ?? "").trim();
    if (direction && !isArrivalStatusMessage(direction)) {
      return `${direction} 방면`;
    }

    return eta && !isArrivalStatusMessage(eta) ? eta : "운행 정보";
  }

  function formatTrainArrivalLabel(train) {
    const atBoarding = isTrainAtBoardingStation(train.current);
    const barvlRaw = resolveSeoulBarvlDtForTrain(
      train.current,
      currentStation,
      seoulStationOrder,
      apiLine,
      train.barvlDt
    );
    const timeLabel = formatBarvlDtLabel(barvlRaw, { allowZeroSoon: atBoarding });
    if (timeLabel) return timeLabel;

    const arvlMsg2 = typeof train.arvlMsg2 === "string" ? train.arvlMsg2.trim() : "";
    if (arvlMsg2 && !isArrivalStatusMessage(arvlMsg2)) return arvlMsg2;

    if (atBoarding) return "곧 도착";

    return "도착 정보 확인 중";
  }

  function formatTrainArrivalBadge(train, index) {
    const barvlRaw = resolveSeoulBarvlDtForTrain(
      train.current,
      currentStation,
      seoulStationOrder,
      apiLine,
      train.barvlDt
    );
    const seconds = barvlRaw != null ? Number(barvlRaw) : Number.NaN;

    if (Number.isFinite(seconds) && seconds < 30) return "곧 도착";
    if (Number.isFinite(seconds) && seconds >= 30) {
      const label = formatBarvlDtLabel(seconds);
      if (label) return label.replace(" 후 도착", "");
    }

    return index === 0 ? "곧 도착" : "다음 열차";
  }

  const directionHeading =
    displayTrains
      .map((train) => resolveTrainDirectionEtaFromMapped(train))
      .find((label) => label.endsWith("방면")) || "";

  useEffect(() => {
    if (!apiLine) {
      setTrains([]);
      return;
    }

    let active = true;
    let requestSeq = 0;

    const resolveTimetableDayType = () => {
      const day = new Date().getDay();
      return day === 0 || day === 6 ? "holiday" : "weekday";
    };

    const mapSeoulApiTrains = (apiTrains, stationOrder) =>
      apiTrains
        .map((row) => {
          const barvlDt = resolveSeoulBarvlDtForTrain(
            row?.station_name,
            currentStation,
            stationOrder,
            apiLine,
            row?.barvl_dt ?? row?.barvlDt ?? null
          );

          const arvlMsg2 =
            (typeof row?.arvl_msg2 === "string" && row.arvl_msg2.trim()) ||
            (typeof row?.arvlMsg2 === "string" && row.arvlMsg2.trim()) ||
            null;
          const bstatnNm = String(row?.bstatn_nm ?? row?.bstatnNm ?? "").trim() || null;

          return {
            id: row?.train_no ?? "",
            current: row?.station_name?.trim() || "정보 없음",
            eta: resolveTrainDirectionEta(row),
            direction: row?.direction?.trim() || "하행",
            directionCode:
              row?.direction_code ?? row?.updnLine ?? row?.directionCode ?? null,
            updnLine: row?.updnLine ?? row?.direction_code ?? null,
            barvlDt,
            arvlMsg2,
            bstatnNm,
          };
        })
        .filter((row) => row.id);

    const loadTrains = async ({ silent = false } = {}) => {
      const seq = ++requestSeq;
      const cacheKey = buildTrainListCacheKey(apiLine, station, currentStation);

      if (!silent) {
        const prefetched = trainListPrefetchCache.get(cacheKey);
        if (
          prefetched &&
          Date.now() - prefetched.fetchedAt < TRAIN_LIST_REFRESH_MS &&
          apiLine?.startsWith("seoul")
        ) {
          setSeoulStationOrder(prefetched.stationOrder);
          setIsOutsideOperatingHours(false);
          setTrains(mapSeoulApiTrains(prefetched.apiTrains, prefetched.stationOrder));
          setLastUpdatedAt(prefetched.fetchedAt);
          setIsLoading(false);
        } else {
          setIsLoading(true);
        }
      }
      try {
        if (!apiLine) {
          if (!active || seq !== requestSeq) return;
          setIsOutsideOperatingHours(false);
          setTrains([]);
          setLastUpdatedAt(Date.now());
          return;
        }

        // 운행 시간 밖에는 seek·leave 공통으로 대체·시간표 열차를 표시하지 않습니다.
        if (!isSubwayOperatingHours(apiLine)) {
          if (!active || seq !== requestSeq) return;
          setIsOutsideOperatingHours(true);
          setTrains([]);
          setLastUpdatedAt(Date.now());
          return;
        }

        setIsOutsideOperatingHours(false);
        let mapped = [];

        if (apiLine.startsWith("incheon")) {
          const stationName = (currentStation ?? "").trim().replace(/역$/u, "");

          if (!stationName || !travelDirectionKey) {
            mapped = [];
          } else {
            const lineCode = apiLine === "incheon2" ? "l2" : "l1";
            const dayType = resolveTimetableDayType();
            const params = new URLSearchParams({
              line_code: lineCode,
              station_name: stationName,
              direction: travelDirectionKey,
              day_type: dayType,
            });
            const response = await fetch(`/api/timetable?${params.toString()}`, {
              method: "GET",
              cache: "no-store",
            });
            const payload = await response.json();
            if (!response.ok || payload?.success === false) {
              throw new Error(payload?.error || "timetable 조회 실패");
            }

            const data = Array.isArray(payload?.rows) ? payload.rows : [];
            const directionLabel = travelDirectionKey === "up" ? "상행" : "하행";
            const directionCode = travelDirectionKey === "up" ? "0" : "1";
            const now = new Date();
            const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
            const seenTrainNumbers = new Set();

            mapped = data
              .map((row) => {
                const trainNumber = String(row?.train_number ?? "").trim();
                if (!trainNumber) return null;

                const arrivalRaw = String(row?.arrival_time ?? "").trim();
                const timePart = arrivalRaw.includes("T")
                  ? arrivalRaw.split("T")[1]?.slice(0, 8) ?? ""
                  : arrivalRaw.slice(0, 8);
                const [h, m, s = 0] = timePart.split(":").map(Number);
                if (!Number.isFinite(h) || !Number.isFinite(m)) return null;

                const arrSec = h * 3600 + m * 60 + (Number.isFinite(s) ? s : 0);
                let barvlDt = arrSec - nowSec;
                if (barvlDt < 0) barvlDt += 86400;

                return { trainNumber, barvlDt };
              })
              .filter(Boolean)
              .sort((a, b) => a.barvlDt - b.barvlDt)
              .filter((item) => {
                if (seenTrainNumbers.has(item.trainNumber)) return false;
                seenTrainNumbers.add(item.trainNumber);
                return true;
              })
              .slice(0, 3)
              .map((item) => ({
                id: item.trainNumber,
                current: stationName,
                eta: directionLabel,
                direction: directionLabel,
                directionCode,
                updnLine: directionCode,
                barvlDt: item.barvlDt,
                arvlMsg2: null,
              }));
          }
        } else {
          const params = new URLSearchParams({
            line: apiLine,
            station: station ?? "",
          });
          if (currentStation?.trim()) {
            params.set("current_station", currentStation.trim());
          }
          const response = await fetch(`/api/trains?${params.toString()}`, {
            method: "GET",
            cache: "no-store",
            signal: AbortSignal.timeout(TRAIN_LIST_FETCH_TIMEOUT_MS),
          });
          if (!response.ok) {
            throw new Error("열차 API 호출 실패");
          }
          const payload = await response.json();
          const apiTrains = Array.isArray(payload?.trains) ? payload.trains : [];
          const stationOrder = Array.isArray(payload?.station_order)
            ? payload.station_order
            : [];
          setSeoulStationOrder(stationOrder);
          setIsOutsideOperatingHours(payload?.is_operating_hours === false);

          trainListPrefetchCache.set(cacheKey, {
            apiTrains,
            stationOrder,
            fetchedAt: Date.now(),
          });

          mapped = mapSeoulApiTrains(apiTrains, stationOrder);
        }

        if (!active || seq !== requestSeq) return;

        if (!apiLine.startsWith("seoul")) {
          setSeoulStationOrder([]);
        }

        setTrains(mapped);
        setLastUpdatedAt(Date.now());
      } catch {
        if (!active || seq !== requestSeq) return;
        setIsOutsideOperatingHours(false);
      } finally {
        if (active && !silent) {
          setIsLoading(false);
        }
      }
    };

    void loadTrains();
    const timer = setInterval(() => {
      void loadTrains({ silent: true });
    }, TRAIN_LIST_REFRESH_MS);

    return () => {
      active = false;
      requestSeq += 1;
      clearInterval(timer);
    };
  }, [apiLine, station, currentStation, travelDirectionKey, line]);

  useEffect(() => {
    if (!lastUpdatedAt) return undefined;

    const tick = () => {
      const elapsed = Math.floor((Date.now() - lastUpdatedAt) / 1000);
      setSecondsUntilRefresh(
        Math.max(0, Math.floor(TRAIN_LIST_REFRESH_MS / 1000) - elapsed)
      );
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [lastUpdatedAt]);

  useEffect(() => {
    if (!selectedTrain?.id) return;
    const stillVisible = displayTrains.some((train) => train.id === selectedTrain.id);
    if (!stillVisible) {
      setSelectedTrain(null);
    }
  }, [displayTrains, selectedTrain?.id]);

  function handleTrainTap(train) {
    if (!train?.id || isMatching) return;
    setSelectedTrain((prev) => (prev?.id === train.id ? null : train));
  }

  function handleProceed() {
    if (!selectedTrain?.id || isMatching) return;
    onTrainPick?.(selectedTrain);
  }

  const lineColor = LINE_OLIVE;
  const lineColorLight = LINE_OLIVE_LIGHT;
  const directionLabel = (line || "").split("·")[1]?.trim() || "";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg }}>
      <div className="zeb-app-header">
        <button
          type="button"
          className="zeb-touch-target"
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
            color: C.text,
            fontSize: 20,
            lineHeight: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: MOBILE.touchMin,
            height: MOBILE.touchMin,
          }}
        >
          ←
        </button>
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <LineCircleBadge line={line} />
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>열차 선택</div>
        </div>
        <div
          style={{
            fontSize: 11,
            color: lineColor,
            fontWeight: 700,
            background: lineColorLight,
            borderRadius: 20,
            padding: "4px 10px",
            flexShrink: 0,
          }}
        >
          2 / 3
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: `12px ${MOBILE.pageX}px 0` }}>
        <div
          style={{
            padding: "14px 16px",
            borderRadius: 14,
            background: C.card,
            border: `1px solid ${C.border}`,
            lineHeight: 1.5,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>
              {currentStation
                ? formatStationDisplayName(currentStation)
                : "현재 역 확인 중"}
            </span>
            {station ? (
              <>
                <span style={{ color: C.muted, fontSize: 14 }}>→</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: lineColor }}>
                  {formatStationDisplayName(station)}
                </span>
              </>
            ) : null}
          </div>
          {directionLabel ? (
            <p style={{ margin: "8px 0 0", fontSize: 13, color: C.muted }}>{directionLabel}</p>
          ) : null}
        </div>

        <p style={{ margin: "14px 0 10px", fontSize: 13, color: C.muted, lineHeight: 1.5 }}>
          {currentStation
            ? `${formatStationDisplayName(currentStation)} 역 열차를 선택해 주세요`
            : "열차를 선택해 주세요"}
          {lastUpdatedAt ? (
            <span style={{ display: "block", marginTop: 4, fontSize: 12, color: lineColor }}>
              {secondsUntilRefresh}초 후 자동 갱신
            </span>
          ) : null}
        </p>

        {isLoading ? (
          <div style={{ color: C.muted, fontSize: 14, marginBottom: 10 }}>열차 불러오는 중…</div>
        ) : null}

        {!isLoading && directionHeading ? (
          <p
            style={{
              margin: "0 0 10px",
              fontSize: 15,
              fontWeight: 700,
              color: lineColor,
            }}
          >
            {directionHeading}
          </p>
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {displayTrains.map((train, index) => {
            const isSelected = selectedTrain?.id === train.id;
            return (
              <button
                key={train.id}
                type="button"
                disabled={isMatching}
                onClick={() => handleTrainTap(train)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "16px",
                  borderRadius: 14,
                  border: `2px solid ${isSelected ? lineColor : C.border}`,
                  background: isSelected ? lineColorLight : C.card,
                  cursor: isMatching ? "default" : "pointer",
                  opacity: isMatching ? 0.55 : 1,
                  boxShadow: isSelected
                    ? `0 2px 10px ${lineColorLight}`
                    : "0 2px 8px rgba(26, 26, 26, 0.04)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 12,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 28,
                        fontWeight: 800,
                        color: lineColor,
                        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                        letterSpacing: "-0.5px",
                        lineHeight: 1.1,
                      }}
                    >
                      {train.id}
                    </div>
                    <div
                      style={{
                        marginTop: 6,
                        fontSize: 14,
                        color: lineColor,
                        fontWeight: 700,
                      }}
                    >
                      {formatTrainArrivalLabel(train)}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 13, color: C.text, fontWeight: 600 }}>
                      {resolveTrainDirectionEtaFromMapped(train)}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 12, color: C.muted }}>
                      {train.direction}
                      {train.current && train.current !== "정보 없음"
                        ? ` · ${formatStationDisplayName(train.current)}`
                        : ""}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: index === 0 ? lineColor : C.muted,
                      background: index === 0 ? lineColorLight : "#F0F4F8",
                      borderRadius: 999,
                      padding: "4px 10px",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    {formatTrainArrivalBadge(train, index)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {!isLoading && displayTrains.length === 0 ? (
          <div
            style={{
              marginTop: 14,
              padding: isOutsideOperatingHours ? "14px 16px" : 0,
              borderRadius: isOutsideOperatingHours ? 14 : 0,
              border: isOutsideOperatingHours ? `1px solid ${lineColorLight}` : "none",
              background: isOutsideOperatingHours ? lineColorLight : "transparent",
              color: isOutsideOperatingHours ? lineColor : C.muted,
              fontSize: 14,
              fontWeight: isOutsideOperatingHours ? 700 : 400,
              lineHeight: 1.5,
              textAlign: "center",
            }}
            role={isOutsideOperatingHours ? "alert" : undefined}
          >
            {isOutsideOperatingHours
              ? SUBWAY_OUTSIDE_OPERATING_HOURS_MESSAGE
              : "현재 열차 정보가 없습니다"}
          </div>
        ) : null}
      </div>

      <div
        style={{
          padding: `12px ${MOBILE.pageX}px max(24px, env(safe-area-inset-bottom))`,
          background: C.card,
          borderTop: `1px solid ${C.border}`,
        }}
      >
        <button
          type="button"
          className="zeb-touch-target"
          onClick={handleProceed}
          disabled={!selectedTrain || isMatching}
          style={{
            width: "100%",
            minHeight: MOBILE.touchMin,
            padding: "12px 0",
            background: selectedTrain && !isMatching ? lineColor : "#D1D5DB",
            color: "#fff",
            border: "none",
            borderRadius: 12,
            fontSize: 16,
            fontWeight: 700,
            cursor: selectedTrain && !isMatching ? "pointer" : "default",
            transition: "background 0.2s",
          }}
        >
          다음 — {mode === "leave" ? "좌석 선택" : "출입문 선택"}
        </button>
      </div>
    </div>
  );
}

/** seek Step 3: 호차 + 좌석 배치도(맵 우선) → 결과 확인 */
function StepSeekDoor({
  line,
  station,
  currentStation,
  trainId,
  lineNumber,
  direction,
  drtnInfo,
  onNext,
  onBack,
  isSubmitting = false,
}) {
  const layout = resolveCarLayout(line);
  const carNumbers = Array.from({ length: layout.carCount }, (_, index) => index + 1);
  const [activeCar, setActiveCar] = useState(1);
  const [selectedSeat, setSelectedSeat] = useState(null);
  const mapShellRef = useRef(null);
  const lineColor = LINE_OLIVE;

  const pickPreview = selectedSeat
    ? buildSeekPickFromSeatInfo(selectedSeat, station, activeCar)
    : null;

  useLayoutEffect(() => {
    if (!mapShellRef.current) return;
    applySeekSeatMapShellLayout(mapShellRef.current);
  }, [activeCar, selectedSeat, trainId, station, direction, drtnInfo, lineNumber]);

  function handleSeatClick(seat) {
    if (isSubmitting) return;
    setSelectedSeat(seat);
  }

  function handleConfirm() {
    if (!selectedSeat || isSubmitting || !pickPreview?.doorLabel) return;

    const mapped = mapSeekSelectionToSubmission({
      car: pickPreview.car,
      door: pickPreview.door,
      doorLabel: pickPreview.doorLabel,
      side: pickPreview.side,
      seatLetter: pickPreview.seatLetter,
      lineLabel: line,
    });

    onNext({
      car: pickPreview.car,
      door: pickPreview.door,
      doorLabel: pickPreview.doorLabel,
      side: pickPreview.side,
      seatLetter: pickPreview.seatLetter,
      pickResultLine: pickPreview.pickResultLine,
      seat: {
        ...selectedSeat,
        car: pickPreview.car,
        door: pickPreview.door,
        doorLabel: pickPreview.doorLabel,
        side: pickPreview.side,
        seatLetter: pickPreview.seatLetter,
        pickResultLine: pickPreview.pickResultLine,
        seatSide: mapped?.seatSide ?? selectedSeat?.seatSide,
        seatNumber: mapped?.seatNumber ?? selectedSeat?.seatNumber,
      },
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg }}>
      <Header step={3} onBack={onBack} title="현재 서 있는 위치" line={line} />

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          padding: `0 ${MOBILE.pageX}px`,
          position: "relative",
        }}
      >
        {isSubmitting ? <SubmitSkeletonOverlay /> : null}

        <div style={{ margin: "8px 0 12px", textAlign: "center" }}>
          <p
            style={{
              margin: 0,
              fontSize: 26,
              fontWeight: 800,
              color: C.text,
              lineHeight: 1.25,
              letterSpacing: "-0.4px",
            }}
          >
            {formatDestinationDirectionTitle(station, direction)}
          </p>
          <p style={{ margin: "6px 0 0", fontSize: 12, fontWeight: 600, color: C.muted }}>
            호차를 선택해 주세요
          </p>
        </div>

        <div style={{ marginBottom: 10 }}>
          <CarNumberSlider
            carNumbers={carNumbers}
            activeCar={activeCar}
            disabled={isSubmitting}
            lineColor={lineColor}
            onSelect={(carNum) => {
              setActiveCar(carNum);
              setSelectedSeat(null);
            }}
          />
        </div>

        <div
          ref={mapShellRef}
          className="zeb-seek-seat-map-shell zeb-no-scrollbar"
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            WebkitOverflowScrolling: "touch",
            touchAction: "pan-x pan-y",
            background: C.card,
            borderRadius: 12,
            border: `1px solid ${C.border}`,
            scrollbarWidth: "none",
            msOverflowStyle: "none",
          }}
        >
          {!trainId ? (
            <p
              style={{
                padding: "32px 16px",
                textAlign: "center",
                fontSize: 14,
                color: C.muted,
                lineHeight: 1.5,
              }}
            >
              이전 단계에서 열차를 선택한 뒤 다시 시도해 주세요.
            </p>
          ) : (
            <SubwaySeatMap
              key={`seek-seat-${trainId}-${activeCar}-${line}`}
              line={line}
              station={station || currentStation || ""}
              trainNo={trainId}
              lineNumber={lineNumber}
              direction={direction}
              drtnInfo={drtnInfo}
              car={activeCar}
              interactionMode="seek"
              selectedSeatId={selectedSeat?.id}
              onSeatClick={handleSeatClick}
            />
          )}
        </div>
      </div>

      <div
        style={{
          flexShrink: 0,
          padding: `12px ${MOBILE.pageX}px max(20px, env(safe-area-inset-bottom))`,
          background: C.card,
          borderTop: `1px solid ${C.border}`,
          boxShadow: "0 -4px 16px rgba(0,0,0,0.06)",
        }}
      >
        {pickPreview?.pickResultLine ? (
          <p
            style={{
              margin: "0 0 10px",
              fontSize: 16,
              fontWeight: 800,
              color: lineColor,
              textAlign: "center",
              lineHeight: 1.45,
            }}
          >
            {pickPreview.pickResultLine}
          </p>
        ) : (
          <p style={{ margin: "0 0 10px", fontSize: 13, color: C.muted, textAlign: "center" }}>
            지금 서 있는 칸을 눌러 주세요
          </p>
        )}
        <button
          type="button"
          className="zeb-touch-target"
          onClick={handleConfirm}
          disabled={!pickPreview?.pickResultLine || isSubmitting}
          aria-busy={isSubmitting || undefined}
          style={{
            width: "100%",
            minHeight: MOBILE.touchMin,
            padding: "12px 0",
            background: pickPreview?.pickResultLine && !isSubmitting ? lineColor : "#D1D5DB",
            color: "#fff",
            border: "none",
            borderRadius: 12,
            fontSize: 17,
            fontWeight: 700,
            cursor: pickPreview?.pickResultLine && !isSubmitting ? "pointer" : "default",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          {isSubmitting ? <LoadingSpinner /> : null}
          {pickPreview?.pickResultLine ? "네, 맞아요" : "위치를 눌러 주세요"}
        </button>
        {pickPreview?.pickResultLine ? (
          <button
            type="button"
            className="zeb-touch-target"
            disabled={isSubmitting}
            onClick={() => setSelectedSeat(null)}
            style={{
              width: "100%",
              marginTop: 8,
              padding: "8px 0",
              background: "none",
              border: "none",
              color: C.muted,
              fontSize: 14,
              fontWeight: 600,
              textDecoration: "underline",
              cursor: isSubmitting ? "default" : "pointer",
            }}
          >
            다시 고르기
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ─── Step 3 (leave): 호차 + 좌석 선택 (seek Step 3 UI와 동일) ─────────
function StepSeat({
  line,
  station,
  trainId,
  lineNumber,
  direction,
  drtnInfo,
  currentStation,
  onNext,
  onBack,
  isSubmitting = false,
}) {
  const layout = resolveCarLayout(line);
  const isSeoulLine = isSeoulLineFromLineProp(line);
  const requireSeatOnLeave = isSeoulLine;
  const carNumbers = Array.from({ length: layout.carCount }, (_, index) => index + 1);
  const [activeCar, setActiveCar] = useState(1);
  const [selectedSeat, setSelectedSeat] = useState(null);
  const mapShellRef = useRef(null);
  const lineColor = LINE_OLIVE;

  const pickPreview = selectedSeat
    ? buildSeekPickFromSeatInfo(selectedSeat, station, activeCar)
    : null;

  const confirmEnabled = requireSeatOnLeave
    ? Boolean(pickPreview?.pickResultLine) && !isSubmitting
    : Boolean(activeCar) && !isSubmitting;

  useLayoutEffect(() => {
    if (!mapShellRef.current || !isSeoulLine) return;
    applySeekSeatMapShellLayout(mapShellRef.current);
  }, [activeCar, selectedSeat, trainId, station, direction, drtnInfo, lineNumber, isSeoulLine]);

  function handleSeatClick(seat) {
    if (isSubmitting) return;
    setSelectedSeat(seat);
  }

  function handleConfirm() {
    if (isSubmitting) return;
    if (!requireSeatOnLeave) {
      if (!activeCar) return;
      onNext({ car: activeCar, seat: null });
      return;
    }
    if (!selectedSeat || !pickPreview?.doorLabel) return;

    const mapped = mapSeekSelectionToSubmission({
      car: pickPreview.car,
      door: pickPreview.door,
      doorLabel: pickPreview.doorLabel,
      side: pickPreview.side,
      seatLetter: pickPreview.seatLetter,
      lineLabel: line,
    });

    onNext({
      car: pickPreview.car ?? activeCar,
      seat: {
        ...selectedSeat,
        car: pickPreview.car,
        door: pickPreview.door,
        doorLabel: pickPreview.doorLabel,
        side: pickPreview.side,
        seatLetter: pickPreview.seatLetter,
        pickResultLine: pickPreview.pickResultLine,
        seatSide: mapped?.seatSide ?? selectedSeat?.seatSide,
        seatNumber: mapped?.seatNumber ?? selectedSeat?.seatNumber,
      },
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg }}>
      <Header step={3} onBack={onBack} title="현재 앉은 위치" line={line} />

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          padding: `0 ${MOBILE.pageX}px`,
          position: "relative",
        }}
      >
        {isSubmitting ? <SubmitSkeletonOverlay /> : null}

        <div style={{ margin: "8px 0 12px", textAlign: "center" }}>
          <p
            style={{
              margin: 0,
              fontSize: 26,
              fontWeight: 800,
              color: C.text,
              lineHeight: 1.25,
              letterSpacing: "-0.4px",
            }}
          >
            {formatDestinationDirectionTitle(station, direction)}
          </p>
          <p style={{ margin: "6px 0 0", fontSize: 12, fontWeight: 600, color: C.muted }}>
            호차를 선택해 주세요
          </p>
        </div>

        <div style={{ marginBottom: 10 }}>
          <CarNumberSlider
            carNumbers={carNumbers}
            activeCar={activeCar}
            disabled={isSubmitting}
            lineColor={lineColor}
            onSelect={(carNum) => {
              setActiveCar(carNum);
              setSelectedSeat(null);
            }}
          />
        </div>

        <div
          ref={mapShellRef}
          className="zeb-seek-seat-map-shell zeb-no-scrollbar"
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            WebkitOverflowScrolling: "touch",
            touchAction: "pan-x pan-y",
            background: C.card,
            borderRadius: 12,
            border: `1px solid ${C.border}`,
            scrollbarWidth: "none",
            msOverflowStyle: "none",
          }}
        >
          {!trainId ? (
            <p
              style={{
                padding: "32px 16px",
                textAlign: "center",
                fontSize: 14,
                color: C.muted,
                lineHeight: 1.5,
              }}
            >
              이전 단계에서 열차를 선택한 뒤 다시 시도해 주세요.
            </p>
          ) : !isSeoulLine ? (
            <p
              style={{
                padding: "32px 16px",
                textAlign: "center",
                fontSize: 14,
                color: C.muted,
                lineHeight: 1.5,
              }}
            >
              인천 노선은 호차 번호만 선택하면 등록할 수 있어요
            </p>
          ) : (
            <SubwaySeatMap
              key={`leave-seat-${trainId}-${activeCar}-${line}`}
              line={line}
              station={station || currentStation || ""}
              trainNo={trainId}
              lineNumber={lineNumber}
              direction={direction}
              drtnInfo={drtnInfo}
              car={activeCar}
              interactionMode="seek"
              selectedSeatId={selectedSeat?.id}
              onSeatClick={handleSeatClick}
            />
          )}
        </div>
      </div>

      <div
        style={{
          flexShrink: 0,
          padding: `12px ${MOBILE.pageX}px max(20px, env(safe-area-inset-bottom))`,
          background: C.card,
          borderTop: `1px solid ${C.border}`,
          boxShadow: "0 -4px 16px rgba(0,0,0,0.06)",
        }}
      >
        {pickPreview?.pickResultLine ? (
          <p
            style={{
              margin: "0 0 10px",
              fontSize: 16,
              fontWeight: 800,
              color: lineColor,
              textAlign: "center",
              lineHeight: 1.45,
            }}
          >
            {pickPreview.pickResultLine}
          </p>
        ) : (
          <p style={{ margin: "0 0 10px", fontSize: 13, color: C.muted, textAlign: "center" }}>
            {requireSeatOnLeave ? "지금 앉으신 자리를 골라주세요" : "호차를 선택해 주세요"}
          </p>
        )}
        <button
          type="button"
          className="zeb-touch-target"
          onClick={handleConfirm}
          disabled={!confirmEnabled}
          aria-busy={isSubmitting || undefined}
          style={{
            width: "100%",
            minHeight: MOBILE.touchMin,
            padding: "12px 0",
            background: confirmEnabled ? lineColor : "#D1D5DB",
            color: "#fff",
            border: "none",
            borderRadius: 12,
            fontSize: 17,
            fontWeight: 700,
            cursor: confirmEnabled ? "pointer" : "default",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          {isSubmitting ? <LoadingSpinner /> : null}
          {pickPreview?.pickResultLine
            ? "네, 맞아요"
            : requireSeatOnLeave
              ? "위치를 눌러 주세요"
              : "하차 등록하기"}
        </button>
        {pickPreview?.pickResultLine ? (
          <button
            type="button"
            className="zeb-touch-target"
            disabled={isSubmitting}
            onClick={() => setSelectedSeat(null)}
            style={{
              width: "100%",
              marginTop: 8,
              padding: "8px 0",
              background: "none",
              border: "none",
              color: C.muted,
              fontSize: 14,
              fontWeight: 600,
              textDecoration: "underline",
              cursor: isSubmitting ? "default" : "pointer",
            }}
          >
            다시 고르기
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** 완료 화면 출입문 라벨을 읽기 쉬운 문구로 변환 */
function formatDoneDoorFriendly(doorLabel, carNumber, doorNumber) {
  if (Number.isInteger(carNumber) && Number.isInteger(doorNumber)) {
    return `${carNumber}호차 ${doorNumber}번 출입문`;
  }
  const match = String(doorLabel || "").match(/^출?(\d+)-(\d+)$/);
  if (match) {
    return `${match[1]}호차 ${match[2]}번 출입문`;
  }
  return doorLabel || "-";
}

// ─── 완료 화면 ────────────────────────────────────────────────────
function StepDone({
  line,
  station,
  boardingStation,
  trainId,
  car,
  seat,
  matchedOnRegister = false,
  mode,
  onReset,
  onGoWaiting,
  onGoHome,
  onGoMatching,
}) {
  const isLeaveMode = mode === "leave";
  const resolvedCar = seat?.car ?? car;
  const resolvedDoor = seat?.door;
  const seekDoorLabel =
    seat?.doorLabel ||
    (resolvedCar && resolvedDoor ? formatExitDoorDisplayLabel(resolvedCar, resolvedDoor) : "");
  const doneDoorFriendly = formatDoneDoorFriendly(seekDoorLabel, resolvedCar, resolvedDoor);
  const doneSeatLabel = seat?.seatLetter ? `${seat.seatLetter}열` : "-";
  const doneDirectionLabel = seat?.side ? resolveSeekSideLabel(seat.side) : "-";
  const lineColor = LINE_OLIVE;

  const stationDisplayName = formatStationDisplayName(station);
  const boardingDisplayName = boardingStation ? formatStationDisplayName(boardingStation) : "";
  const detailSummaryParts = [
    trainId ? `${trainId}호 열차` : null,
    doneDoorFriendly !== "-" ? doneDoorFriendly : null,
    doneSeatLabel !== "-" ? doneSeatLabel : null,
    doneDirectionLabel !== "-" ? doneDirectionLabel : null,
  ].filter(Boolean);
  const detailSummaryLine = detailSummaryParts.join(" · ");
  const routeLine =
    boardingDisplayName && stationDisplayName
      ? `${boardingDisplayName} → ${stationDisplayName}`
      : stationDisplayName || "";
  const statusHint =
    isLeaveMode && matchedOnRegister
      ? "매칭 화면에서 확인해 주세요"
      : onGoWaiting && (!isLeaveMode || !matchedOnRegister)
        ? "매칭 대기 화면에서 상태를 확인하세요"
        : "";
  const summaryLine = isLeaveMode
    ? matchedOnRegister
      ? "착석 희망자와 매칭됐어요"
      : `${stationDisplayName} 하차 예정으로 등록했어요`
    : `${stationDisplayName} 도착 전 알림을 보내드려요`;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        background: C.bg,
      }}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: `20px ${MOBILE.pageX}px 16px`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              background: lineColor,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
              color: "#fff",
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            ✓
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <LineCircleBadge line={line} size={32} />
              <h2
                style={{
                  margin: 0,
                  fontSize: 20,
                  fontWeight: 800,
                  color: C.text,
                  lineHeight: 1.2,
                }}
              >
                {isLeaveMode ? "하차 등록 완료" : "등록 완료"}
              </h2>
            </div>
            {statusHint ? (
              <p style={{ margin: "4px 0 0", fontSize: 12, color: C.muted, lineHeight: 1.45 }}>
                {statusHint}
              </p>
            ) : null}
          </div>
        </div>

        <div
          style={{
            padding: "16px",
            borderRadius: 16,
            border: `1px solid ${C.border}`,
            background: C.card,
          }}
        >
          {routeLine ? (
            <p
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 800,
                color: C.text,
                lineHeight: 1.35,
                textAlign: "center",
                wordBreak: "keep-all",
              }}
            >
              {routeLine}
            </p>
          ) : null}

          <p
            style={{
              margin: routeLine ? "10px 0 0" : 0,
              fontSize: 14,
              fontWeight: 600,
              color: C.muted,
              lineHeight: 1.5,
              textAlign: "center",
              wordBreak: "keep-all",
            }}
          >
            {summaryLine}
          </p>

          {detailSummaryLine ? (
            <>
              <div
                style={{
                  height: 1,
                  margin: "14px 0",
                  background: C.border,
                }}
              />
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  fontWeight: 600,
                  color: C.text,
                  lineHeight: 1.55,
                  textAlign: "center",
                  wordBreak: "keep-all",
                }}
              >
                {detailSummaryLine}
              </p>
            </>
          ) : null}
        </div>
      </div>

      <div
        style={{
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: `12px ${MOBILE.pageX}px max(16px, env(safe-area-inset-bottom))`,
          borderTop: `1px solid ${C.border}`,
          background: C.card,
        }}
      >
        {isLeaveMode && matchedOnRegister && onGoMatching ? (
          <button
            type="button"
            className="zeb-touch-target"
            onClick={onGoMatching}
            style={{
              width: "100%",
              padding: "12px 16px",
              minHeight: MOBILE.touchMin,
              background: lineColor,
              color: "#fff",
              border: "none",
              borderRadius: 12,
              fontSize: 15,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            매칭 화면으로
          </button>
        ) : null}
        {onGoWaiting && (!isLeaveMode || !matchedOnRegister) ? (
          <button
            type="button"
            className="zeb-touch-target"
            onClick={onGoWaiting}
            style={{
              width: "100%",
              padding: "12px 16px",
              minHeight: MOBILE.touchMin,
              background: lineColor,
              color: "#fff",
              border: "none",
              borderRadius: 12,
              fontSize: 15,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            매칭 상태 보기
          </button>
        ) : null}
        {isLeaveMode && onGoHome ? (
          <button
            type="button"
            className="zeb-touch-target"
            onClick={onGoHome}
            style={{
              width: "100%",
              padding: "12px 16px",
              minHeight: MOBILE.touchMin,
              background: "#F7F8F2",
              color: "#5F6B2E",
              border: "1px solid #D5DDB8",
              borderRadius: 12,
              fontSize: 15,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            홈으로 가기
          </button>
        ) : null}
        <button
          type="button"
          className="zeb-touch-target"
          onClick={onReset}
          style={{
            width: "100%",
            padding: "12px 16px",
            minHeight: MOBILE.touchMin,
            background: "#F7F8F2",
            color: "#5F6B2E",
            border: "1px solid #D5DDB8",
            borderRadius: 12,
            fontSize: 15,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          다시 등록하기
        </button>
      </div>
    </div>
  );
}


// ─── 메인 ─────────────────────────────────────────────────────────
export default function BoardingRequest({ line = "서울 1호선 · 소요산 방면", mode = "seek" }) {
  const router = useRouter();
  const isLeaveMode = mode === "leave";
  const normalizedLine = normalizeLineLabel(line);
  const [step, setStep] = useState(1);
  const [station, setStation] = useState(null);
  const [trainId, setTrainId] = useState(null);
  const [trainDirection, setTrainDirection] = useState("하행");
  const [trainDrtnInfo, setTrainDrtnInfo] = useState("");
  const [trainCurrentStation, setTrainCurrentStation] = useState("");
  const [seatInfo, setSeatInfo] = useState(null);
  const [currentStationName, setCurrentStationName] = useState("");
  const [isDetectingBoardingStation, setIsDetectingBoardingStation] = useState(true);
  const [needsManualBoardingStation, setNeedsManualBoardingStation] = useState(false);
  const [boardingGpsMessage, setBoardingGpsMessage] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [voiceSeekDraft, setVoiceSeekDraft] = useState(null);
  const submitSeekFailureRef = useRef("");
  const lineNumber = resolveLineNumberFromLineProp(normalizedLine);

  // URL·props(호선/모드) 변경 시 단계·열차 선택을 초기화합니다.
  useEffect(() => {
    setStep(1);
    setStation(null);
    setTrainId(null);
    setTrainDirection("하행");
    setTrainDrtnInfo("");
    setTrainCurrentStation("");
    setSeatInfo(null);
    setSubmitError("");
    setIsSubmitting(false);
    setVoiceSeekDraft(null);
  }, [normalizedLine, mode]);

  // 탑승 화면 진입 시 역 목록을 미리 받아 두어 검색·열차 단계 지연을 줄입니다.
  useEffect(() => {
    void fetchStationsForLine(normalizedLine);
  }, [normalizedLine]);

  function applyBoardingGpsResult(result) {
    const gpsMessages = {
      out_of_range: "1km 이내 역이 없습니다. 현재 역을 직접 선택해 주세요.",
      denied: "위치 권한이 없습니다. 현재 역을 직접 선택해 주세요.",
      unsupported: "GPS를 사용할 수 없습니다. 현재 역을 직접 선택해 주세요.",
      no_coords: "역 좌표 정보가 없습니다. 현재 역을 직접 선택해 주세요.",
      weak: "GPS 신호가 약합니다. 현재 역을 직접 선택해 주세요.",
    };

    if (result?.stationName) {
      setCurrentStationName(result.stationName);
      setNeedsManualBoardingStation(false);
      setBoardingGpsMessage("");
      saveBoardingGpsLocation(normalizedLine, result.stationName, {
        within1km: true,
        distanceKmValue:
          typeof result.distanceKm === "number" ? result.distanceKm : null,
      });
      return;
    }

    setCurrentStationName("");
    setNeedsManualBoardingStation(true);
    setBoardingGpsMessage(
      gpsMessages[result?.reason] || "현재 역을 직접 선택해 주세요."
    );
  }

  function handleManualBoardingStationChange(stationName) {
    const trimmed = stationName?.trim();
    if (!trimmed) return;
    setCurrentStationName(trimmed);
    setNeedsManualBoardingStation(false);
    setBoardingGpsMessage("");
    saveBoardingGpsLocation(normalizedLine, trimmed, { within1km: false });
  }

  function handleClearBoardingStation() {
    setCurrentStationName("");
    setNeedsManualBoardingStation(true);
    setBoardingGpsMessage((prev) => prev || "현재 역을 직접 선택해 주세요.");
  }

  // GPS·캐시로 출발역(1km 이내 최근접) 자동 설정 — seek/leave 공통
  useEffect(() => {
    let active = true;
    setIsDetectingBoardingStation(true);
    setNeedsManualBoardingStation(false);
    setBoardingGpsMessage("");

    const finishDetect = (result) => {
      if (!active) return;
      applyBoardingGpsResult(result);
      setIsDetectingBoardingStation(false);
    };

    try {
      const raw = sessionStorage.getItem("boardingDetectedLocation");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          parsed?.within1km === true &&
          typeof parsed?.nearestStationName === "string" &&
          parsed.nearestStationName.trim() &&
          (!parsed?.lineLabel || parsed.lineLabel === normalizedLine) &&
          typeof parsed?.detectedAt === "number" &&
          Date.now() - parsed.detectedAt <= BOARDING_GPS_CACHE_TTL_MS
        ) {
          finishDetect({
            stationName: parsed.nearestStationName.trim(),
            reason: "ok",
            distanceKm:
              typeof parsed?.distanceKm === "number" ? parsed.distanceKm : null,
          });
          return () => {
            active = false;
          };
        }
      }
    } catch {
      // 캐시 파싱 실패 시 GPS로 재시도합니다.
    }

    void detectNearestStationFromGps(normalizedLine).then((result) => {
      if (!active) return;
      finishDetect(result);
    });

    return () => {
      active = false;
    };
  }, [normalizedLine]);

  async function submitSeekRequest(
    info,
    {
      afterVoice = false,
      trainIdOverride,
      stationOverride,
      trainDirectionOverride,
      trainCurrentStationOverride,
    } = {}
  ) {
    submitSeekFailureRef.current = "";

    const activeTrainId = trainIdOverride ?? trainId;
    const activeStation = stationOverride ?? station;
    const activeTrainDirection = trainDirectionOverride ?? trainDirection;
    const activeTrainCurrentStation = trainCurrentStationOverride ?? trainCurrentStation;

    const stopSubmitting = (message) => {
      if (message) {
        submitSeekFailureRef.current = message;
        setSubmitError(message);
      }
      setIsSubmitting(false);
      return false;
    };

    const token = localStorage.getItem("token");
    if (!token) {
      return stopSubmitting("로그인이 필요합니다.");
    }
    if (!activeTrainId || !info?.doorLabel || !activeStation) {
      return stopSubmitting("열차, 출입문, 어디까지 가세요?을 확인해 주세요.");
    }

    const mapped =
      info.seat?.seatSide && info.seat?.seatNumber
        ? {
            car: info.car ?? info.seat?.car,
            door: info.door ?? info.seat?.door,
            doorLabel: info.doorLabel,
            seatSide: info.seat.seatSide,
            seatNumber: info.seat.seatNumber,
          }
        : mapSeekDoorToSubmission(info.doorLabel, normalizedLine);
    if (!mapped?.seatSide || !mapped?.seatNumber) {
      return stopSubmitting("위치 정보를 변환할 수 없습니다.");
    }

    const seatApi = {
      seatSide: mapped.seatSide,
      seatNumber: mapped.seatNumber,
    };

    setSubmitError("");

    try {
      const stations = await fetchStationsForLine(normalizedLine);
      const destinationMeta = await lookupStationMeta(activeStation, normalizedLine);
      if (!destinationMeta?.stationCode) {
        return stopSubmitting("어디까지 가세요? 정보를 찾을 수 없습니다.");
      }

      const boardingName = activeTrainCurrentStation || currentStationName || "현재역";
      const boardingMeta =
        (await lookupStationMeta(boardingName, normalizedLine)) ?? {
          stationCode: `${resolveStationCodePrefixFromLineProp(normalizedLine)}-01`,
          stationName: boardingName,
          stationOrder: 1,
          stationIndex: 0,
        };

      const remainingStops = resolveRemainingStops(
        stations,
        boardingMeta,
        destinationMeta,
        normalizedLine,
        activeTrainDirection
      );

      const response = await fetch("/api/match-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          role: "seeker",
          train_id: activeTrainId,
          line_number: lineNumber,
          direction: normalizeDirectionForStorage(activeTrainDirection || "하행"),
          car_number: mapped.car,
          seat_side: seatApi.seatSide,
          seat_number: seatApi.seatNumber,
          destination_id: destinationMeta.stationCode,
          destination_name: destinationMeta.stationName || activeStation,
          boarding_station_id: boardingMeta.stationCode,
          boarding_station_name: boardingMeta.stationName || boardingName,
          remaining_stops: remainingStops,
        }),
      });

      let payload = null;
      try {
        payload = await response.json();
      } catch {
        return stopSubmitting("서버 응답을 처리할 수 없습니다.");
      }

      if (handleUnauthorizedResponse(response)) {
        setIsSubmitting(false);
        return false;
      }

      if (!response.ok || payload?.success === false) {
        return stopSubmitting(
          typeof payload?.error === "string" && payload.error.trim()
            ? payload.error
            : "착석 요청 등록에 실패했습니다."
        );
      }

      if (!payload?.data?.match_request_id) {
        return stopSubmitting("착석 요청 응답이 올바르지 않습니다.");
      }

      const draft = {
        role: "seeker",
        lineKey: resolveApiLineKeyFromLineProp(normalizedLine),
        lineLabel: normalizedLine,
        lineNumber,
        trainNo: activeTrainId,
        carNumber: mapped.car,
        direction: normalizeDirectionForStorage(activeTrainDirection || "하행"),
        boardingStationId: boardingMeta.stationCode,
        boardingStationName: boardingMeta.stationName,
        destinationId: destinationMeta.stationCode,
        destinationName: destinationMeta.stationName || activeStation,
        remainingStations: remainingStops,
        seatSide: seatApi.seatSide,
        seatNumber: seatApi.seatNumber,
        doorLabel: info.doorLabel,
      };

      try {
        sessionStorage.setItem("boardingDraft", JSON.stringify(draft));
        sessionStorage.setItem("waitingDraft", JSON.stringify(draft));
        sessionStorage.setItem("activeMatchRequestId", payload.data.match_request_id);
        sessionStorage.setItem("seekerMatchRequestRegistered", "true");
        if (payload.data.match_id) {
          sessionStorage.setItem("activeMatchId", payload.data.match_id);
        }
      } catch {
        // sessionStorage 실패 시에도 완료 화면은 표시합니다.
      }

      if (payload.data.matched && payload.data.match_id) {
        try {
          sessionStorage.setItem("activeMatchId", payload.data.match_id);
        } catch {
          // sessionStorage 실패 시 완료 화면으로 폴백합니다.
        }
        window.location.href = "/matching";
        return "matched";
      }

      if (afterVoice) {
        window.location.href = "/waiting";
        return "waiting";
      }

      setSeatInfo(info);
      setStep(4);
      return "done";
    } catch {
      return stopSubmitting("네트워크 오류가 발생했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitLeaveRequest(info) {
    const stopSubmitting = (message) => {
      if (message) {
        setSubmitError(message);
      }
      setIsSubmitting(false);
    };

    const token = localStorage.getItem("token");
    if (!token) {
      stopSubmitting("로그인이 필요합니다.");
      return;
    }
    if (!trainId || !info?.car) {
      stopSubmitting("열차 번호와 호차 번호를 확인해 주세요.");
      return;
    }
    if (!station?.trim()) {
      stopSubmitting("내릴 역(어디까지 가세요?)을 선택해 주세요.");
      return;
    }

    const layout = resolveCarLayout(normalizedLine);
    const seatApi =
      info.seat?.seatSide && info.seat?.seatNumber
        ? { seatSide: info.seat.seatSide, seatNumber: info.seat.seatNumber }
        : info.seat?.id
          ? mapSeatIdToApi(info.seat.id, layout.seatsPerSection)
          : null;

    if (isSeoulLineFromLineProp(normalizedLine) && !seatApi?.seatSide) {
      stopSubmitting("현재 서 있는 위치를 선택해 주세요.");
      return;
    }

    setSubmitError("");
    try {
      const lineNumber = resolveLineNumberFromLineProp(normalizedLine);
      const stations = await fetchStationsForLine(normalizedLine);
      const destinationMeta = await lookupStationMeta(station, normalizedLine);
      if (!destinationMeta?.stationCode) {
        stopSubmitting("어디까지 가세요? 정보를 찾을 수 없습니다.");
        return;
      }

      const boardingName = trainCurrentStation || currentStationName || "현재역";
      const boardingMeta =
        (await lookupStationMeta(boardingName, normalizedLine)) ?? {
          stationCode: `${resolveStationCodePrefixFromLineProp(normalizedLine)}-01`,
          stationName: boardingName,
          stationOrder: 1,
          stationIndex: 0,
        };

      if (
        Number.isFinite(boardingMeta.stationIndex) &&
        Number.isFinite(destinationMeta.stationIndex) &&
        boardingMeta.stationIndex === destinationMeta.stationIndex
      ) {
        stopSubmitting("어디까지 가세요?은 현재 역과 달라야 합니다.");
        return;
      }

      const remainingStops = resolveRemainingStops(
        stations,
        boardingMeta,
        destinationMeta,
        normalizedLine,
        trainDirection
      );

      const body = {
        role: "provider",
        train_id: trainId,
        line_number: lineNumber,
        direction: normalizeDirectionForStorage(trainDirection || "하행"),
        car_number: info.car,
        destination_id: destinationMeta.stationCode,
        destination_name: destinationMeta.stationName || station,
        remaining_stops: remainingStops,
        boarding_station_id: boardingMeta.stationCode,
        boarding_station_name: boardingMeta.stationName || boardingName,
      };
      if (seatApi?.seatSide && seatApi?.seatNumber) {
        body.seat_side = seatApi.seatSide;
        body.seat_number = seatApi.seatNumber;
      }

      const response = await fetch("/api/match-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        stopSubmitting("서버 응답을 처리할 수 없습니다.");
        return;
      }
      if (handleUnauthorizedResponse(response)) {
        setIsSubmitting(false);
        return;
      }
      if (!response.ok || payload?.success === false) {
        stopSubmitting(
          typeof payload?.error === "string" && payload.error.trim()
            ? payload.error
            : "하차 등록에 실패했습니다."
        );
        return;
      }
      if (!payload?.data?.match_request_id) {
        stopSubmitting("하차 등록 응답이 올바르지 않습니다.");
        return;
      }

      const providerDraft = {
        role: "provider",
        lineLabel: normalizedLine,
        lineNumber,
        trainNo: trainId,
        carNumber: info.car,
        direction: normalizeDirectionForStorage(trainDirection || "하행"),
        destinationId: destinationMeta.stationCode,
        destinationName: destinationMeta.stationName || station,
        remainingStations: remainingStops,
        seatSide: seatApi?.seatSide,
        seatNumber: seatApi?.seatNumber,
      };
      try {
        sessionStorage.setItem("boardingDraft", JSON.stringify(providerDraft));
        sessionStorage.setItem("providerRegistered", "true");
        sessionStorage.setItem("activeMatchRequestId", payload.data.match_request_id);
        if (payload.data.match_id) {
          sessionStorage.setItem("activeMatchId", payload.data.match_id);
        }
      } catch {
        // sessionStorage 실패 시 완료 화면만 표시합니다.
      }

      setSeatInfo({ ...info, matched: Boolean(payload.data.matched) });
      setStep(4);
    } catch {
      stopSubmitting("네트워크 오류가 발생했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const reset = () => {
    setStep(1);
    setStation(null);
    setTrainId(null);
    setTrainDirection("하행");
    setTrainDrtnInfo("");
    setTrainCurrentStation("");
    setSeatInfo(null);
    setSubmitError("");
    setIsSubmitting(false);
  };

  function goToWaiting() {
    if (typeof window !== "undefined") {
      window.location.href = "/waiting";
    }
  }

  function goToMatching() {
    if (typeof window !== "undefined") {
      window.location.href = "/matching";
    }
  }

  function goToMatching() {
    if (typeof window !== "undefined") {
      window.location.href = "/matching";
    }
  }

  /** 첫 단계·내릴게요 열차 단계에서 뒤로가기 → 홈 */
  function exitToHome() {
    router.push("/");
  }

  function handleBackFromStep2() {
    setStep(1);
  }

  function handleBackFromStep3() {
    setStep(2);
  }

  function buildSeekInfoFromVoiceDraft(draft) {
    if (!draft?.mapped?.seatSide || !draft?.mapped?.seatNumber) {
      return null;
    }
    return {
      car: draft.car,
      door: draft.door,
      doorLabel: draft.doorLabel,
      side: draft.side,
      seatLetter: draft.seatLetter,
      pickResultLine: buildSeekPickResultLine({
        station: draft.stationName,
        side: draft.side,
        car: draft.car,
        door: draft.door,
        seatLetter: draft.seatLetter,
      }),
      seat: {
        car: draft.car,
        door: draft.door,
        doorLabel: draft.doorLabel,
        side: draft.side,
        seatLetter: draft.seatLetter,
        seatSide: draft.mapped.seatSide,
        seatNumber: draft.mapped.seatNumber,
      },
    };
  }

  async function handleVoiceSeekRegister(draft) {
    if (!draft?.stationName || !draft?.mapped) {
      throw new Error("음성 등록 정보가 올바르지 않습니다.");
    }

    if (!currentStationName?.trim()) {
      throw new Error("출발역을 먼저 선택해 주세요. 직접 입력으로 전환해 출발지를 설정할 수 있습니다.");
    }

    setStation(draft.stationName);
    setSubmitError("");
    setIsSubmitting(true);

    try {
      const train = draft.selectedTrain;

      if (!train?.id) {
        throw new Error("탑승할 열차를 선택해 주세요.");
      }

      setTrainId(train.id);
      setTrainDirection(train.direction || "하행");
      setTrainDrtnInfo(resolveDrtnInfoFromDirectionDisplay(train.eta));
      setTrainCurrentStation(train.current || "");

      const info = buildSeekInfoFromVoiceDraft(draft);
      if (!info) {
        throw new Error("위치 정보를 변환할 수 없습니다.");
      }

      setVoiceSeekDraft(null);
      const outcome = await submitSeekRequest(info, {
        afterVoice: true,
        trainIdOverride: train.id,
        stationOverride: draft.stationName,
        trainDirectionOverride: train.direction || "하행",
        trainCurrentStationOverride: train.current || "",
      });
      if (outcome === false) {
        throw new Error(submitSeekFailureRef.current || "매칭 등록에 실패했습니다.");
      }
      return outcome;
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleTrainPick(train) {
    if (!train?.id || isSubmitting) {
      return;
    }

    setTrainId(train.id);
    setTrainDirection(train.direction || "하행");
    setTrainDrtnInfo(resolveDrtnInfoFromDirectionDisplay(train.eta));
    setTrainCurrentStation(train.current || "");
    setSubmitError("");

    if (!isLeaveMode && voiceSeekDraft) {
      const draft = voiceSeekDraft;
      setVoiceSeekDraft(null);
      const info = buildSeekInfoFromVoiceDraft(draft);
      if (info) {
        setIsSubmitting(true);
        void submitSeekRequest(info);
        return;
      }
    }

    setStep(3);
  }

  function handleVoiceModeChange(nextMode) {
    if (nextMode !== "seek" && nextMode !== "leave") return;
    if (nextMode === mode) return;

    const params = new URLSearchParams(
      typeof window !== "undefined" ? window.location.search : ""
    );
    const lineLabelParam = params.get("lineLabel");
    params.set("type", nextMode === "leave" ? "leave" : "seek");
    if (lineLabelParam?.trim()) {
      params.set("lineLabel", lineLabelParam.trim());
    } else {
      params.set("lineLabel", normalizedLine);
    }
    router.replace(`/boarding?${params.toString()}`);
  }

  return (
    <>
      <style>{`
        @keyframes zeb-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes zeb-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        .zeb-loading-spinner {
          animation: zeb-spin 0.65s linear infinite;
        }
        .zeb-loading-skeleton {
          background: linear-gradient(90deg, #E8EEF4 25%, #F4F7FA 50%, #E8EEF4 75%);
          background-size: 200% 100%;
          animation: zeb-shimmer 1.2s ease-in-out infinite;
        }
      `}</style>
    <div
      className="zeb-boarding-shell"
      style={{
      maxWidth: 390, margin: "0 auto",
      height: "100dvh", minHeight: 600,
      display: "flex", flexDirection: "column",
      fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif",
      background: C.card, overflow: "hidden",
      border: `1px solid ${C.border}`, borderRadius: 20,
      boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
      paddingLeft: `max(${MOBILE.pageX}px, env(safe-area-inset-left))`,
      paddingRight: `max(${MOBILE.pageX}px, env(safe-area-inset-right))`,
    }}>
      {step === 1 && (
        <StepFade stepKey={`step-1-${mode}`}>
        <StepStation
          line={normalizedLine}
          mode={mode}
          boardingStationName={currentStationName}
          isDetectingBoardingStation={isDetectingBoardingStation}
          needsManualBoardingStation={needsManualBoardingStation}
          boardingGpsMessage={boardingGpsMessage}
          onBoardingStationChange={handleManualBoardingStationChange}
          onBoardingStationClear={handleClearBoardingStation}
          onNext={(s) => {
            setStation(s);
            setStep(2);
          }}
          onBack={exitToHome}
          onParsedModeChange={handleVoiceModeChange}
          onVoiceSeekRegister={isLeaveMode ? undefined : handleVoiceSeekRegister}
        />
        </StepFade>
      )}
      {step === 2 && (
        <StepFade stepKey={`step-2-${mode}-${station ?? ""}`}>
        <StepTrain
          key={`${normalizedLine}-${mode}-${station ?? ""}-${currentStationName}`}
          line={normalizedLine}
          mode={mode}
          station={station}
          currentStation={currentStationName}
          isMatching={false}
          onTrainPick={handleTrainPick}
          onBack={handleBackFromStep2}
        />
        </StepFade>
      )}
      {step === 3 && (
        <StepFade stepKey={`step-3-${mode}-${trainId ?? ""}`}>
        {isLeaveMode ? (
          <StepSeat
            line={normalizedLine}
            station={station}
            trainId={trainId}
            lineNumber={lineNumber}
            direction={trainDirection}
            drtnInfo={trainDrtnInfo}
            currentStation={trainCurrentStation || currentStationName}
            isSubmitting={isSubmitting}
            onNext={(info) => {
              setSubmitError("");
              setIsSubmitting(true);
              void submitLeaveRequest(info);
            }}
            onBack={handleBackFromStep3}
          />
        ) : (
          <StepSeekDoor
            line={normalizedLine}
            station={station}
            currentStation={currentStationName}
            trainId={trainId}
            lineNumber={lineNumber}
            direction={trainDirection}
            drtnInfo={trainDrtnInfo}
            isSubmitting={isSubmitting}
            onNext={(info) => {
              setSubmitError("");
              setIsSubmitting(true);
              void submitSeekRequest(info);
            }}
            onBack={handleBackFromStep3}
          />
        )}
        </StepFade>
      )}
      {submitError ? (
        <p style={{ margin: "8px 16px", fontSize: 13, color: "#DC2626" }}>{submitError}</p>
      ) : null}
      {step === 4 && (
        <StepFade stepKey={`step-4-${mode}`}>
        <StepDone
          line={normalizedLine}
          station={station}
          boardingStation={currentStationName || trainCurrentStation}
          trainId={trainId}
          car={seatInfo?.car}
          seat={seatInfo?.seat}
          matchedOnRegister={seatInfo?.matched === true}
          mode={mode}
          onReset={reset}
          onGoWaiting={goToWaiting}
          onGoHome={isLeaveMode ? exitToHome : undefined}
          onGoMatching={isLeaveMode ? goToMatching : undefined}
        />
        </StepFade>
      )}
    </div>
    </>
  );
}
