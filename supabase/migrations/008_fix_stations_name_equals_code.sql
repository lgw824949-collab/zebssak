-- Fix stations rows where station_name was saved as station_code
-- (e.g. match-requests ensureStation fallback: destination_name ?? destinationCode).
-- Canonical names from 005_add_incheon1_extension_stations.sql (인천 1호선 l1-*).

UPDATE public.stations AS s
SET
  station_name = canonical.station_name,
  line_number = canonical.line_number,
  station_order = canonical.station_order
FROM (
  VALUES
    ('l1-01', '검단호수공원', 1, 1),
    ('l1-02', '신검단중앙', 1, 2),
    ('l1-03', '아라', 1, 3),
    ('l1-04', '계양', 1, 4),
    ('l1-05', '귤현', 1, 5),
    ('l1-06', '박촌', 1, 6),
    ('l1-07', '임학', 1, 7),
    ('l1-08', '계산', 1, 8),
    ('l1-09', '경인교대입구', 1, 9),
    ('l1-10', '작전', 1, 10),
    ('l1-11', '갈산', 1, 11),
    ('l1-12', '부평구청', 1, 12),
    ('l1-13', '부평시장', 1, 13),
    ('l1-14', '부평', 1, 14),
    ('l1-15', '동수', 1, 15),
    ('l1-16', '부평삼거리', 1, 16),
    ('l1-17', '간석오거리', 1, 17),
    ('l1-18', '인천시청', 1, 18),
    ('l1-19', '예술회관', 1, 19),
    ('l1-20', '인천터미널', 1, 20),
    ('l1-21', '문학경기장', 1, 21),
    ('l1-22', '선학', 1, 22),
    ('l1-23', '신연수', 1, 23),
    ('l1-24', '원인재', 1, 24),
    ('l1-25', '동춘', 1, 25),
    ('l1-26', '캠퍼스타운', 1, 26),
    ('l1-27', '테크노파크', 1, 27),
    ('l1-28', '지식정보단지', 1, 28),
    ('l1-29', '인천대입구', 1, 29),
    ('l1-30', '센트럴파크', 1, 30),
    ('l1-31', '국제업무지구', 1, 31)
) AS canonical (station_code, station_name, line_number, station_order)
WHERE s.station_code = canonical.station_code
  AND s.station_name = s.station_code;
