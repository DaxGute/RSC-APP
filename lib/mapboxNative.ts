import { NativeModules } from 'react-native';

/** True when @rnmapbox/maps native module is linked (dev build), not in Expo Go. */
export function isMapboxNativeAvailable(): boolean {
  return NativeModules.RNMBXModule != null;
}
