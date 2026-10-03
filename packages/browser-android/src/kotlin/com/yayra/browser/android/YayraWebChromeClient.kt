package com.yayra.browser.android

import android.graphics.Bitmap
import android.net.Uri
import android.os.Message
import android.webkit.*

/**
 * Secure WebChromeClient for Yayra Android Browser.
 * Enforces:
 * - Progress tracking (0 - 100)
 * - Page title & favicon updates
 * - Website permission request mediation (Never auto-grant camera/mic/location)
 * - Safe file chooser handling
 * - Multi-window creation delegation
 */
class YayraWebChromeClient(
    private val listener: WebChromeEventListener
) : WebChromeClient() {

    interface WebChromeEventListener {
        fun onProgressChanged(progress: Int)
        fun onReceivedTitle(title: String)
        fun onReceivedIcon(icon: Bitmap)
        fun onPermissionRequested(request: PermissionRequest)
        fun onGeolocationPermissionRequested(origin: String, callback: GeolocationPermissions.Callback)
        fun onShowFileChooser(filePathCallback: ValueCallback<Array<Uri>>?, fileChooserParams: FileChooserParams?): Boolean
        fun onCreateWindowRequested(resultMsg: Message?): Boolean
    }

    override fun onProgressChanged(view: WebView?, newProgress: Int) {
        super.onProgressChanged(view, newProgress)
        listener.onProgressChanged(newProgress)
    }

    override fun onReceivedTitle(view: WebView?, title: String?) {
        super.onReceivedTitle(view, title)
        title?.let { listener.onReceivedTitle(it) }
    }

    override fun onReceivedIcon(view: WebView?, icon: Bitmap?) {
        super.onReceivedIcon(view, icon)
        icon?.let { listener.onReceivedIcon(it) }
    }

    /**
     * Web API Permission requests (Camera, Microphone, MIDI, Protected Media).
     * Forward to listener for user authorization. NEVER call request.grant() automatically.
     */
    override fun onPermissionRequest(request: PermissionRequest?) {
        if (request != null) {
            listener.onPermissionRequested(request)
        }
    }

    override fun onPermissionRequestCanceled(request: PermissionRequest?) {
        super.onPermissionRequestCanceled(request)
    }

    /**
     * Geolocation permissions.
     * Forward to listener. NEVER grant automatically.
     */
    override fun onGeolocationPermissionsShowPrompt(
        origin: String?,
        callback: GeolocationPermissions.Callback?
    ) {
        if (origin != null && callback != null) {
            listener.onGeolocationPermissionRequested(origin, callback)
        } else {
            callback?.invoke(origin, false, false)
        }
    }

    override fun onShowFileChooser(
        webView: WebView?,
        filePathCallback: ValueCallback<Array<Uri>>?,
        fileChooserParams: FileChooserParams?
    ): Boolean {
        return listener.onShowFileChooser(filePathCallback, fileChooserParams)
    }

    override fun onCreateWindow(
        view: WebView?,
        isDialog: Boolean,
        isUserGesture: Boolean,
        resultMsg: Message?
    ): Boolean {
        return listener.onCreateWindowRequested(resultMsg)
    }
}
