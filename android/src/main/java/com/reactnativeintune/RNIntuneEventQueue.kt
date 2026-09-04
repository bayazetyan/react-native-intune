package com.reactnativeintune

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Events on their way to JS, and the queue for the ones that arrive too early.
 *
 * The emitter is live from module construction rather than from the first `enroll()`,
 * because a service-initiated wipe can arrive with no prior app call at all. Anything
 * emitted before JS subscribes is held rather than dropped: a wipe notification lost
 * during startup means the reset machine never runs (SPEC §4.4).
 */
internal class RNIntuneEventQueue(private val context: ReactApplicationContext) {

  private val pending = mutableListOf<Pair<String, WritableMap>>()
  private var listenerCount = 0

  /** Emits now if JS is listening, queues otherwise. */
  fun emit(event: String, payload: WritableMap) {
    synchronized(this) {
      if (listenerCount == 0) {
        pending += event to payload
        return
      }
    }
    send(event, payload)
  }

  fun addListener() {
    val queued =
      synchronized(this) {
        listenerCount += 1
        if (listenerCount != 1) return
        pending.toList().also { pending.clear() }
      }
    queued.forEach { (event, payload) -> send(event, payload) }
  }

  fun removeListeners(count: Int) {
    synchronized(this) { listenerCount = (listenerCount - count).coerceAtLeast(0) }
  }

  private fun send(event: String, payload: WritableMap) {
    context
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(event, payload)
  }
}
