package com.yayra.floating.android

import android.content.Intent
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Capacitor bridge for Yayra's REAL system-wide floating bubble on Android.
 *
 * This is the missing link between the web shell (BrowserShell.js) and the
 * native overlay stack that already lives in this package:
 *   - YayraOverlayPermissionHelper - SYSTEM_ALERT_WINDOW runtime permission
 *   - YayraFloatBubbleService      - user-controlled foreground Service
 *   - YayraFloatBubbleManager      - WindowManager TYPE_APPLICATION_OVERLAY
 *
 * With the "Display over other apps" permission granted, the bubble is a
 * true OS-level overlay (same mechanism as Messenger chat heads): it floats
 * above EVERY other application, the launcher and the home screen - not
 * just inside Yayra's own WebView.
 *
 * Registered in MainActivity by scripts/ensure-capacitor-platform.mjs,
 * which also injects the required permissions + <service> entry into
 * AndroidManifest.xml and copies these Kotlin sources into the generated
 * android/ project on every `npm run build:android`.
 *
 * JS surface (feature-detected via window.Capacitor.Plugins.YayraOverlay):
 *   isSupported()       -> { supported: true }
 *   hasPermission()     -> { granted: boolean }
 *   requestPermission() -> opens the system "Display over other apps" page
 *                          for this app; resolves { granted: <current> }
 *                          (Android grants it in Settings, not via dialog)
 *   show()              -> starts the foreground service + bubble overlay
 *   hide()              -> stops the service and removes the bubble
 */
@CapacitorPlugin(name = "YayraOverlay")
class YayraOverlayPlugin : Plugin() {

    @PluginMethod
    fun isSupported(call: PluginCall) {
        val result = JSObject()
        result.put("supported", true)
        call.resolve(result)
    }

    @PluginMethod
    fun hasPermission(call: PluginCall) {
        val result = JSObject()
        result.put("granted", YayraOverlayPermissionHelper.canDrawOverlays(context))
        call.resolve(result)
    }

    @PluginMethod
    fun requestPermission(call: PluginCall) {
        val granted = YayraOverlayPermissionHelper.canDrawOverlays(context)
        if (!granted) {
            try {
                val intent = YayraOverlayPermissionHelper.createPermissionIntent(context)
                context.startActivity(intent)
            } catch (err: Exception) {
                // Some OEM builds reject the package-specific page - fall
                // back to the general overlay-permission list.
                try {
                    context.startActivity(YayraOverlayPermissionHelper.createFallbackPermissionIntent())
                } catch (_err: Exception) {
                    call.reject("Could not open the overlay permission settings page")
                    return
                }
            }
        }
        val result = JSObject()
        result.put("granted", granted)
        call.resolve(result)
    }

    @PluginMethod
    fun show(call: PluginCall) {
        if (!YayraOverlayPermissionHelper.canDrawOverlays(context)) {
            call.reject("overlay-permission-not-granted")
            return
        }
        YayraFloatBubbleService.startService(context)
        call.resolve()
    }

    @PluginMethod
    fun hide(call: PluginCall) {
        YayraFloatBubbleService.stopService(context)
        call.resolve()
    }

    @PluginMethod
    fun minimizeApp(call: PluginCall) {
        // Convenience: minimize Yayra so the system bubble is immediately
        // floating over whatever the user switches to.
        val activity = activity
        if (activity != null) {
            activity.runOnUiThread { activity.moveTaskToBack(true) }
            call.resolve()
        } else {
            call.reject("no-activity")
        }
    }
}
