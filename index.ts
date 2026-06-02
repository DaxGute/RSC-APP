// App entry point (see package.json "main"). Must load gesture-handler and reanimated first.
import 'react-native-gesture-handler';
import 'react-native-reanimated';
import * as SplashScreen from 'expo-splash-screen';
import { registerRootComponent } from 'expo';
import App from './App';

// Keep splash visible until App hides it after fonts/data are ready.
void SplashScreen.preventAutoHideAsync().catch(() => {});

registerRootComponent(App);
