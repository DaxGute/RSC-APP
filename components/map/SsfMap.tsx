/**
 * Map tab entry: picks Mapbox implementation or Expo Go fallback at load time.
 * Also exports top-left map chrome (Alert, Model, zoom) shared with model projection.
 */
import { Ionicons } from '@expo/vector-icons';
import { forwardRef, useImperativeHandle } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppLanguage } from '../../contexts/LanguageProvider';
import { isMapboxNativeAvailable } from '../../lib/mapboxNative';
import { mapScreenCopy } from '../../lib/mapScreenCopy';
import type { SsfMapHandle, SsfMapProps } from './SsfMapMapbox';

export type { MapSelectDetail, SsfMapHandle, SsfMapProps } from './SsfMapMapbox';

/** Expo Go placeholder; same ref API as SsfMapMapbox with no-op camera/zoom. */
const SsfMapExpoGoFallback = forwardRef<SsfMapHandle, SsfMapProps>(function SsfMapExpoGoFallback(_props, ref) {
  useImperativeHandle(ref, () => ({
    focusCoordinate: () => {},
    zoomIn: () => {},
    zoomOut: () => {},
  }));

  return (
    <View style={fallbackStyles.root}>
      <Text style={fallbackStyles.title}>Map needs a development build</Text>
      <Text style={fallbackStyles.body}>
        @rnmapbox/maps does not run in Expo Go. From the project root, run:{'\n\n'}
        npx expo prebuild{'\n'}
        npx expo run:ios
      </Text>
    </View>
  );
});

/** Dynamic require avoids bundling @rnmapbox/maps when native module is absent. */
/** Mapbox when native module is present; otherwise Expo Go fallback with the same ref API. */
export const SsfMap = isMapboxNativeAvailable()
  ? require('./SsfMapMapbox').SsfMap
  : SsfMapExpoGoFallback;

/** Top-left overlay buttons; zoom handlers optional (hidden when both are omitted). */
export type MapScaleActionsProps = {
  onNotificationPress?: () => void;
  onModelingPress?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  canZoomIn?: boolean;
  canZoomOut?: boolean;
  /** When set, used instead of safe-area-based top offset (nested map panels). */
  overlayTop?: number;
};

/** Alert, Model, and zoom controls overlaid on SsfMap / model projection maps. */
export function MapScaleActions({
  onNotificationPress,
  onModelingPress,
  onZoomIn,
  onZoomOut,
  canZoomIn = true,
  canZoomOut = true,
  overlayTop,
}: MapScaleActionsProps) {
  const { language } = useAppLanguage();
  const copy = mapScreenCopy[language];
  const insets = useSafeAreaInsets();
  const showZoom = onZoomIn != null && onZoomOut != null;
  const showActions = onNotificationPress != null || onModelingPress != null || showZoom;
  if (!showActions) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[
        scaleStyles.wrap,
        {
          top: overlayTop ?? Math.max(insets.top, 6) + 8,
          left: 8,
        },
      ]}
    >
      {onNotificationPress ? (
        <Pressable
          onPress={onNotificationPress}
          style={({ pressed }) => [scaleStyles.actionBtn, pressed && scaleStyles.actionBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel={copy.mapAlertButtonA11y}
        >
          <Ionicons name="notifications-outline" size={16} color="#1f2937" />
          <Text style={scaleStyles.actionLabel} numberOfLines={1}>
            {copy.mapAlertButton}
          </Text>
        </Pressable>
      ) : null}
      {onModelingPress ? (
        <Pressable
          onPress={onModelingPress}
          style={({ pressed }) => [scaleStyles.actionBtn, pressed && scaleStyles.actionBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel="Modeling"
        >
          <Ionicons name="layers-outline" size={16} color="#1f2937" />
          <Text style={scaleStyles.actionLabel} numberOfLines={1}>
            Model
          </Text>
        </Pressable>
      ) : null}
      {showZoom ? (
        <View style={scaleStyles.zoomPill}>
          <Pressable
            onPress={onZoomIn}
            disabled={!canZoomIn}
            style={({ pressed }) => [
              scaleStyles.zoomPillHalf,
              !canZoomIn && scaleStyles.zoomPillHalfDisabled,
              pressed && canZoomIn && scaleStyles.zoomPillHalfPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={copy.zoomInA11y}
          >
            <Ionicons name="add" size={16} color={canZoomIn ? '#1f2937' : '#94a3b8'} />
          </Pressable>
          <View style={scaleStyles.zoomPillDivider} />
          <Pressable
            onPress={onZoomOut}
            disabled={!canZoomOut}
            style={({ pressed }) => [
              scaleStyles.zoomPillHalf,
              !canZoomOut && scaleStyles.zoomPillHalfDisabled,
              pressed && canZoomOut && scaleStyles.zoomPillHalfPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={copy.zoomOutA11y}
          >
            <Ionicons name="remove" size={16} color={canZoomOut ? '#1f2937' : '#94a3b8'} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const fallbackStyles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: '#e2e8f0',
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
    marginBottom: 10,
  },
  body: {
    fontSize: 14,
    lineHeight: 22,
    color: '#334155',
    textAlign: 'center',
  },
});

const ACTION_PILL_MIN_WIDTH = 72;
const ZOOM_PILL_WIDTH = ACTION_PILL_MIN_WIDTH / 2;

const scaleStyles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    zIndex: 12,
    gap: 6,
    minWidth: ACTION_PILL_MIN_WIDTH,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 34,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    shadowColor: '#1e293b',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  actionBtnPressed: {
    opacity: 0.88,
    transform: [{ translateY: 0.5 }],
  },
  actionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.15,
    color: '#334155',
  },
  zoomPill: {
    alignSelf: 'flex-start',
    width: ZOOM_PILL_WIDTH,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    shadowColor: '#1e293b',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
    overflow: 'hidden',
  },
  zoomPillHalf: {
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomPillHalfPressed: {
    opacity: 0.88,
    backgroundColor: 'rgba(241,245,249,0.9)',
  },
  zoomPillHalfDisabled: {
    opacity: 0.55,
  },
  zoomPillDivider: {
    height: 1,
    backgroundColor: '#e2e8f0',
    marginHorizontal: 4,
  },
});
