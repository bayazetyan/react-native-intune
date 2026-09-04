/**
 * The one emitter instance, constructed at import time.
 *
 * Import time and not on first use, deliberately: a service-initiated wipe can arrive
 * before the app has called anything at all, and native queues events until JS
 * subscribes. An emitter created lazily would miss the very events that matter most
 * (SPEC §4.4).
 */

import { NativeEventEmitter } from 'react-native';

import NativeIntune from '../NativeIntune';

export const emitter = new NativeEventEmitter(NativeIntune);
