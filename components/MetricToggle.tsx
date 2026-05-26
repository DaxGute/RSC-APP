import { useCallback, useEffect, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import type { Metric } from '../lib/metric';

const SEGMENT_MS = 220;

type MetricToggleProps = {
  metric: Metric;
  onMetricChange: (metric: Metric) => void;
  compact?: boolean;
};

export function MetricToggle({ metric, onMetricChange, compact = false }: MetricToggleProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const segmentWidth = trackWidth > 0 ? (trackWidth - 4) / 2 : 0;
  const activeIndex = useSharedValue(metric === 'pm25' ? 0 : 1);

  useEffect(() => {
    activeIndex.value = withTiming(metric === 'pm25' ? 0 : 1, {
      duration: SEGMENT_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [activeIndex, metric]);

  const onTrackLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (Number.isFinite(w) && w > 0) setTrackWidth(w);
  }, []);

  const thumbStyle = useAnimatedStyle(() => ({
    width: segmentWidth,
    transform: [{ translateX: 2 + activeIndex.value * segmentWidth }],
  }));

  return (
    <View
      style={[styles.track, compact && styles.trackCompact]}
      onLayout={onTrackLayout}
      accessibilityRole="tablist"
    >
      {segmentWidth > 0 ? (
        <Animated.View
          style={[styles.thumb, compact && styles.thumbCompact, thumbStyle]}
          pointerEvents="none"
        />
      ) : null}
      <Pressable
        onPress={() => onMetricChange('pm25')}
        style={[styles.segment, compact && styles.segmentCompact]}
        accessibilityRole="tab"
        accessibilityState={{ selected: metric === 'pm25' }}
        accessibilityLabel="PM2.5"
      >
        <Text style={[styles.label, compact && styles.labelCompact, metric === 'pm25' && styles.labelActive]}>
          PM2.5
        </Text>
      </Pressable>
      <Pressable
        onPress={() => onMetricChange('aqi')}
        style={[styles.segment, compact && styles.segmentCompact]}
        accessibilityRole="tab"
        accessibilityState={{ selected: metric === 'aqi' }}
        accessibilityLabel="AQI"
      >
        <Text style={[styles.label, compact && styles.labelCompact, metric === 'aqi' && styles.labelActive]}>
          AQI
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    padding: 2,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    minWidth: 128,
  },
  trackCompact: {
    minWidth: 108,
  },
  thumb: {
    position: 'absolute',
    top: 2,
    left: 0,
    bottom: 2,
    borderRadius: 999,
    backgroundColor: '#ffffff',
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  thumbCompact: {
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 10,
    zIndex: 1,
  },
  segmentCompact: {
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
    color: '#64748b',
  },
  labelCompact: {
    fontSize: 10,
    letterSpacing: 0.1,
  },
  labelActive: {
    color: '#0f172a',
    fontWeight: '800',
  },
});
