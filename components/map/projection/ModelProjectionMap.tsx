/**
 * Model projection overlay entry: Mapbox UI when @rnmapbox/maps is linked,
 * otherwise an Expo Go modal. Props and types are defined in ModelProjectionMapMapbox.
 */
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isMapboxNativeAvailable } from '../../../lib/mapboxNative';
import type { ModelProjectionMapProps } from './ModelProjectionMapMapbox';

export type { ModelProjectionMapProps } from './ModelProjectionMapMapbox';

/** Expo Go / non-Mapbox: dev-build instructions. Only `visible` and `onClose` are used. */
function ModelProjectionMapExpoGoFallback({ visible, onClose }: ModelProjectionMapProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={[fallbackStyles.backdrop, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
        <View style={fallbackStyles.card}>
          <Text style={fallbackStyles.title}>Model map needs a development build</Text>
          <Text style={fallbackStyles.body}>
            @rnmapbox/maps does not run in Expo Go. Run npx expo prebuild, then npx expo run:ios.
          </Text>
          <Pressable onPress={onClose} style={fallbackStyles.button} accessibilityRole="button">
            <Text style={fallbackStyles.buttonLabel}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** Dynamic require keeps @rnmapbox/maps out of the bundle when the native module is absent. */
export const ModelProjectionMap = isMapboxNativeAvailable()
  ? require('./ModelProjectionMapMapbox').ModelProjectionMap
  : ModelProjectionMapExpoGoFallback;

const fallbackStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    padding: 20,
    gap: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
  },
  body: {
    fontSize: 14,
    lineHeight: 21,
    color: '#334155',
  },
  button: {
    alignSelf: 'flex-end',
    marginTop: 4,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  buttonLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#2563eb',
  },
});
