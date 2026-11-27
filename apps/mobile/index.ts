import { registerRootComponent } from 'expo';

// Registers the background location task at startup (must happen before the app renders).
import './src/backgroundLocation';
import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
