package com.yayra.floating.android

import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
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

    /**
     * Chrome-style "Install page as app..." on Android: a REAL launcher
     * entry (pinned home-screen shortcut) for the site. Tapping it
     * deep-links straight back INTO Yayra on that site via the existing
     * com.yayra.app custom-scheme intent filter
     * (com.yayra.app:/browse?url=...), exactly like a Chrome
     * "Add to Home screen" web app.
     */
    @PluginMethod
    fun installSiteAsApp(call: PluginCall) {
        val url = call.getString("url")
        if (url.isNullOrBlank()) {
            call.reject("url-required")
            return
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            call.reject("invalid-url")
            return
        }
        val title = (call.getString("title") ?: url).trim().ifEmpty { url }
        val encoded = java.net.URLEncoder.encode(url, "UTF-8")
        val launchIntent = Intent(Intent.ACTION_VIEW, Uri.parse("com.yayra.app:/browse?url=$encoded")).apply {
            setPackage(context.packageName)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val shortcutManager = context.getSystemService(ShortcutManager::class.java)
                if (shortcutManager != null && shortcutManager.isRequestPinShortcutSupported) {
                    val logoResId = context.resources.getIdentifier("yayra_bubble_logo", "drawable", context.packageName)
                    val icon = if (logoResId != 0) {
                        Icon.createWithResource(context, logoResId)
                    } else {
                        Icon.createWithResource(context, android.R.drawable.ic_menu_view)
                    }
                    val shortcut = ShortcutInfo.Builder(context, "yayra-site-${url.hashCode()}")
                        .setShortLabel(title.take(10))
                        .setLongLabel(title.take(40))
                        .setIcon(icon)
                        .setIntent(launchIntent)
                        .build()
                    shortcutManager.requestPinShortcut(shortcut, null)
                    call.resolve(JSObject().put("ok", true).put("method", "pinned-shortcut"))
                    return
                }
            }
            // Legacy path (pre-Android-8 or launchers without pin support):
            // the INSTALL_SHORTCUT broadcast (permission is declared in the
            // manifest, injected by scripts/ensure-capacitor-platform.mjs).
            val broadcast = Intent("com.android.launcher.action.INSTALL_SHORTCUT").apply {
                putExtra(Intent.EXTRA_SHORTCUT_NAME, title)
                putExtra(Intent.EXTRA_SHORTCUT_INTENT, launchIntent)
            }
            val logoResId = context.resources.getIdentifier("yayra_bubble_logo", "drawable", context.packageName)
            if (logoResId != 0) {
                putExtra(
                    Intent.EXTRA_SHORTCUT_ICON_RESOURCE,
                    Intent.ShortcutIconResource.fromContext(context, logoResId)
                )
            }
            context.sendBroadcast(broadcast)
            call.resolve(JSObject().put("ok", true).put("method", "legacy-broadcast"))
        } catch (err: Exception) {
            call.reject("install-failed: ${err.message}")
        }
    }
}
