import { NativeModules, Platform } from 'react-native';

const LINKING_ERROR =
  `The package 'react-native-intune' doesn't seem to be linked. Make sure: \n\n` +
  Platform.select({ ios: "- You have run 'pod install'\n", default: '' }) +
  '- You rebuilt the app after installing the package\n' +
  '- You are not using Expo managed workflow\n';

const Intune = NativeModules.Intune
  ? NativeModules.Intune
  : new Proxy(
      {},
      {
        get() {
          throw new Error(LINKING_ERROR);
        },
      }
    );

export const registerAndEnroll = () => {
  // WIP
  Intune.registerAndEnroll();
};
