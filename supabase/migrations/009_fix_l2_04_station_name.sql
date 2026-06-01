-- Fix incorrect mock placeholder name for 인천 2호선 l2-04 (was 'camping' in mockData).

UPDATE public.stations
SET station_name = '마전'
WHERE station_name = 'camping';
