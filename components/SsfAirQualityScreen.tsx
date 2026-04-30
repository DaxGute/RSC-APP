import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { CurrentKrigingRow } from '../lib/database.types';
import type { FetchError } from '../lib/fetchAirQuality';
import { useAirQualityReminder } from '../hooks/useAirQualityReminder';
import { regionFromSensorData } from '../lib/mapRegionFromData';
import { PM25_AQI_BOUNDS } from '../lib/pm25ColorScale';
import type { SensorPoint } from '../lib/sensorTypes';
import { AqiPanel } from './AqiPanel';
import { Pm25VerticalScale } from './Pm25VerticalScale';
import { ReadingTimeline } from './ReadingTimeline';
import { SsfMap } from './SsfMap';

type PanelSlot = 'bottom' | 'center';

/** Lifts the selection sheet slightly above the screen edge / vertical center. */
const PANEL_LIFT_PX = 15;

function dateKeyLocal(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export type SsfAirQualityScreenProps = {
  sensors: SensorPoint[];
  kriging: CurrentKrigingRow[];
  loading: boolean;
  error: FetchError | null;
  timelineTimesAsc: string[];
  timelineIndex: number;
  onTimelineIndexChange: (index: number) => void;
  onSelectRecordedTime: (recordedTime: string) => void;
  viewingLive: boolean;
  timelineLoading: boolean;
  insufficientData: boolean;
  liveAverageAqi: number | null;
};

export function SsfAirQualityScreen({
  sensors,
  kriging,
  loading,
  error,
  timelineTimesAsc,
  timelineIndex,
  onTimelineIndexChange,
  onSelectRecordedTime,
  viewingLive,
  timelineLoading,
  insufficientData,
  liveAverageAqi,
}: SsfAirQualityScreenProps) {
  const insets = useSafeAreaInsets();

  const [selected, setSelected] = useState<{
    lat: number;
    lon: number;
    label: string | null;
    sensorIndex?: number;
    sensorSource?: string;
  } | null>(null);
  const [panelSlot, setPanelSlot] = useState<PanelSlot>('bottom');

  const mapRegion = useMemo(() => regionFromSensorData(sensors, kriging), [sensors, kriging]);
  const selectedTimeIsoForUi = useMemo(
    () => timelineTimesAsc[timelineIndex] ?? (timelineTimesAsc.length === 0 ? new Date().toISOString() : null),
    [timelineIndex, timelineTimesAsc],
  );
  const isSelectedDateToday = useMemo(() => {
    if (!selectedTimeIsoForUi) return true;
    const selectedDate = new Date(selectedTimeIsoForUi);
    if (!Number.isFinite(selectedDate.getTime())) return true;
    return dateKeyLocal(selectedDate) === dateKeyLocal(new Date());
  }, [selectedTimeIsoForUi]);
  const todayTimelineTimesAsc = useMemo(() => {
    const todayKey = dateKeyLocal(new Date());
    return timelineTimesAsc.filter((iso) => {
      const d = new Date(iso);
      if (!Number.isFinite(d.getTime())) return false;
      return dateKeyLocal(d) === todayKey;
    });
  }, [timelineTimesAsc]);
  const timelineTimesForUi = useMemo(() => {
    if (!selectedTimeIsoForUi) return todayTimelineTimesAsc;
    if (!isSelectedDateToday) return [selectedTimeIsoForUi];
    return todayTimelineTimesAsc.length > 0 ? todayTimelineTimesAsc : [selectedTimeIsoForUi];
  }, [isSelectedDateToday, selectedTimeIsoForUi, todayTimelineTimesAsc]);
  const timelineIndexForUi = useMemo(
    () => {
      if (timelineTimesForUi.length === 0) return 0;
      if (!selectedTimeIsoForUi) return Math.max(0, timelineTimesForUi.length - 1);
      const indexInUi = timelineTimesForUi.findIndex((iso) => iso === selectedTimeIsoForUi);
      if (indexInUi >= 0) return indexInUi;
      return Math.max(0, timelineTimesForUi.length - 1);
    },
    [selectedTimeIsoForUi, timelineTimesForUi],
  );
  const prevIsSelectedDateTodayRef = useRef(isSelectedDateToday);

  useEffect(() => {
    const wasToday = prevIsSelectedDateTodayRef.current;
    if (!wasToday && isSelectedDateToday && timelineTimesAsc.length > 0) {
      const latestTodayIso = todayTimelineTimesAsc[todayTimelineTimesAsc.length - 1];
      if (latestTodayIso) {
        const latestTodaySourceIndex = timelineTimesAsc.findIndex((iso) => iso === latestTodayIso);
        if (latestTodaySourceIndex >= 0 && latestTodaySourceIndex !== timelineIndex) {
          onTimelineIndexChange(latestTodaySourceIndex);
        }
      }
    }
    prevIsSelectedDateTodayRef.current = isSelectedDateToday;
  }, [isSelectedDateToday, onTimelineIndexChange, timelineIndex, timelineTimesAsc, todayTimelineTimesAsc]);

  const { reminder, setReminder, clearReminder, isReminderForCoordinate } = useAirQualityReminder(
    sensors,
    kriging,
    viewingLive,
  );

  const maxSensorPm25 = useMemo(() => {
    if (sensors.length === 0) return PM25_AQI_BOUNDS[PM25_AQI_BOUNDS.length - 1];
    return Math.max(...sensors.map((s) => s.pm25));
  }, [sensors]);

  const onSelectCoordinate = useCallback(
    (
      lat: number,
      lon: number,
      detail: {
        touchInBottomBand: boolean;
        sensorIndex?: number;
        sensorSource?: string;
        sensorName?: string | null;
      },
    ) => {
      const matchedSensor =
        detail.sensorIndex != null
          ? sensors.find(
              (s) =>
                s.sensorIndex === detail.sensorIndex &&
                (detail.sensorSource == null || s.source === detail.sensorSource),
            ) ?? sensors.find((s) => s.sensorIndex === detail.sensorIndex)
          : undefined;
      const sensorName = detail.sensorName ?? matchedSensor?.name ?? null;
      setSelected({
        lat,
        lon,
        label: sensorName,
        sensorIndex: matchedSensor?.sensorIndex,
        sensorSource: matchedSensor?.source,
      });
      setPanelSlot(detail.touchInBottomBand ? 'center' : 'bottom');
    },
    [sensors],
  );

  const clearSelection = useCallback(() => {
    setSelected(null);
    setPanelSlot('bottom');
  }, []);

  return (
    <View style={styles.screenRoot}>
      <View style={styles.screenContent}>
        <View style={styles.main}>
          <Pm25VerticalScale maxPm25={maxSensorPm25} />

          <View style={styles.mapCol}>
            <SsfMap
              sensors={sensors}
              kriging={kriging}
              mapRegion={mapRegion}
              selected={selected ? { latitude: selected.lat, longitude: selected.lon } : null}
              reminderLocation={
                reminder ? { latitude: reminder.lat, longitude: reminder.lon } : null
              }
              onSelectCoordinate={onSelectCoordinate}
            />
            {!viewingLive && insufficientData ? (
              <View style={styles.insufficientWrap} pointerEvents="none">
                <Text style={styles.insufficientText}>Insufficient Data</Text>
              </View>
            ) : null}
          </View>
          {selected ? (
            <View
              style={[
                panelSlot === 'center' ? styles.sheetWrapCenter : styles.sheetWrapBottom,
                panelSlot === 'bottom' && {
                  paddingBottom: Math.max(insets.bottom, 12),
                  bottom: PANEL_LIFT_PX,
                },
              ]}
              pointerEvents="box-none"
            >
              <View
                style={[
                  styles.sheetInner,
                  panelSlot === 'center' && { transform: [{ translateY: -PANEL_LIFT_PX }] },
                ]}
              >
                <AqiPanel
                  selected={selected}
                  selectedLabel={selected.label}
                  selectedSensor={
                    selected.sensorIndex != null
                      ? {
                          sensorIndex: selected.sensorIndex,
                          source: selected.sensorSource,
                        }
                      : null
                  }
                  loading={loading}
                  error={error}
                  sensors={sensors}
                  kriging={kriging}
                  mapRegion={mapRegion}
                  onClose={clearSelection}
                  sheetMode
                  healthTooltipPlacement={panelSlot === 'bottom' ? 'above' : 'below'}
                  reminderBellActive={isReminderForCoordinate(selected)}
                  onReminderPickThreshold={async (categoryIndex, cooldownMinutes) => {
                    if (selected == null) return;
                    try {
                      await setReminder(selected.lat, selected.lon, categoryIndex, cooldownMinutes);
                    } catch {
                      Alert.alert(
                        'Check your connection',
                        'We could not save your reminder. Check your connection.',
                      );
                    }
                  }}
                  onReminderCooldownChange={async (cooldownMinutes) => {
                    if (reminder == null) return;
                    try {
                      await setReminder(
                        reminder.lat,
                        reminder.lon,
                        reminder.categoryIndex,
                        cooldownMinutes,
                      );
                    } catch {
                      Alert.alert(
                        'Check your connection',
                        'We could not save your reminder. Check your connection.',
                      );
                    }
                  }}
                  onReminderClear={clearReminder}
                  savedReminderCategoryIndex={reminder?.categoryIndex ?? null}
                  savedReminderCooldownMinutes={reminder?.cooldownMinutes ?? null}
                />
              </View>
            </View>
          ) : null}

          <ReadingTimeline
            timesAsc={timelineTimesForUi}
            calendarTimesAsc={timelineTimesAsc}
            selectedIndex={timelineIndexForUi}
            onChangeIndex={(index) => {
              if (!isSelectedDateToday) return;
              const selectedIso = timelineTimesForUi[index];
              if (!selectedIso) return;
              const sourceIndex = timelineTimesAsc.findIndex((iso) => iso === selectedIso);
              if (sourceIndex < 0) return;
              onTimelineIndexChange(sourceIndex);
            }}
            loading={timelineLoading}
            onPickRecordedTime={onSelectRecordedTime}
            liveAverageAqi={liveAverageAqi}
            timelineScrollable={isSelectedDateToday}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screenRoot: { flex: 1, backgroundColor: '#e8f0fe' },
  screenContent: { flex: 1, position: 'relative' },
  main: { flex: 1, minHeight: 0 },
  mapCol: { flex: 1, minHeight: 0, zIndex: 0 },
  insufficientWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  insufficientText: {
    color: '#dc2626',
    fontSize: 22,
    fontWeight: '800',
    textShadowColor: 'rgba(255,255,255,0.95)',
    textShadowRadius: 6,
    textShadowOffset: { width: 0, height: 0 },
  },
  sheetWrapBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: PANEL_LIFT_PX,
    paddingHorizontal: 16,
    paddingTop: 8,
    width: '100%',
    alignItems: 'center',
    zIndex: 2,
  },
  sheetWrapCenter: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    zIndex: 2,
  },
  sheetInner: {
    width: '100%',
    maxWidth: 520,
  },
});
