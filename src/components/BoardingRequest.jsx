import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import SubwaySeatMap, { mapSeatIdToApi } from "@/components/SubwaySeatMap";
import { handleUnauthorizedResponse } from "@/lib/auth-client";
import { normalizeDirectionForStorage } from "@/lib/match-direction";

function resolveApiLineFromLineProp(lineLabel) {
  const seoulMatch = lineLabel.match(/서울\s*([1-9])호선/u);
  if (seoulMatch?.[1]) {
    return `seoul${seoulMatch[1]}`;
  }

  const incheonMatch = lineLabel.match(/인천\s*([12])호선/u);
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
  seoul7: { doorCount: 4, seatsPerSection: 7, prioritySeats: 3, carCount: 6 },
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

function resolveCarCountFromLineProp(lineLabel) {
  return resolveCarLayout(lineLabel).carCount;
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
const TRAIN_DISPLAY_LIMIT = 2;

/** 호선별 전체 출입문 목록 (예: 1-1 ~ 10-4) */
function buildSeekDoorGroups(lineLabel) {
  const layout = resolveCarLayout(lineLabel);
  return Array.from({ length: layout.carCount }, (_, carIndex) => {
    const car = carIndex + 1;
    const doors = Array.from({ length: layout.doorCount }, (_, doorIndex) => {
      const door = doorIndex + 1;
      return { label: `${car}-${door}`, car, door };
    });
    return { car, doors };
  });
}

/** seek 모드 출입문 라벨(2-1 등) → API 제출용 car / seat_side / seat_number */
function mapSeekDoorToSubmission(doorLabel, lineLabel) {
  const match = String(doorLabel || "").match(/^(\d+)-(\d+)$/);
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
    doorLabel,
    seatSide: seatApi.seatSide,
    seatNumber: seatApi.seatNumber,
  };
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

/** 현재 역 기준 표시할 열차 1~2대 (해당 역에 있는 열차 우선) */
function pickTrainsForCurrentStation(trains, currentStation) {
  if (!Array.isArray(trains) || trains.length === 0) {
    return [];
  }

  const target = normalizeStationLabel(currentStation);
  if (!target) {
    return trains.slice(0, TRAIN_DISPLAY_LIMIT);
  }

  const atCurrentStation = trains.filter(
    (train) => normalizeStationLabel(train.current) === target
  );
  if (atCurrentStation.length > 0) {
    return atCurrentStation.slice(0, TRAIN_DISPLAY_LIMIT);
  }

  return trains.slice(0, TRAIN_DISPLAY_LIMIT);
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
async function parseVoiceIntentWithApi(transcript) {
  const token = localStorage.getItem("token");
  const response = await fetch("/api/voice/parse", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ transcript }),
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
const C = {
  primary: "#1A56A0",
  primaryLight: "#E3F0FF",
  primaryBorder: "#90BEF0",
  bg: "#F8FAFC",
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

function formatStationDisplayName(stationName) {
  const name = (stationName || "").trim();
  if (!name) return "";
  return name.endsWith("역") ? name : `${name}역`;
}

// ─── 공통 컴포넌트 ────────────────────────────────────────────────
function Header({ step, onBack, title, line }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "14px 16px 10px",
      borderBottom: `1px solid ${C.border}`,
      background: C.card,
      position: "sticky", top: 0, zIndex: 10,
    }}>
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
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 1 }}>{line}</div>
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

function StepDots({ step }) {
  return (
    <div style={{ display: "flex", gap: 6, justifyContent: "center", padding: "12px 0 0" }}>
      {[1, 2, 3].map(i => (
        <div key={i} style={{
          width: i === step ? 20 : 6,
          height: 6,
          borderRadius: 3,
          background: i === step ? C.primary : C.border,
          transition: "width 0.2s",
        }} />
      ))}
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

function BottomButton({ label, onClick, disabled, loading = false }) {
  const isDisabled = disabled || loading;
  const displayLabel = loading ? "처리 중..." : label;

  return (
    <div style={{ padding: `12px ${MOBILE.pageX}px max(24px, env(safe-area-inset-bottom))`, background: C.card, borderTop: `1px solid ${C.border}` }}>
      <button
        type="button"
        className="zeb-touch-target"
        onClick={onClick}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        style={{
          width: "100%",
          minHeight: MOBILE.touchMin,
          padding: "12px 0",
          background: isDisabled ? "#C5D8EF" : C.primary,
          color: "#fff",
          border: "none",
          borderRadius: 12,
          fontSize: 16,
          fontWeight: 700,
          cursor: isDisabled ? "default" : "pointer",
          transition: "background 0.2s, opacity 0.2s",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          opacity: loading ? 0.92 : 1,
        }}
      >
        {loading ? <LoadingSpinner /> : null}
        {displayLabel}
      </button>
    </div>
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
  onNext,
  onBack,
  onParsedModeChange,
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [results, setResults] = useState([]);
  const [boardingQuery, setBoardingQuery] = useState("");
  const [boardingResults, setBoardingResults] = useState([]);
  const [searchError, setSearchError] = useState("");
  const [boardingSearchError, setBoardingSearchError] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isParsingVoice, setIsParsingVoice] = useState(false);
  const inputRef = useRef(null);
  const boardingInputRef = useRef(null);
  const apiLine = resolveApiLineFromLineProp(line);

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
      setVoiceError("목적지를 찾지 못했습니다. 역 이름을 다시 말씀해 주세요.");
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
        const parsed = await parseVoiceIntentWithApi(transcript);
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
    setSearchError("");
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
        setVoiceError("음성으로 받은 목적지를 처리하지 못했습니다.");
      }
    };

    void runPendingVoice();
    return () => {
      active = false;
    };
  }, [line, onNext]);

  function startVoiceSearch() {
    setVoiceError("");
    if (typeof window === "undefined") return;
    if (isParsingVoice) return;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceError("이 브라우저는 음성 입력을 지원하지 않습니다.");
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = "ko-KR";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      setIsListening(true);
      recognition.onresult = (event) => {
        const transcript = event.results?.[0]?.[0]?.transcript?.trim();
        if (transcript) {
          void processVoiceTranscript(transcript);
        }
      };
      recognition.onerror = () => {
        setVoiceError("음성을 인식하지 못했습니다. 다시 시도해 주세요.");
      };
      recognition.onend = () => {
        setIsListening(false);
      };
      recognition.start();
    } catch {
      setIsListening(false);
      setVoiceError("음성 입력을 시작할 수 없습니다.");
    }
  }

  useEffect(() => {
    let active = true;
    const trimmed = query.trim();

    const searchTerm = normalizeStationSearchTerm(trimmed);
    if (searchTerm.length < 1) {
      setResults([]);
      setSearchError("");
      return () => {
        active = false;
      };
    }

    if (!apiLine) {
      setResults([]);
      setSearchError("이 노선은 역 검색을 지원하지 않습니다.");
      return () => {
        active = false;
      };
    }

    const loadStations = async () => {
      setSearchError("");
      try {
        const stations = await fetchStationsForLine(line);
        if (!active) return;

        if (!stations) {
          setResults([]);
          setSearchError("역 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
          return;
        }

        const names = stations
          .map((row) => row?.name?.trim())
          .filter((name) => name && stationMatchesSearch(name, trimmed))
          .slice(0, 8);

        setResults(names);
        if (names.length === 0) {
          setSearchError("");
        }
      } catch {
        if (!active) return;
        setResults([]);
        setSearchError("역 검색 중 오류가 발생했습니다.");
      }
    };

    const debounceTimer = setTimeout(() => {
      void loadStations();
    }, 280);

    return () => {
      active = false;
      clearTimeout(debounceTimer);
    };
  }, [query, line, apiLine]);

  useEffect(() => {
    if (!needsManualBoardingStation) {
      setBoardingQuery("");
      setBoardingResults([]);
      setBoardingSearchError("");
      return;
    }

    let active = true;
    const trimmed = boardingQuery.trim();
    const searchTerm = normalizeStationSearchTerm(trimmed);
    if (searchTerm.length < 1) {
      setBoardingResults([]);
      setBoardingSearchError("");
      return () => {
        active = false;
      };
    }

    if (!apiLine) {
      setBoardingResults([]);
      setBoardingSearchError("이 노선은 역 검색을 지원하지 않습니다.");
      return () => {
        active = false;
      };
    }

    const loadBoardingStations = async () => {
      setBoardingSearchError("");
      try {
        const stations = await fetchStationsForLine(line);
        if (!active) return;
        if (!stations) {
          setBoardingResults([]);
          setBoardingSearchError("역 목록을 불러오지 못했습니다.");
          return;
        }
        const names = stations
          .map((row) => row?.name?.trim())
          .filter((name) => name && stationMatchesSearch(name, trimmed))
          .slice(0, 8);
        setBoardingResults(names);
      } catch {
        if (!active) return;
        setBoardingResults([]);
        setBoardingSearchError("역 검색 중 오류가 발생했습니다.");
      }
    };

    const debounceTimer = setTimeout(() => {
      void loadBoardingStations();
    }, 280);

    return () => {
      active = false;
      clearTimeout(debounceTimer);
    };
  }, [boardingQuery, line, apiLine, needsManualBoardingStation]);

  const canProceedToTrainStep =
    Boolean(selected) && Boolean(boardingStationName) && !isDetectingBoardingStation;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg }}>
      <Header
        step={1}
        onBack={onBack}
        title="목적지 선택"
        line={line}
      />
      <div style={{ flex: 1, overflow: "auto", padding: "16px 16px 0" }}>
        <StepDots step={1} />
        <div
          style={{
            marginTop: 16,
            padding: "10px 14px",
            borderRadius: 10,
            background: needsManualBoardingStation ? "#FFF7ED" : "#F0F4F8",
            border: `1px solid ${needsManualBoardingStation ? "#FDBA74" : C.border}`,
          }}
        >
          <p style={{ margin: 0, fontSize: 12, color: C.muted }}>현재 위치 (GPS 1km 이내)</p>
          <p style={{ margin: "4px 0 0", fontSize: 15, fontWeight: 700, color: C.text }}>
            {isDetectingBoardingStation
              ? "위치 확인 중…"
              : boardingStationName
                ? formatStationDisplayName(boardingStationName)
                : "자동 설정되지 않음"}
          </p>
          {needsManualBoardingStation && boardingGpsMessage ? (
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "#C2410C", lineHeight: 1.45 }}>
              {boardingGpsMessage}
            </p>
          ) : null}
        </div>

        {needsManualBoardingStation ? (
          <div style={{ marginTop: 12 }}>
            <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600, color: C.text }}>
              현재 역 직접 선택
            </p>
            <div style={{ position: "relative" }}>
              <input
                className="zeb-field"
                ref={boardingInputRef}
                value={boardingQuery}
                onChange={(e) => setBoardingQuery(e.target.value)}
                placeholder="현재 역 검색 (예: 신도림)"
                style={{
                  width: "100%",
                  padding: "13px 16px 13px 42px",
                  border: `1.5px solid ${boardingQuery ? C.primary : C.border}`,
                  borderRadius: 12,
                  fontSize: MOBILE.inputFontSize,
                  background: C.card,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  left: 14,
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontSize: 18,
                  color: C.muted,
                }}
              >
                📍
              </span>
            </div>
            {boardingSearchError ? (
              <p style={{ marginTop: 6, fontSize: 12, color: "#DC2626" }}>{boardingSearchError}</p>
            ) : null}
            {boardingResults.length > 0 ? (
              <div
                style={{
                  marginTop: 8,
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 12,
                  overflow: "hidden",
                }}
              >
                {boardingResults.map((station, i) => (
                  <button
                    key={`boarding-${station}`}
                    type="button"
                    className="zeb-touch-target"
                    onClick={() => {
                      onBoardingStationChange?.(station);
                      setBoardingQuery(station);
                    }}
                    style={{
                      width: "100%",
                      padding: "13px 16px",
                      minHeight: MOBILE.touchMin,
                      background:
                        boardingStationName === station ? C.primaryLight : C.card,
                      border: "none",
                      borderTop: i > 0 ? `1px solid ${C.border}` : "none",
                      textAlign: "left",
                      cursor: "pointer",
                      fontSize: MOBILE.inputFontSize,
                      color: boardingStationName === station ? C.primary : C.text,
                      fontWeight: boardingStationName === station ? 600 : 400,
                    }}
                  >
                    {formatStationDisplayName(station)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div style={{ marginTop: 12, position: "relative" }}>
          <input
            className="zeb-field"
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setSelected(null); }}
            placeholder={mode === "leave" ? "내릴 역 검색 (예: 강남)" : "목적지 검색 (예: 강남)"}
            style={{
              width: "100%", padding: "13px 16px 13px 42px",
              border: `1.5px solid ${query ? C.primary : C.border}`,
              borderRadius: 12, fontSize: MOBILE.inputFontSize,
              background: C.card, outline: "none",
              boxSizing: "border-box",
              transition: "border 0.2s",
            }}
          />
          <span style={{
            position: "absolute", left: 14, top: "50%",
            transform: "translateY(-50%)", fontSize: 18, color: C.muted,
          }}>🔍</span>
          {query && (
            <button onClick={() => { setQuery(""); setSelected(null); }} style={{
              position: "absolute", right: 12, top: "50%",
              transform: "translateY(-50%)",
              background: "#D0D0D0", border: "none",
              width: 20, height: 20, borderRadius: 10,
              fontSize: 12, color: "#fff", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>✕</button>
          )}
        </div>
        <button
          type="button"
          className="zeb-touch-target"
          onClick={startVoiceSearch}
          disabled={isListening || isParsingVoice}
          style={{
            marginTop: 8,
            width: "100%",
            minHeight: MOBILE.touchMin,
            padding: "10px 16px",
            borderRadius: 10,
            border: `1px solid ${C.border}`,
            background: isListening || isParsingVoice ? C.primaryLight : C.card,
            color: C.primary,
            fontSize: MOBILE.inputFontSize,
            fontWeight: 600,
            cursor: isListening || isParsingVoice ? "default" : "pointer",
          }}
        >
          {isListening
            ? "듣는 중..."
            : isParsingVoice
              ? "목적지 분석 중..."
              : "🎤 음성으로 목적지 입력"}
        </button>
        {voiceError ? (
          <p style={{ marginTop: 6, fontSize: 12, color: "#DC2626" }}>{voiceError}</p>
        ) : null}
        {searchError ? (
          <p style={{ marginTop: 6, fontSize: 12, color: "#DC2626" }}>{searchError}</p>
        ) : null}

        {/* 검색 결과 */}
        {results.length > 0 && (
          <div style={{
            marginTop: 8, background: C.card,
            border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden",
          }}>
            {results.map((station, i) => (
              <button
                key={station}
                type="button"
                className="zeb-touch-target"
                onClick={() => { setSelected(station); setQuery(station); }}
                style={{
                width: "100%", padding: "13px 16px",
                minHeight: MOBILE.touchMin,
                background: selected === station ? C.primaryLight : C.card,
                border: "none",
                borderTop: i > 0 ? `1px solid ${C.border}` : "none",
                textAlign: "left", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 10,
                fontSize: MOBILE.inputFontSize,
                color: selected === station ? C.primary : C.text,
                fontWeight: selected === station ? 600 : 400,
              }}>
                <span style={{
                  width: 28, height: 28, borderRadius: 8,
                  background: selected === station ? C.primary : "#F0F4F8",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, flexShrink: 0,
                  color: selected === station ? "#fff" : C.muted,
                }}>역</span>
                {formatStationDisplayName(station)}
              </button>
            ))}
          </div>
        )}

        {query.length >= 1 &&
          results.length === 0 &&
          !voiceError &&
          !isParsingVoice &&
          query.length <= 12 && (
          <div style={{ textAlign: "center", padding: "32px 0", color: C.muted, fontSize: 14 }}>
            &quot;{query}&quot;에 해당하는 역이 없어요
          </div>
        )}

        {!query && (
          <div style={{ textAlign: "center", padding: "40px 0 0", color: "#C0C0C0", fontSize: 13, lineHeight: 1.6 }}>
            {mode === "leave"
              ? "예: 강남에서 내려요 · 음성 또는 검색으로 내릴 역을 선택하세요"
              : "예: 강남 가고 싶어 · 음성 또는 검색으로 목적지를 선택하세요"}
          </div>
        )}
      </div>
      <BottomButton
        label="다음 — 열차 선택"
        onClick={() => onNext(selected)}
        disabled={!canProceedToTrainStep}
      />
    </div>
  );
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
  const apiLine = resolveApiLineFromLineProp(line);
  const displayTrains = pickTrainsForCurrentStation(trains, currentStation);

  useEffect(() => {
    if (!apiLine) {
      setTrains([]);
      return;
    }

    let active = true;

    const loadTrains = async ({ silent = false } = {}) => {
      if (!silent) {
        setIsLoading(true);
      }
      try {
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
        });
        if (!response.ok) {
          throw new Error("열차 API 호출 실패");
        }
        const payload = await response.json();
        const apiTrains = Array.isArray(payload?.trains) ? payload.trains : [];

        if (!active) return;

        const mapped = apiTrains
          .map((row) => ({
            id: row?.train_no ?? "",
            current: row?.station_name?.trim() || "정보 없음",
            eta: row?.direction_display?.trim() || "운행 정보",
            direction: row?.direction?.trim() || "하행",
          }))
          .filter((row) => row.id);

        setTrains(mapped);
        setLastUpdatedAt(Date.now());
      } catch {
        if (!active) return;
        if (!silent) {
          setTrains([]);
        }
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
      clearInterval(timer);
    };
  }, [apiLine, station, currentStation]);

  function handleTrainTap(train) {
    if (!train?.id || isMatching) return;
    onTrainPick?.(train);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg }}>
      <Header step={2} onBack={onBack} title="열차 선택" line={line} />
      <div style={{ flex: 1, overflow: "auto", padding: "16px 16px 24px" }}>
        <StepDots step={2} />
        <div
          style={{
            marginTop: 16,
            padding: "10px 14px",
            borderRadius: 10,
            background: "#F0F4F8",
            border: `1px solid ${C.border}`,
            fontSize: 13,
            color: C.text,
            lineHeight: 1.5,
          }}
        >
          <div>
            현재 역:{" "}
            <strong>
              {currentStation
                ? formatStationDisplayName(currentStation)
                : "확인 중"}
            </strong>
          </div>
          {station ? (
            <div style={{ marginTop: 4, color: C.muted }}>
              {mode === "leave" ? "내릴 역" : "목적지"}: <strong>{station}</strong>
            </div>
          ) : null}
        </div>

        <p style={{ margin: "14px 0 10px", fontSize: 13, color: C.muted }}>
          {currentStation
            ? `${formatStationDisplayName(currentStation)} 역 열차를 탭하면 좌석을 선택해요`
            : "열차를 탭하면 좌석을 선택해요"}
          {lastUpdatedAt ? (
            <span style={{ display: "block", marginTop: 4, fontSize: 12 }}>
              30초마다 자동 갱신
            </span>
          ) : null}
        </p>

        {isLoading ? (
          <div style={{ color: C.muted, fontSize: 14 }}>열차 불러오는 중…</div>
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {displayTrains.map((train) => (
            <button
              key={train.id}
              type="button"
              disabled={isMatching}
              onClick={() => handleTrainTap(train)}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "18px 16px",
                borderRadius: 14,
                border: `1.5px solid ${C.primary}`,
                background: C.card,
                cursor: isMatching ? "default" : "pointer",
                opacity: isMatching ? 0.55 : 1,
                boxShadow: "0 2px 8px rgba(11, 31, 75, 0.08)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: C.text }}>
                    {train.id}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 13, color: C.muted }}>
                    {train.eta}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: C.primary,
                    whiteSpace: "nowrap",
                  }}
                >
                  탭하여 좌석 선택
                </span>
              </div>
            </button>
          ))}
        </div>

        {!isLoading && displayTrains.length === 0 ? (
          <div style={{ marginTop: 14, color: C.muted, fontSize: 14, lineHeight: 1.5 }}>
            {currentStation
              ? `${formatStationDisplayName(currentStation)} 역 근처 열차가 없어요. 잠시 후 자동으로 다시 불러옵니다.`
              : "표시할 열차가 없어요."}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── Step 3 (seek): 출입문 선택 ────────────────────────────────────
function StepSeekDoor({ line, onNext, onBack, isSubmitting = false }) {
  const [selectedDoor, setSelectedDoor] = useState(null);
  const doorGroups = buildSeekDoorGroups(line);
  const layout = resolveCarLayout(line);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg }}>
      <Header step={3} onBack={onBack} title="출입문 선택" line={line} />
      <div style={{ flex: 1, overflow: "auto", padding: "16px 16px 0", position: "relative" }}>
        {isSubmitting ? <SubmitSkeletonOverlay /> : null}
        <StepDots step={3} />

        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 6, lineHeight: 1.5 }}>
            현재 몇 번 출입문 앞에 계세요?
          </div>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 16, lineHeight: 1.5 }}>
            {layout.carCount}개 호차 · 호차당 {layout.doorCount}개 출입문
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              paddingBottom: 8,
            }}
          >
            {doorGroups.map(({ car, doors }, groupIndex) => (
              <div key={car}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: C.muted,
                      letterSpacing: "-0.2px",
                    }}
                  >
                    {car}호차
                  </span>
                  <span
                    style={{
                      flex: 1,
                      height: 1,
                      background: groupIndex === 0 ? "transparent" : C.border,
                    }}
                  />
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${layout.doorCount}, minmax(0, 1fr))`,
                    gap: 8,
                  }}
                >
                  {doors.map(({ label }) => {
                    const isSelected = selectedDoor === label;
                    return (
                      <button
                        key={label}
                        type="button"
                        className="zeb-touch-target"
                        disabled={isSubmitting}
                        onClick={() => setSelectedDoor(label)}
                        style={{
                          minHeight: 48,
                          padding: "10px 4px",
                          borderRadius: 10,
                          border: `1.5px solid ${isSelected ? C.primary : C.border}`,
                          background: isSelected ? C.primaryLight : C.card,
                          color: isSelected ? C.primary : C.text,
                          fontSize: 15,
                          fontWeight: 700,
                          fontFamily: "'JetBrains Mono', monospace",
                          cursor: isSubmitting ? "default" : "pointer",
                          transition: "all 0.15s",
                          opacity: isSubmitting ? 0.55 : 1,
                          textAlign: "center",
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <BottomButton
        label={
          selectedDoor
            ? `${selectedDoor} 출입문 · 요청 등록하기`
            : "출입문을 선택해주세요"
        }
        onClick={() => {
          const mapped = mapSeekDoorToSubmission(selectedDoor, line);
          if (!mapped) return;
          onNext({
            doorLabel: selectedDoor,
            car: mapped.car,
            door: mapped.door,
            seat: {
              doorLabel: selectedDoor,
              car: mapped.car,
              door: mapped.door,
              seatSide: mapped.seatSide,
              seatNumber: mapped.seatNumber,
            },
          });
        }}
        disabled={!selectedDoor}
        loading={isSubmitting}
      />
    </div>
  );
}

// ─── Step 3 (leave): 호차 + 좌석 선택 ──────────────────────────────
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
  const isSeoulLine = isSeoulLineFromLineProp(line);
  const requireSeatOnLeave = isSeoulLine;
  const carCount = resolveCarCountFromLineProp(line);
  const carNumbers = Array.from({ length: carCount }, (_, index) => index + 1);
  const [selectedCar, setSelectedCar] = useState(null);
  const [selectedSeat, setSelectedSeat] = useState(null);

  useEffect(() => {
    setSelectedCar((prev) => (prev != null && prev > carCount ? null : prev));
    setSelectedSeat(null);
  }, [line, carCount]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg }}>
      <Header step={3} onBack={onBack} title="호차 · 좌석 선택" line={line} />
      <div style={{ flex: 1, overflow: "auto", padding: "16px 16px 0", position: "relative" }}>
        {isSubmitting ? <SubmitSkeletonOverlay /> : null}
        <StepDots step={3} />

        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>호차 선택</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {carNumbers.map((n) => (
              <button
                key={n}
                type="button"
                className="zeb-touch-target"
                disabled={isSubmitting}
                onClick={() => {
                  setSelectedCar(n);
                  setSelectedSeat(null);
                }}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  border: `1.5px solid ${selectedCar === n ? C.primary : C.border}`,
                  background: selectedCar === n ? C.primary : C.card,
                  color: selectedCar === n ? "#fff" : C.text,
                  fontSize: MOBILE.inputFontSize,
                  fontWeight: 700,
                  cursor: isSubmitting ? "default" : "pointer",
                  transition: "all 0.15s",
                  opacity: isSubmitting ? 0.55 : 1,
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {selectedCar && isSeoulLine ? (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>
              {selectedCar}번 호차 좌석 · 앉은 자리를 탭하세요
            </div>
            <SubwaySeatMap
              key={`${trainId}-${selectedCar}-leave`}
              line={line}
              station={station || currentStation || ""}
              trainNo={trainId}
              lineNumber={lineNumber}
              direction={direction}
              drtnInfo={drtnInfo}
              car={selectedCar}
              interactionMode="leave"
              selectedSeatId={selectedSeat?.id}
              onSeatClick={(seat) => setSelectedSeat((prev) => (prev?.id === seat.id ? null : seat))}
            />
          </div>
        ) : null}

        {!isSeoulLine ? (
          <div style={{ textAlign: "center", padding: "24px 0 0", color: "#7B8794", fontSize: 13 }}>
            인천 노선은 호차 번호만 선택하면 등록할 수 있어요
          </div>
        ) : null}
      </div>
      <BottomButton
        label={
          !selectedCar
            ? "호차를 먼저 선택해주세요"
            : requireSeatOnLeave && !selectedSeat
              ? "앉은 자리를 선택해주세요"
              : "하차 등록하기"
        }
        onClick={() => onNext({ car: selectedCar, seat: selectedSeat })}
        disabled={!selectedCar || (requireSeatOnLeave && !selectedSeat)}
        loading={isSubmitting}
      />
    </div>
  );
}

// ─── 완료 화면 ────────────────────────────────────────────────────
function StepDone({ line, station, trainId, car, seat, mode, onReset, onGoWaiting }) {
  const isLeaveMode = mode === "leave";
  const matchedOnRegister = seat?.matched === true;
  const seekDoorLabel =
    seat?.doorLabel || (seat?.car && seat?.door ? `${seat.car}-${seat.door}` : "");
  const seatLabel =
    seat?.car && seat?.door
      ? ` · ${seat.car}-${seat.door}번 문 옆`
      : "";
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", height: "100%", padding: 32, textAlign: "center",
      background: C.bg,
    }}>
      <div style={{
        width: 72, height: 72, borderRadius: 36,
        background: C.primaryLight, display: "flex",
        alignItems: "center", justifyContent: "center",
        fontSize: 36, marginBottom: 20,
      }}>✓</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 8 }}>
        {isLeaveMode ? "하차 등록 완료!" : "등록 완료!"}
      </div>
      <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.7, marginBottom: 32 }}>
        {line}<br />
        {isLeaveMode ? (
          <>
            열차 <strong style={{ color: C.text }}>{trainId}</strong> ·{" "}
            <strong style={{ color: C.text }}>{car}번 호차</strong>
            {seatLabel ? <>{seatLabel}</> : null}
          </>
        ) : (
          <>
            열차 <strong style={{ color: C.text }}>{trainId}</strong> ·{" "}
            <strong style={{ color: C.text }}>{seekDoorLabel || "출입문"}</strong> 출입문 앞
          </>
        )}
        <br />
        {isLeaveMode ? (
          <>
            <strong style={{ color: C.text }}>{formatStationDisplayName(station)}</strong>
            에서 하차 예정으로 등록했습니다.
            {matchedOnRegister ? (
              <>
                <br />
                <span style={{ fontSize: 13, color: C.muted }}>
                  착석 희망자와 매칭되었습니다. 상대방이 수락하면 완료됩니다.
                </span>
              </>
            ) : null}
          </>
        ) : (
          <><strong style={{ color: C.text }}>{station}역</strong> 하차 전 알림을 드릴게요</>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", maxWidth: 280 }}>
        {!isLeaveMode && onGoWaiting ? (
          <button
            type="button"
            className="zeb-touch-target"
            onClick={onGoWaiting}
            style={{
              padding: "13px 32px",
              minHeight: MOBILE.touchMin,
              background: C.primary,
              color: "#fff",
              border: "none",
              borderRadius: 12,
              fontSize: MOBILE.inputFontSize,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            매칭 대기 화면으로
          </button>
        ) : null}
        <button
          type="button"
          className="zeb-touch-target"
          onClick={onReset}
          style={{
            padding: "13px 32px",
            minHeight: MOBILE.touchMin,
            background: isLeaveMode ? C.primary : C.card,
            color: isLeaveMode ? "#fff" : C.text,
            border: isLeaveMode ? "none" : `1px solid ${C.border}`,
            borderRadius: 12,
            fontSize: MOBILE.inputFontSize,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          새로 요청하기
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

  async function submitSeekRequest(info) {
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
    if (!trainId || !info?.doorLabel || !station) {
      stopSubmitting("열차, 출입문, 하차역을 확인해 주세요.");
      return;
    }

    const mapped = mapSeekDoorToSubmission(info.doorLabel, normalizedLine);
    if (!mapped?.seatSide || !mapped?.seatNumber) {
      stopSubmitting("출입문 정보를 변환할 수 없습니다.");
      return;
    }

    const seatApi = {
      seatSide: mapped.seatSide,
      seatNumber: mapped.seatNumber,
    };

    setSubmitError("");

    try {
      const stations = await fetchStationsForLine(normalizedLine);
      const destinationMeta = await lookupStationMeta(station, normalizedLine);
      if (!destinationMeta?.stationCode) {
        stopSubmitting("하차역 정보를 찾을 수 없습니다.");
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

      const remainingStops = resolveRemainingStops(
        stations,
        boardingMeta,
        destinationMeta,
        normalizedLine,
        trainDirection
      );

      const response = await fetch("/api/match-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          role: "seeker",
          train_id: trainId,
          line_number: lineNumber,
          direction: normalizeDirectionForStorage(trainDirection || "하행"),
          car_number: mapped.car,
          seat_side: seatApi.seatSide,
          seat_number: seatApi.seatNumber,
          destination_id: destinationMeta.stationCode,
          destination_name: destinationMeta.stationName || station,
          boarding_station_id: boardingMeta.stationCode,
          boarding_station_name: boardingMeta.stationName || boardingName,
          remaining_stops: remainingStops,
        }),
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
            : "착석 요청 등록에 실패했습니다."
        );
        return;
      }

      if (!payload?.data?.match_request_id) {
        stopSubmitting("착석 요청 응답이 올바르지 않습니다.");
        return;
      }

      const draft = {
        role: "seeker",
        lineKey: resolveApiLineKeyFromLineProp(normalizedLine),
        lineLabel: normalizedLine,
        lineNumber,
        trainNo: trainId,
        carNumber: mapped.car,
        direction: normalizeDirectionForStorage(trainDirection || "하행"),
        boardingStationId: boardingMeta.stationCode,
        boardingStationName: boardingMeta.stationName,
        destinationId: destinationMeta.stationCode,
        destinationName: destinationMeta.stationName || station,
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
        return;
      }

      setSeatInfo(info);
      setStep(4);
    } catch {
      stopSubmitting("네트워크 오류가 발생했습니다.");
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
      stopSubmitting("내릴 역(하차역)을 선택해 주세요.");
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
      stopSubmitting("앉은 자리를 선택해 주세요.");
      return;
    }

    setSubmitError("");
    try {
      const lineNumber = resolveLineNumberFromLineProp(normalizedLine);
      const stations = await fetchStationsForLine(normalizedLine);
      const destinationMeta = await lookupStationMeta(station, normalizedLine);
      if (!destinationMeta?.stationCode) {
        stopSubmitting("하차역 정보를 찾을 수 없습니다.");
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
        stopSubmitting("하차역은 현재 역과 달라야 합니다.");
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

  function handleTrainPick(train) {
    if (!train?.id || isSubmitting) {
      return;
    }

    setTrainId(train.id);
    setTrainDirection(train.direction || "하행");
    setTrainDrtnInfo(resolveDrtnInfoFromDirectionDisplay(train.eta));
    setTrainCurrentStation(train.current || "");
    setSubmitError("");
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
          onNext={(s) => {
            setStation(s);
            setStep(2);
          }}
          onBack={exitToHome}
          onParsedModeChange={handleVoiceModeChange}
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
          trainId={trainId}
          car={seatInfo?.car}
          seat={seatInfo?.seat}
          mode={mode}
          onReset={reset}
          onGoWaiting={isLeaveMode ? undefined : goToWaiting}
        />
        </StepFade>
      )}
    </div>
    </>
  );
}
