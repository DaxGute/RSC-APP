/**
 * Root-shell loading overlay shown on the map tab while PurpleAir and Clarity data are fetched.
 * Fades in/out and unmounts after the exit animation completes.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, Text } from 'react-native';

type InitialLoadSplashProps = {
  visible: boolean;
};

/** Full-screen branded splash; parent controls visibility (typically map-tab loading state). */
export function InitialLoadSplash({ visible }: InitialLoadSplashProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      opacity.setValue(0);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 320,
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.timing(opacity, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [opacity, visible]);

  if (!mounted) return null;

  return (
    <Animated.View style={[styles.overlay, { opacity }]} pointerEvents={visible ? 'auto' : 'none'}>
      <Image source={require('../../assets/rise-south-city-logo.png')} style={styles.logo} />
      <Text style={styles.loadingText}>Loading PurpleAir and Clarity data...</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 80,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    backgroundColor: '#f8fafc',
  },
  logo: {
    width: 164,
    height: 164,
    resizeMode: 'contain',
  },
  loadingText: {
    fontSize: 14,
    color: '#334155',
    fontWeight: '700',
  },
});
