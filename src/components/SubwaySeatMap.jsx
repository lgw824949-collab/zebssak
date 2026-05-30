"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

/** LineSelect.jsx 노선색과 동일 */
const LINE_COLORS = {
  "서울 1호선": "#0052A4",
  "서울 2호선": "#00A84D",
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

const LINE_COLOR_FALLBACK = "#1A56A0";
const ELDERLY_COLOR = "#FF8F00";
const AISLE_BG_ALPHA = "1A";
const ALIGHTING_BG_ALPHA = "26";

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

/** 선택 좌석 표기 — 예: 1-1 · C열 · 좌측 */
function formatSelectedSeatLabel(car, door, columnLetter, side) {
  const sideLabel = side === "left" ? "좌측" : "우측";
  const col = columnLetter ? `${columnLetter}열` : "열 미지정";
  return `${car}-${door} · ${col} · ${sideLabel}`;
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

function Seat({ side, status, lineColor, selected, recommended, onClick, seatLetter }) {
  const isAlighting = status === "alighting";
  const isElderly = status === "elderly";
  const facesLeft = side === "right";

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

  const baseBorder = `${borderWidth}px solid ${border}`;
  const wallInset = facesLeft
    ? `inset -3px 0 0 0 ${wallAccent}`
    : `inset 3px 0 0 0 ${wallAccent}`;

  return (
    <button
      type="button"
      className="zeb-seat-btn"
      onClick={onClick}
      style={{
        width: 40,
        height: 40,
        minWidth: 40,
        minHeight: 40,
        borderRadius: 6,
        background: fill,
        border: baseBorder,
        boxShadow: recommended
          ? `0 0 0 2px #F59E0B, ${wallInset}`
          : wallInset,
        outline: selected ? `2px solid ${lineColor}` : "none",
        outlineOffset: 1,
        cursor:
          status === "elderly"
            ? "default"
            : status === "alighting" || status === "empty"
              ? "pointer"
              : "default",
        padding: 0,
        margin: 0,
        flexShrink: 0,
        boxSizing: "border-box",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {seatLetter && !isElderly ? (
        <span
          style={{
            fontFamily: "'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif",
            fontSize: 10,
            fontWeight: 700,
            color: "#475569",
            lineHeight: 1,
            letterSpacing: 0,
            pointerEvents: "none",
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
  const isLeft = side === "left";

  return (
    <div
      style={{
        width: "fit-content",
        maxWidth: "100%",
        alignSelf: isLeft ? "flex-start" : "flex-end",
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: 3,
        padding: isLeft ? "4px 0 4px 2px" : "4px 2px 4px 0",
        margin: placement === "top" ? "0 0 2px" : "2px 0 0",
        borderRadius: 8,
        background: "rgba(255, 143, 0, 0.1)",
        boxSizing: "border-box",
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

/** 통로 가운데 구역 배지 (1-1, 1-2, 1-3) */
function AisleSectionBadge({ label, lineColor, highlighted }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        fontVariantNumeric: "tabular-nums",
        color: highlighted ? "#FFFFFF" : lineColor,
        background: highlighted ? "#F59E0B" : "#FFFFFF",
        padding: "6px 11px",
        borderRadius: 999,
        border: `2px solid ${highlighted ? "#F59E0B" : lineColor}`,
        lineHeight: 1,
        letterSpacing: 0,
        boxShadow: "0 1px 4px rgba(15, 23, 42, 0.1)",
        pointerEvents: "none",
        userSelect: "none",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

/** 출입문 구분 (통로만) */
function AisleDoorDivider({ label, lineColor }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        padding: "3px 0",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }} aria-hidden />
      <div
        style={{
          width: 48,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: `${lineColor}${AISLE_BG_ALPHA}`,
          borderRadius: 6,
          padding: "2px 0",
        }}
      >
        <span
          style={{
            fontSize: 9,
            fontWeight: 600,
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontVariantNumeric: "tabular-nums",
            color: lineColor,
            opacity: 0.75,
            lineHeight: 1.2,
            userSelect: "none",
            pointerEvents: "none",
          }}
        >
          {label}
        </span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }} aria-hidden />
    </div>
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
    void loadAlighting();
    const timer = setInterval(() => {
      void loadAlighting();
    }, 30000);
    return () => clearInterval(timer);
  }, [loadAlighting]);

  useEffect(() => {
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
  }, [station, line, direction, drtnInfo, carNum, incheonLine]);

  const recommendedDoor =
    quickExitHint?.type === "exit" && quickExitHint.car === carNum
      ? quickExitHint.door
      : null;

  const carBodyRef = useRef(null);
  const sectionRefs = useRef([]);
  const [aisleBadges, setAisleBadges] = useState([]);

  const aisleColumnStyle = useMemo(
    () => ({
      width: 48,
      flexShrink: 0,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      background: `${lineColor}${AISLE_BG_ALPHA}`,
      position: "relative",
      zIndex: 1,
      pointerEvents: "none",
    }),
    [lineColor]
  );

  const updateAisleBadges = useCallback(() => {
    const body = carBodyRef.current;
    if (!body) return;

    const bodyRect = body.getBoundingClientRect();
    const next = sectionRefs.current
      .map((el, sectionIndex) => {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        const doorNo = sectionIndex + 1;
        return {
          top: rect.top - bodyRect.top + rect.height / 2,
          label: `${carNum}-${doorNo}`,
          highlighted: recommendedDoor === doorNo,
        };
      })
      .filter(Boolean);

    setAisleBadges(next);
  }, [carNum, recommendedDoor]);

  useLayoutEffect(() => {
    updateAisleBadges();

    const observer = new ResizeObserver(() => {
      updateAisleBadges();
    });

    if (carBodyRef.current) observer.observe(carBodyRef.current);
    sectionRefs.current.forEach((el) => {
      if (el) observer.observe(el);
    });

    window.addEventListener("resize", updateAisleBadges);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateAisleBadges);
    };
  }, [updateAisleBadges, leftSeats, rightSeats, activeCar, lineColor]);

  const renderSeatSectionColumn = (side, sectionIndex, seats, doorNo) => {
    const door = doorNo;
    const start = sectionIndex * seatsPerSection;
    const isLeft = side === "left";
    const seatNodes = [];

    for (let visualRank = 0; visualRank < REGULAR_SEATS_PER_SIDE; visualRank += 1) {
      const s = regularSeatIndexOrder[visualRank];
      const idx = start + s;
      const status = seats[idx] || "empty";
      const seatId = `${side}-d${door}-s${s}`;
      const columnLetter = getSeatColumnLetter(visualRank);
      const isRecommended =
        recommendedDoor === door &&
        ((side === "left" && s === 0) || (side === "right" && s === REGULAR_SEATS_PER_SIDE - 1));

      seatNodes.push(
        <Seat
          key={seatId}
          side={side}
          status={status}
          lineColor={lineColor}
          selected={selectedSeatId === seatId}
          recommended={isRecommended}
          seatLetter={columnLetter}
          onClick={() => {
            if (!canSelectSeatStatus(status, interactionMode)) return;
            const api = mapSeatIdToApi(seatId, seatsPerSection);
            const info = {
              id: seatId,
              car: carNum,
              door,
              side,
              status,
              seatSide: api?.seatSide,
              seatNumber: api?.seatNumber,
              seatColumn: columnLetter,
              seatLetter: columnLetter,
              seatLabel: formatSelectedSeatLabel(carNum, door, columnLetter, side),
            };
            setSelectedSeat(info);
            onSeatClick?.(info);
            onSeatSelect?.(info);
          }}
        />
      );
    }

    return (
      <div
        key={`${side}-sec-${sectionIndex}`}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: isLeft ? "flex-start" : "flex-end",
          gap: 4,
          justifyContent: "flex-start",
          position: "relative",
          zIndex: 2,
        }}
      >
        {seatNodes}
      </div>
    );
  };

  /** 노약자 → 출입문1-1 → A~F → … → 출입문1-4 → 노약자 */
  const renderCarBody = () => {
    const rows = [
      <div
        key="row-prio-top"
        style={{ display: "flex", alignItems: "stretch", gap: 4, width: "100%" }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <PriorityBlock side="left" placement="top" />
        </div>
        <div style={aisleColumnStyle} aria-hidden />
        <div style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "flex-end" }}>
          <PriorityBlock side="right" placement="top" />
        </div>
      </div>,
    ];

    rows.push(
      <AisleDoorDivider key="door-1" label={`${carNum}-1`} lineColor={lineColor} />
    );

    for (let sectionIndex = 0; sectionIndex < SECTIONS; sectionIndex += 1) {
      const doorNo = sectionIndex + 1;

      rows.push(
        <div
          key={`row-section-${sectionIndex}`}
          ref={(el) => {
            sectionRefs.current[sectionIndex] = el;
          }}
          style={{
            display: "flex",
            alignItems: "stretch",
            gap: 4,
            width: "100%",
          }}
        >
          <div style={{ flex: 1, minWidth: 0, position: "relative", zIndex: 2 }}>
            {renderSeatSectionColumn("left", sectionIndex, leftSeats, doorNo)}
          </div>
          <div style={aisleColumnStyle} aria-hidden />
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              justifyContent: "flex-end",
              position: "relative",
              zIndex: 2,
            }}
          >
            {renderSeatSectionColumn("right", sectionIndex, rightSeats, doorNo)}
          </div>
        </div>
      );

      if (sectionIndex < SECTIONS - 1) {
        rows.push(
          <AisleDoorDivider
            key={`door-${sectionIndex + 2}`}
            label={`${carNum}-${sectionIndex + 2}`}
            lineColor={lineColor}
          />
        );
      }
    }

    rows.push(
      <AisleDoorDivider key="door-4" label={`${carNum}-4`} lineColor={lineColor} />
    );

    rows.push(
      <div
        key="row-prio-bottom"
        style={{ display: "flex", alignItems: "stretch", gap: 4, width: "100%" }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <PriorityBlock side="left" placement="bottom" />
        </div>
        <div style={aisleColumnStyle} aria-hidden />
        <div style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "flex-end" }}>
          <PriorityBlock side="right" placement="bottom" />
        </div>
      </div>
    );

    return (
      <div
        ref={carBodyRef}
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          width: "100%",
        }}
      >
        <div style={{ position: "relative", zIndex: 1 }}>{rows}</div>
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            bottom: 0,
            width: 48,
            transform: "translateX(-50%)",
            background: `${lineColor}${AISLE_BG_ALPHA}`,
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 4,
          }}
        >
          {aisleBadges.map((badge) => (
            <div
              key={badge.label}
              style={{
                position: "absolute",
                left: "50%",
                top: badge.top,
                transform: "translate(-50%, -50%)",
              }}
            >
              <AisleSectionBadge
                label={badge.label}
                lineColor={lineColor}
                highlighted={badge.highlighted}
              />
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif",
        maxWidth: 380,
        width: "100%",
        margin: "0 auto",
        padding: "0 max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left))",
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

      {carAlightingCount > 0 ? (
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

      {quickExitHint?.type === "exit" ? (
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
            {quickExitHint.doorNo ?? `${quickExitHint.car}-${quickExitHint.door}`}
          </strong>
          {quickExitHint.platform ? ` · 승강장 ${quickExitHint.platform}` : ""}
        </div>
      ) : null}

      {quickExitHint?.type === "info" ? (
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

      {alightingLoadError ? (
        <p style={{ fontSize: 11, color: "#94A3B8", marginBottom: 8 }}>{alightingLoadError}</p>
      ) : null}

      {directionLabel ? (
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

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 4,
          padding: "0 2px",
        }}
      >
        <span style={{ fontSize: 11, color: "#78909C", fontWeight: 700 }}>← 좌측</span>
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
        <span style={{ fontSize: 11, color: "#78909C", fontWeight: 700 }}>우측 →</span>
      </div>

      <p
        style={{
          margin: "0 0 8px",
          fontSize: 11,
          color: "#94A3B8",
          textAlign: "center",
          lineHeight: 1.4,
        }}
      >
        맨 위부터 노약자 → 출입문 1-1~1-3 구역 · 좌·우 각 6석(A~F)
      </p>
      <div
        style={{
          background: "#FFFFFF",
          border: `2px solid ${lineColor}`,
          borderRadius: 14,
          padding: "10px 8px",
          display: "flex",
          justifyContent: "center",
          maxHeight: "min(62vh, 520px)",
          overflowY: "auto",
          overflowX: "hidden",
          WebkitOverflowScrolling: "touch",
          position: "relative",
          zIndex: 0,
        }}
      >
        {renderCarBody()}
      </div>

      {selectedSeat ? (
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
    </div>
  );
}
