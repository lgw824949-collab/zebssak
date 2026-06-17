"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatExitDoorDisplayLabel } from "@/lib/match-display";

/** LineSelect.jsx 노선색과 동일 */
const LINE_COLORS = {
  "서울 1호선": "#747F00",
  "서울 2호선": "#747F00",
  "서울 3호선": "#EF7C1C",
  "서울 4호선": "#00A5DE",
  "서울 5호선": "#996CAC",
  "서울 6호선": "#CD7C2F",
  "서울 7호선": "#747F00",
  "서울 8호선": "#E6186C",
  "서울 9호선": "#BDB092",
  "인천 1호선": "#759CCE",
  "인천 2호선": "#F5A200",
};

const LINE_COLOR_FALLBACK = "#747F00";
const ELDERLY_COLOR = "#FF8F00";
const ALIGHTING_BG_ALPHA = "26";
/** 통로 열·좌석 열 고정 폭 */
const SEAT_CELL = 40;
const AISLE_GAP = 20;
/** 출1-1 배지와 A~F 좌석이 같은 폭 열 안에서 가운데 정렬 */
const SIDE_COLUMN_WIDTH = 56;
const AISLE_SECTION_BADGE_FONT_SIZE = 13;

const PRIORITY = 3;
/** 좌석 구역 수 · 출입문 1-1 ~ 1-3 · 일반석 3구역 */
const SECTIONS = 3;

/** 호선별 객실 레이아웃 (P3: 3~9호선·인천 6호차·7석) */
const LINE_CAR_LAYOUT = {
  seoul1: { seatsPerSection: 8, carCount: 10 },
  seoul2: { seatsPerSection: 7, carCount: 10 },
  /** 서울 3호선: 6호차 */
  seoul3: { seatsPerSection: 7, carCount: 6 },
  seoul4: { seatsPerSection: 7, carCount: 6 },
  seoul5: { seatsPerSection: 7, carCount: 6 },
  seoul6: { seatsPerSection: 7, carCount: 6 },
  seoul7: { seatsPerSection: 7, carCount: 6 },
  seoul8: { seatsPerSection: 7, carCount: 6 },
  seoul9: { seatsPerSection: 7, carCount: 6 },
  incheon1: { seatsPerSection: 7, carCount: 6 },
  incheon2: { seatsPerSection: 7, carCount: 6 },
  defaultMetro: { seatsPerSection: 7, carCount: 6 },
};

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
  if (bare?.[1]) return `seoul${bare[1]}`;
  return "defaultMetro";
}

function resolveCarLayout(lineLabel) {
  const key = resolveLineLayoutKey(lineLabel);
  return LINE_CAR_LAYOUT[key] ?? LINE_CAR_LAYOUT.defaultMetro;
}

/** 호선별 호차 수 (BoardingRequest 호차 선택과 동일 기준) */
export function resolveLineCarCount(lineLabel) {
  return resolveCarLayout(lineLabel).carCount;
}

function resolveLineColor(lineLabel) {
  const compact = normalizeLineLabelCompact(lineLabel);
  const seoulMatch = compact.match(/^서울([1-9])호선$/u);
  if (seoulMatch?.[1]) {
    return LINE_COLORS[`서울 ${seoulMatch[1]}호선`] ?? LINE_COLOR_FALLBACK;
  }
  const incheonMatch = compact.match(/^인천([12])호선$/u);
  if (incheonMatch?.[1]) {
    return LINE_COLORS[`인천 ${incheonMatch[1]}호선`] ?? LINE_COLOR_FALLBACK;
  }
  const bare = compact.match(/^([1-9])호선$/u);
  if (bare?.[1]) {
    return LINE_COLORS[`서울 ${bare[1]}호선`] ?? LINE_COLOR_FALLBACK;
  }
  const spaced = (lineLabel || "").trim().replace(/\s+/g, " ");
  return LINE_COLORS[spaced] ?? LINE_COLOR_FALLBACK;
}

function resolveDirectionLabel(direction, drtnInfo) {
  const drtn = (drtnInfo || "").trim().replace(/역$/, "");
  if (drtn) return `${drtn} 방면`;
  const dir = (direction || "").trim();
  if (!dir) return "";
  return dir.includes("방면") ? dir : `${dir} 방면`;
}

function resolveQuickExitLineParam(lineLabel) {
  const compact = normalizeLineLabelCompact(lineLabel);
  const seoul = compact.match(/^서울([1-9])호선$/);
  if (seoul?.[1]) return `${seoul[1]}호선`;
  const incheon = compact.match(/^인천([12])호선$/);
  if (incheon?.[1]) return `${incheon[1]}호선`;
  return "";
}

function isIncheonLine(lineLabel) {
  return /^인천[12]호선$/.test(normalizeLineLabelCompact(lineLabel));
}

/** 출입문 사이 일반석 — 좌·우 각 6석, 측면마다 A~F 열 독립 */
const REGULAR_SEATS_PER_SIDE = 6;
const SIDE_SEAT_LETTERS = ["A", "B", "C", "D", "E", "F"];

/** 화면 위(출입문·목적지) → 아래: A~F (좌·우 각각 동일) */
function getSeatColumnLetter(visualRankFromTop) {
  return SIDE_SEAT_LETTERS[visualRankFromTop] ?? null;
}

export { formatExitDoorDisplayLabel } from "@/lib/match-display";

/** 입구 행 배지 — 노약자석↔A열 사이 */
function formatEntranceRowLabel(carNum, doorNo) {
  return formatExitDoorDisplayLabel(carNum, doorNo);
}

/** 출1-1 또는 1-1 → { car, door, doorLabel } */
export function parseDoorLabelKey(label) {
  const match = String(label || "").match(/^출?(\d+)-(\d+)$/);
  if (!match) return null;
  const car = Number.parseInt(match[1], 10);
  const door = Number.parseInt(match[2], 10);
  return { car, door, doorLabel: formatExitDoorDisplayLabel(car, door) };
}

/** 선택 좌석 표기 — 예: 1-1 · C열 · 좌측 */
function formatSelectedSeatLabel(car, door, columnLetter, side) {
  const sideLabel = side === "left" ? "좌측" : "우측";
  const col = columnLetter ? `${columnLetter}열` : "열 미지정";
  return `${formatExitDoorDisplayLabel(car, door)} · ${col} · ${sideLabel}`;
}

/** UI 방향 → 빠른하차 upbdnbSe (내선→상행, 외선→하행) */
function resolveQuickExitUpbdnbSe(direction, drtnInfo) {
  const d = (direction || "").trim();
  const drtn = (drtnInfo || "").trim();
  if (/내선/u.test(d) || /상행/u.test(d)) return "상행";
  if (/외선/u.test(d) || /하행/u.test(d)) return "하행";
  if (/상행/u.test(drtn)) return "상행";
  if (/하행/u.test(drtn)) return "하행";
  if (d === "1") return "상행";
  if (d === "2") return "하행";
  return d || "";
}

/** 좌석 그리드 id → API seat_side / seat_number */
export function mapSeatIdToApi(seatId, seatsPerSection) {
  const match = String(seatId || "").match(/^(left|right)-d(\d+)-s(\d+)$/);
  if (!match) return null;
  const side = match[1] === "left" ? "A" : "B";
  const door = Number.parseInt(match[2], 10);
  const seatInSection = Number.parseInt(match[3], 10);
  if (!Number.isInteger(door) || door < 1 || door > SECTIONS) return null;
  if (!Number.isInteger(seatInSection) || seatInSection < 0) return null;
  const seatNumber = (door - 1) * seatsPerSection + seatInSection + 1;
  return { seatSide: side, seatNumber };
}

function mapApiSeatToStatusKey(seatSide, seatNumber, seatsPerSection) {
  if (seatSide !== "A" && seatSide !== "B") return null;
  const side = seatSide === "A" ? "left" : "right";
  const index = seatNumber - 1;
  if (index < 0) return null;
  const door = Math.floor(index / seatsPerSection) + 1;
  const seatInSection = index % seatsPerSection;
  if (door < 1 || door > SECTIONS) return null;
  return `${side}-d${door}-s${seatInSection}`;
}

function createEmptySideSeats(seatsPerSection) {
  return Array.from({ length: SECTIONS * seatsPerSection }, () => "empty");
}

function applyAlightingToSeats(baseSeats, alightingKeys) {
  const next = [...baseSeats];
  for (const key of alightingKeys) {
    const match = key.match(/^(left|right)-d(\d+)-s(\d+)$/);
    if (!match) continue;
    const door = Number.parseInt(match[2], 10);
    const seatInSection = Number.parseInt(match[3], 10);
    const index = (door - 1) * (next.length / SECTIONS) + seatInSection;
    if (index >= 0 && index < next.length) {
      next[index] = "alighting";
    }
  }
  return next;
}

function Seat({
  side,
  status,
  lineColor,
  selected,
  recommended,
  onClick,
  seatLetter,
  interactionMode = "seek",
}) {
  const isAlighting = status === "alighting";
  const isElderly = status === "elderly";
  const selectable = canSelectSeatStatus(status, interactionMode);

  const fill = isElderly
    ? "rgba(255, 143, 0, 0.14)"
    : isAlighting
      ? `${lineColor}${ALIGHTING_BG_ALPHA}`
      : "#FFFFFF";
  const border = isElderly
    ? ELDERLY_COLOR
    : recommended
      ? "#F59E0B"
      : lineColor;
  const wallAccent = isElderly ? ELDERLY_COLOR : lineColor;
  const borderWidth = isElderly ? 1.5 : 1;
  const aisleEdgeBorder =
    side === "left"
      ? { borderRight: `2px solid ${wallAccent}` }
      : { borderLeft: `2px solid ${wallAccent}` };

  return (
    <button
      type="button"
      className="zeb-seat-btn"
      onClick={selectable ? onClick : undefined}
      style={{
        width: SEAT_CELL,
        height: SEAT_CELL,
        minWidth: SEAT_CELL,
        minHeight: SEAT_CELL,
        borderRadius: 6,
        background: fill,
        border: `${borderWidth}px solid ${border}`,
        ...aisleEdgeBorder,
        outline: selected ? `2px solid ${lineColor}` : "none",
        outlineOffset: 0,
        cursor: selectable ? "pointer" : "default",
        padding: 0,
        margin: 0,
        flexShrink: 0,
        boxSizing: "border-box",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: recommended ? "0 0 0 2px #F59E0B" : "none",
      }}
    >
      {seatLetter && !isElderly ? (
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "#475569",
            lineHeight: 1,
            letterSpacing: 0,
            userSelect: "none",
          }}
        >
          {seatLetter}
        </span>
      ) : null}
    </button>
  );
}

function PriorityBlock({ side, placement }) {
  return (
    <div
      style={{
        width: SEAT_CELL,
        maxWidth: SEAT_CELL,
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: 3,
        padding: placement === "top" ? "2px 0 4px" : "4px 0 2px",
        margin: 0,
        borderRadius: 6,
        background: "rgba(255, 143, 0, 0.1)",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      {placement === "top" ? (
        <span style={{ fontSize: 9, fontWeight: 700, color: ELDERLY_COLOR, lineHeight: 1.2 }}>
          노약자
        </span>
      ) : null}
      {Array.from({ length: PRIORITY }, (_, index) => (
        <Seat
          key={`el-${placement}-${index}`}
          side={side}
          status="elderly"
          lineColor={ELDERLY_COLOR}
        />
      ))}
      {placement === "bottom" ? (
        <span style={{ fontSize: 9, fontWeight: 700, color: ELDERLY_COLOR, lineHeight: 1.2 }}>
          노약자
        </span>
      ) : null}
    </div>
  );
}

/** 통로 열 구역 배지 (출1-1 등) — compact는 통로 폭 안에만 표시 */
function AisleSectionBadge({ label, lineColor, highlighted, compact = false }) {
  return (
    <span
      style={{
        fontSize: compact ? AISLE_SECTION_BADGE_FONT_SIZE : 16,
        fontWeight: 800,
        fontFamily: "var(--font-mono)",
        fontVariantNumeric: "tabular-nums",
        color: highlighted ? "#FFFFFF" : lineColor,
        background: highlighted ? "#F59E0B" : "#FFFFFF",
        padding: compact ? "5px 8px" : "6px 10px",
        borderRadius: compact ? 6 : 999,
        border: `2px solid ${highlighted ? "#F59E0B" : lineColor}`,
        lineHeight: 1.1,
        letterSpacing: 0,
        boxShadow: "0 1px 2px rgba(15, 23, 42, 0.08)",
        pointerEvents: "none",
        userSelect: "none",
        whiteSpace: "nowrap",
        textAlign: "center",
        display: "inline-block",
        boxSizing: "border-box",
      }}
    >
      {label}
    </span>
  );
}

/**
 * 지하철 호차 내 좌석 배치도
 * 구조: 노약자 → 출입문1-1 → A~F → 출입문1-2 → A~F → 출입문1-3 → A~F → 출입문1-4 → 노약자
 */
function canSelectSeatStatus(status, interactionMode) {
  if (status === "elderly") return false;
  if (interactionMode === "leave") return status === "empty";
  return status === "alighting" || status === "empty";
}

export default function SubwaySeatMap({
  line = "서울 2호선",
  station = "",
  direction = "",
  drtnInfo = "",
  trainNo = "",
  lineNumber = 2,
  car,
  carNumber,
  interactionMode = "seek",
  doorPickerMode = false,
  selectedDoorLabel = null,
  onDoorSelect,
  selectedSeatId,
  onSeatClick,
  onSeatSelect,
}) {
  const carLayout = useMemo(() => resolveCarLayout(line), [line]);
  const seatsPerSection = carLayout.seatsPerSection;
  const totalCars = carLayout.carCount;

  const lineColor = useMemo(() => resolveLineColor(line), [line]);
  const directionLabel = useMemo(
    () => resolveDirectionLabel(direction, drtnInfo),
    [direction, drtnInfo]
  );
  /** 위→아래 DOM 순서 = A→F */
  const regularSeatIndexOrder = useMemo(
    () => Array.from({ length: REGULAR_SEATS_PER_SIDE }, (_, i) => i),
    []
  );

  const controlledCar = Number.isInteger(car) && car > 0 ? car : null;
  const initialCar =
    controlledCar ?? (Number.isInteger(carNumber) && carNumber > 0 ? carNumber : 1);

  const [activeCar, setActiveCar] = useState(initialCar - 1);
  const [selectedSeat, setSelectedSeat] = useState(null);

  useEffect(() => {
    if (controlledCar != null) {
      setActiveCar(controlledCar - 1);
    }
  }, [controlledCar]);
  const [leftSeats, setLeftSeats] = useState(() => createEmptySideSeats(seatsPerSection));
  const [rightSeats, setRightSeats] = useState(() => createEmptySideSeats(seatsPerSection));
  const [carAlightingCount, setCarAlightingCount] = useState(0);
  const [quickExitHint, setQuickExitHint] = useState(null);
  const [alightingLoadError, setAlightingLoadError] = useState("");

  const carNum = activeCar + 1;
  // 부모(BoardingRequest)에서 car를 넘기면 호차 선택 UI는 상위에서만 표시합니다.
  const showCarTabs = totalCars > 1 && controlledCar == null;
  /** BoardingRequest Step 3 — 맵만, 중복 안내·노약자석 제외 */
  const seekEmbedMode = interactionMode === "seek" && controlledCar != null;
  /** 하차 등록 내장 모드 — 좌/우 텍스트 라벨 최소화 */
  const leaveEmbedMode = interactionMode === "leave" && controlledCar != null;
  const incheonLine = isIncheonLine(line);

  const loadAlighting = useCallback(async () => {
    if (!trainNo?.trim()) {
      setLeftSeats(createEmptySideSeats(seatsPerSection));
      setRightSeats(createEmptySideSeats(seatsPerSection));
      setCarAlightingCount(0);
      return;
    }

    try {
      const params = new URLSearchParams({
        train_no: trainNo.trim(),
        line_number: String(lineNumber),
        car_number: String(carNum),
      });
      if (direction?.trim()) {
        params.set("direction", direction.trim());
      }

      const response = await fetch(`/api/match-requests/alighting?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok || payload?.success === false) {
        setAlightingLoadError(
          typeof payload?.error === "string" ? payload.error : "하차 예정 좌석을 불러오지 못했습니다."
        );
        return;
      }

      setAlightingLoadError("");
      const seats = Array.isArray(payload?.data?.seats) ? payload.data.seats : [];
      const carCounts = Array.isArray(payload?.data?.car_counts) ? payload.data.car_counts : [];
      const countForCar =
        carCounts.find((row) => row?.car_number === carNum)?.count ?? seats.length;

      const keys = seats
        .map((row) => mapApiSeatToStatusKey(row.seat_side, row.seat_number, seatsPerSection))
        .filter(Boolean);

      setLeftSeats(
        applyAlightingToSeats(createEmptySideSeats(seatsPerSection), keys.filter((k) => k.startsWith("left")))
      );
      setRightSeats(
        applyAlightingToSeats(createEmptySideSeats(seatsPerSection), keys.filter((k) => k.startsWith("right")))
      );
      setCarAlightingCount(countForCar);
    } catch {
      setAlightingLoadError("하차 예정 좌석을 불러오지 못했습니다.");
    }
  }, [trainNo, lineNumber, carNum, direction, seatsPerSection]);

  useEffect(() => {
    if (doorPickerMode) return;
    void loadAlighting();
    const timer = setInterval(() => {
      void loadAlighting();
    }, 30000);
    return () => clearInterval(timer);
  }, [loadAlighting, doorPickerMode]);

  useEffect(() => {
    if (doorPickerMode) return;
    const stationName = (station || "").trim().replace(/역$/, "");
    if (!stationName || incheonLine) {
      setQuickExitHint(
        incheonLine && stationName
          ? { type: "info", text: "인천 지하철 빠른하차 데이터는 준비 중입니다." }
          : null
      );
      return;
    }

    const lineParam = resolveQuickExitLineParam(line);
    const upbdnbSe = resolveQuickExitUpbdnbSe(direction, drtnInfo);

    let active = true;

    const loadQuickExit = async () => {
      try {
        const params = new URLSearchParams({
          station: stationName,
          line: lineParam,
        });
        if (upbdnbSe) params.set("direction", upbdnbSe);
        if (drtnInfo?.trim()) params.set("drtn", drtnInfo.trim());

        const response = await fetch(`/api/quick-exit?${params.toString()}`, {
          cache: "no-store",
        });
        const payload = await response.json();
        if (!active) return;

        if (!response.ok || payload?.success === false) {
          setQuickExitHint(null);
          return;
        }

        let items = Array.isArray(payload?.items) ? payload.items : [];
        if (items.length === 0 && upbdnbSe) {
          const fallbackParams = new URLSearchParams({
            station: stationName,
            line: lineParam,
          });
          if (drtnInfo?.trim()) fallbackParams.set("drtn", drtnInfo.trim());
          const fallbackRes = await fetch(`/api/quick-exit?${fallbackParams.toString()}`, {
            cache: "no-store",
          });
          const fallbackPayload = await fallbackRes.json();
          if (fallbackRes.ok && fallbackPayload?.success) {
            items = Array.isArray(fallbackPayload?.items) ? fallbackPayload.items : [];
          }
        }

        const forCar = items.find((item) => item?.recommendedCar === carNum) ?? items[0];
        if (!forCar) {
          setQuickExitHint(null);
          return;
        }

        setQuickExitHint({
          type: "exit",
          car: forCar.recommendedCar,
          door: forCar.recommendedDoor,
          doorNo: forCar.qckgffVhclDoorNo,
          platform: forCar.plfmCmgFac,
        });
      } catch {
        if (active) setQuickExitHint(null);
      }
    };

    void loadQuickExit();
    return () => {
      active = false;
    };
  }, [station, line, direction, drtnInfo, carNum, incheonLine, doorPickerMode]);

  const recommendedDoor =
    quickExitHint?.type === "exit" && quickExitHint.car === carNum
      ? quickExitHint.door
      : null;

  const carRowStyle = useMemo(
    () => ({
      display: "flex",
      flexDirection: "row",
      justifyContent: "flex-start",
      alignItems: "center",
      width: "100%",
      gap: 0,
    }),
    []
  );

  /** 좌·우 열 사이 — 늘어나 우측 열을 컨테이너 오른쪽 끝에 붙임 */
  const renderFlexAisleSpacer = () => (
    <div style={{ flex: 1, minWidth: AISLE_GAP, flexShrink: 1 }} aria-hidden />
  );

  const renderEntranceBadge = (doorNo) =>
    !doorPickerMode ? (
      <AisleSectionBadge
        compact
        label={formatEntranceRowLabel(carNum, doorNo)}
        lineColor={lineColor}
        highlighted={recommendedDoor === doorNo}
      />
    ) : null;

  const renderSeatAt = (side, sectionIndex, seats, doorNo, visualRank, seatInSection) => {
    const idx = sectionIndex * seatsPerSection + seatInSection;
    const status = seats[idx] || "empty";
    const seatId = `${side}-d${doorNo}-s${seatInSection}`;
    const columnLetter = getSeatColumnLetter(visualRank);
    const isRecommended =
      recommendedDoor === doorNo &&
      ((side === "left" && seatInSection === 0) ||
        (side === "right" && seatInSection === REGULAR_SEATS_PER_SIDE - 1));

    return (
      <Seat
        key={seatId}
        side={side}
        status={status}
        lineColor={lineColor}
        selected={selectedSeatId === seatId}
        recommended={isRecommended}
        seatLetter={columnLetter}
        interactionMode={interactionMode}
        onClick={() => {
          if (doorPickerMode) return;
          if (!canSelectSeatStatus(status, interactionMode)) return;
          const api = mapSeatIdToApi(seatId, seatsPerSection);
          const info = {
            id: seatId,
            car: carNum,
            door: doorNo,
            side,
            status,
            seatSide: api?.seatSide,
            seatNumber: api?.seatNumber,
            seatColumn: columnLetter,
            seatLetter: columnLetter,
            seatLabel: formatSelectedSeatLabel(carNum, doorNo, columnLetter, side),
          };
          setSelectedSeat(info);
          onSeatClick?.(info);
          onSeatSelect?.(info);
        }}
      />
    );
  };

  /**
   * 하차 모드: 가운데 섹션(1-1/1-2/1-3) 클릭 시
   * 해당 구역 C열을 자동 선택해 하단 선택 텍스트와 연결
   */
  const handleCenterSectionPick = (doorNo) => {
    if (doorPickerMode) return;
    if (interactionMode !== "leave" && interactionMode !== "seek") return;
    const sectionIndex = Math.max(0, doorNo - 1);
    const preferredSide = selectedSeat?.side === "right" ? "right" : "left";
    const sideOrder = preferredSide === "right" ? ["right", "left"] : ["left", "right"];
    const visualRankOrder = [2, 1, 3, 0, 4, 5]; // C 우선, 주변 열 순으로 선택

    let picked = null;
    for (const side of sideOrder) {
      const seats = side === "right" ? rightSeats : leftSeats;
      for (const visualRank of visualRankOrder) {
        const seatInSection = regularSeatIndexOrder[visualRank];
        const idx = sectionIndex * seatsPerSection + seatInSection;
        const status = seats[idx] || "empty";
        if (!canSelectSeatStatus(status, interactionMode)) continue;
        picked = { side, visualRank, seatInSection, status };
        break;
      }
      if (picked) break;
    }
    if (!picked) return;

    const seatId = `${picked.side}-d${doorNo}-s${picked.seatInSection}`;
    const columnLetter = getSeatColumnLetter(picked.visualRank);
    const api = mapSeatIdToApi(seatId, seatsPerSection);
    const info = {
      id: seatId,
      car: carNum,
      door: doorNo,
      side: picked.side,
      status: picked.status,
      seatSide: api?.seatSide,
      seatNumber: api?.seatNumber,
      seatColumn: columnLetter,
      seatLetter: columnLetter,
      seatLabel: formatSelectedSeatLabel(carNum, doorNo, columnLetter, side),
    };
    setSelectedSeat(info);
    onSeatClick?.(info);
    onSeatSelect?.(info);
  };

  const renderCenterSectionMarker = (doorNo) => (
    <button
      type="button"
      onClick={() => handleCenterSectionPick(doorNo)}
      aria-label={`${carNum}호차 ${doorNo}번 섹션 선택`}
      style={{
        fontSize: AISLE_SECTION_BADGE_FONT_SIZE,
        fontWeight: 800,
        fontFamily: "var(--font-mono)",
        fontVariantNumeric: "tabular-nums",
        color: lineColor,
        background: "#FFFFFF",
        padding: "5px 8px",
        borderRadius: 6,
        border: `2px solid ${lineColor}`,
        lineHeight: 1.1,
        boxShadow: "0 1px 2px rgba(15, 23, 42, 0.08)",
        whiteSpace: "nowrap",
        textAlign: "center",
        display: "inline-block",
        boxSizing: "border-box",
        cursor:
          interactionMode === "leave" || interactionMode === "seek" ? "pointer" : "default",
      }}
      disabled={interactionMode !== "leave" && interactionMode !== "seek"}
    >
      {`${carNum}-${doorNo}`}
    </button>
  );

  const sideColumnStyle = useCallback(
    () => ({
      width: SIDE_COLUMN_WIDTH,
      minWidth: SIDE_COLUMN_WIDTH,
      flexShrink: 0,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      overflow: "visible",
      boxSizing: "border-box",
    }),
    []
  );

  /** 좌·우 끝 | 통로 | 좌·우 끝 */
  const renderBenchRow = ({
    key,
    leftEntrance = null,
    leftSeat = null,
    rightSeat = null,
    rightEntrance = null,
    centerMarker = null,
    marginBottom = 4,
  }) => (
    <div key={key} style={{ ...carRowStyle, marginBottom }}>
      <div style={sideColumnStyle()}>{leftEntrance || leftSeat}</div>
      {centerMarker ? (
        <div
          style={{
            flex: 1,
            minWidth: AISLE_GAP,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          {centerMarker}
        </div>
      ) : (
        renderFlexAisleSpacer()
      )}
      <div style={sideColumnStyle()}>{rightEntrance || rightSeat}</div>
    </div>
  );

  /** 구역별 입구 행(좌·우) → A~F */
  const renderSectionRows = (sectionIndex, leftSeats, rightSeats) => {
    const doorNo = sectionIndex + 1;
    const rows = [
      renderBenchRow({
        key: `sec-${sectionIndex}-entrance`,
        leftEntrance: renderEntranceBadge(doorNo),
        rightEntrance: renderEntranceBadge(doorNo),
        marginBottom: 6,
      }),
    ];

    for (let visualRank = 0; visualRank < REGULAR_SEATS_PER_SIDE; visualRank += 1) {
      const seatInSection = regularSeatIndexOrder[visualRank];
      const isCenterMarkerRow =
        visualRank === 2 && (interactionMode === "leave" || interactionMode === "seek");
      rows.push(
        renderBenchRow({
          key: `sec-${sectionIndex}-rank-${visualRank}`,
          leftSeat: renderSeatAt("left", sectionIndex, leftSeats, doorNo, visualRank, seatInSection),
          rightSeat: renderSeatAt("right", sectionIndex, rightSeats, doorNo, visualRank, seatInSection),
          centerMarker: isCenterMarkerRow ? renderCenterSectionMarker(doorNo) : null,
        })
      );
    }

    return rows;
  };

  const renderDoorFourRow = () =>
    renderBenchRow({
      key: "entrance-4",
      leftEntrance: renderEntranceBadge(4),
      rightEntrance: renderEntranceBadge(4),
      marginBottom: 4,
    });

  const renderSideDoorRow = (doorNo) => {
    const label = formatExitDoorDisplayLabel(carNum, doorNo);
    const isSelected = selectedDoorLabel === label;
    return (
      <div key={`side-door-${doorNo}`} style={carRowStyle}>
        <div style={sideColumnStyle()}>
          <button
            type="button"
            className="zeb-touch-target"
            onClick={() => onDoorSelect?.(label)}
            aria-label={`${carNum}호차 ${doorNo}번 출입문`}
            aria-pressed={isSelected}
            style={{
              width: SEAT_CELL,
              minHeight: SEAT_CELL,
              padding: 0,
              borderRadius: 8,
              border: `1.5px solid ${isSelected ? lineColor : "#E2E8F0"}`,
              background: isSelected ? lineColor : "#FFFFFF",
              color: isSelected ? "#fff" : lineColor,
              fontSize: 13,
              fontWeight: 800,
              cursor: "pointer",
              transition: "all 0.15s",
              boxSizing: "border-box",
            }}
          >
            문
          </button>
        </div>
        {renderFlexAisleSpacer()}
        <div style={sideColumnStyle()} aria-hidden />
      </div>
    );
  };

  /** 노약자 → 입구1-1 → A~F → 입구1-2 → … → 입구1-4 → 노약자 */
  const renderCarBody = () => {
    const sideLabelStyle = {
      width: SIDE_COLUMN_WIDTH,
      minWidth: SIDE_COLUMN_WIDTH,
      fontSize: 12,
      fontWeight: 800,
      color: lineColor,
      textAlign: "center",
      lineHeight: 1.2,
      userSelect: "none",
      flexShrink: 0,
      boxSizing: "border-box",
    };

    const rows = [];

    const sideLabelsRow = (
      <div key="row-side-labels" style={{ ...carRowStyle, marginBottom: seekEmbedMode ? 6 : 4 }} aria-hidden>
        <span style={sideLabelStyle}>{leaveEmbedMode ? "" : "← 좌측"}</span>
        {renderFlexAisleSpacer()}
        <span style={sideLabelStyle}>{leaveEmbedMode ? "" : "우측 →"}</span>
      </div>
    );

    rows.push(
      sideLabelsRow,
      <div key="row-prio-top" style={carRowStyle}>
        <div style={sideColumnStyle()}>
          <PriorityBlock side="left" placement="top" />
        </div>
        {renderFlexAisleSpacer()}
        <div style={sideColumnStyle()}>
          <PriorityBlock side="right" placement="top" />
        </div>
      </div>
    );

    if (doorPickerMode) {
      rows.push(renderSideDoorRow(1));
    }

    for (let sectionIndex = 0; sectionIndex < SECTIONS; sectionIndex += 1) {
      rows.push(...renderSectionRows(sectionIndex, leftSeats, rightSeats));

      if (doorPickerMode && sectionIndex < SECTIONS - 1) {
        rows.push(renderSideDoorRow(sectionIndex + 2));
      }
    }

    if (doorPickerMode) {
      rows.push(renderSideDoorRow(4));
    } else {
      rows.push(renderDoorFourRow());
    }

    rows.push(
      <div key="row-prio-bottom" style={carRowStyle}>
        <div style={sideColumnStyle()}>
          <PriorityBlock side="left" placement="bottom" />
        </div>
        {renderFlexAisleSpacer()}
        <div style={sideColumnStyle()}>
          <PriorityBlock side="right" placement="bottom" />
        </div>
      </div>
    );

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 2,
          width: "100%",
        }}
      >
        {rows}
      </div>
    );
  };

  return (
    <div
      style={{
        maxWidth: 380,
        width: "100%",
        margin: "0 auto",
        padding: seekEmbedMode ? "0" : "0 max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left))",
        boxSizing: "border-box",
      }}
    >
      {showCarTabs ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              totalCars <= 6 ? "repeat(6, 1fr)" : "repeat(5, 1fr)",
            gap: 5,
            marginBottom: 10,
          }}
        >
          {Array.from({ length: totalCars }, (_, i) => (
            <button
              key={i}
              type="button"
              className="zeb-tab-btn"
              onClick={() => {
                setActiveCar(i);
                setSelectedSeat(null);
              }}
              style={{
                padding: "7px 2px",
                minHeight: 44,
                minWidth: 44,
                borderRadius: 8,
                border: `1.5px solid ${i === activeCar ? lineColor : "#ddd"}`,
                background: i === activeCar ? lineColor : "#fff",
                color: i === activeCar ? "#fff" : "#999",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {i + 1}호차
            </button>
          ))}
        </div>
      ) : null}

      {!doorPickerMode && carAlightingCount > 0 ? (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginBottom: 8,
          }}
        >
          <span
            style={{
              background: `${lineColor}${ALIGHTING_BG_ALPHA}`,
              borderRadius: 20,
              padding: "3px 12px",
              fontSize: 12,
              color: lineColor,
              fontWeight: 600,
              border: `1px solid ${lineColor}`,
            }}
          >
            곧 하차 {carAlightingCount}명
          </span>
        </div>
      ) : null}

      {!doorPickerMode && quickExitHint?.type === "exit" ? (
        <div
          style={{
            marginBottom: 8,
            padding: "10px 12px",
            borderRadius: 10,
            background: "rgba(245, 158, 11, 0.12)",
            border: "1px solid rgba(245, 158, 11, 0.35)",
            fontSize: 12,
            color: "#92400E",
            lineHeight: 1.5,
          }}
        >
          <strong>{station}</strong> 하차 · 빠른하차{" "}
          <strong>
            {quickExitHint.doorNo ??
              formatExitDoorDisplayLabel(quickExitHint.car, quickExitHint.door)}
          </strong>
          {quickExitHint.platform ? ` · 승강장 ${quickExitHint.platform}` : ""}
        </div>
      ) : null}

      {!doorPickerMode && quickExitHint?.type === "info" ? (
        <div
          style={{
            marginBottom: 8,
            padding: "8px 12px",
            borderRadius: 10,
            background: "#F1F5F9",
            fontSize: 12,
            color: "#64748B",
          }}
        >
          {quickExitHint.text}
        </div>
      ) : null}

      {!doorPickerMode && alightingLoadError ? (
        <p style={{ fontSize: 11, color: "#94A3B8", marginBottom: 8 }}>{alightingLoadError}</p>
      ) : null}

      {!doorPickerMode && directionLabel && !seekEmbedMode ? (
        <div
          style={{
            background: lineColor,
            borderRadius: 10,
            padding: "9px 14px",
            marginBottom: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>
            {directionLabel} ↑
          </span>
        </div>
      ) : null}

      {!seekEmbedMode && !leaveEmbedMode ? (
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 4,
          padding: "0 2px",
        }}
      >
        <span style={{ fontSize: 14, color: lineColor, fontWeight: 800 }}>← 좌측</span>
        <span
          style={{
            fontSize: 11,
            color: "#78909C",
            fontWeight: 700,
            letterSpacing: "0.12em",
            fontFeatureSettings: '"tnum"',
          }}
        >
          A(위) ↓ F(아래)
        </span>
        <span style={{ fontSize: 14, color: lineColor, fontWeight: 800 }}>우측 →</span>
      </div>
      ) : null}

      {!seekEmbedMode && !leaveEmbedMode && !doorPickerMode ? (
        <p
          style={{
            margin: "0 0 8px",
            fontSize: 11,
            color: "#94A3B8",
            textAlign: "center",
            lineHeight: 1.4,
          }}
        >
          맨 위부터 노약자 → 출입문 출1-1~출1-3 구역 · 좌·우 각 6석(A~F)
        </p>
      ) : !seekEmbedMode ? (
        <p
          style={{
            margin: "0 0 8px",
            fontSize: 11,
            color: "#94A3B8",
            textAlign: "center",
            lineHeight: 1.4,
          }}
        >
          좌측「문」을 눌러 지금 서 있는 출입문을 선택하세요
        </p>
      ) : null}
      <div
        className="zeb-no-scrollbar"
        style={{
          background: "#FFFFFF",
          border: seekEmbedMode ? "none" : `2px solid ${lineColor}`,
          borderRadius: seekEmbedMode ? 0 : 14,
          padding: seekEmbedMode ? "4px 0" : "10px 8px",
          display: "flex",
          justifyContent: "flex-start",
          maxHeight: seekEmbedMode ? "none" : "min(62vh, 520px)",
          overflowY: seekEmbedMode ? "visible" : "auto",
          overflowX: "hidden",
          WebkitOverflowScrolling: "touch",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          position: "relative",
          zIndex: 0,
        }}
      >
        {renderCarBody()}
      </div>

      {selectedSeat && !doorPickerMode && !seekEmbedMode ? (
        <div
          style={{
            marginTop: 12,
            background: lineColor,
            borderRadius: 12,
            padding: "13px 16px",
          }}
        >
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", marginBottom: 3 }}>
            선택한 자리
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>
            {selectedSeat.seatLabel ??
              formatSelectedSeatLabel(
                selectedSeat.car,
                selectedSeat.door,
                selectedSeat.seatColumn ?? selectedSeat.seatLetter,
                selectedSeat.side
              )}
            {interactionMode === "leave" ? " · 내 자리" : " · 곧 하차 예정"}
          </div>
        </div>
      ) : null}

      {!doorPickerMode && !seekEmbedMode ? (
      <div
        style={{
          display: "flex",
          gap: 12,
          marginTop: 12,
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        {[
          { bg: "rgba(255, 143, 0, 0.14)", border: ELDERLY_COLOR, label: "노약자석" },
          interactionMode === "leave"
            ? { bg: "#FFFFFF", border: lineColor, label: "내 자리 (탭)" }
            : { bg: "#FFFFFF", border: lineColor, label: "빈 자리 (탭)" },
          ...(interactionMode === "seek"
            ? [{ bg: `${lineColor}${ALIGHTING_BG_ALPHA}`, border: lineColor, label: "곧 하차" }]
            : []),
        ].map((item) => (
          <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                background: item.bg,
                border: `1.5px solid ${item.border}`,
              }}
            />
            <span style={{ fontSize: 11, color: "#888" }}>{item.label}</span>
          </div>
        ))}
      </div>
      ) : null}
    </div>
  );
}
