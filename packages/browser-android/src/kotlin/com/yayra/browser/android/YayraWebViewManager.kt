package com.yayra.browser.android

import android.content.Context
import android.graphics.Bitmap
import android.net.http.SslError
import android.view.ViewGroup
import android.webkit.*

/**
 * Hardened Android WebView Factory & Lifecycle Manager for Yayra.
 * Enforces:
 * - Local-first offline capability with hardware acceleration
 * - Strict sandboxing (file/content access disabled)
 * - Safe mixed content rejection
 * - Clean disposal to eliminate memory leaks
 */
class YayraWebViewManager(
    private val appContext: Context,
    private val navigationListener: YayraWebViewClient.WebViewNavigationListener? = null,
    private val chromeListener: YayraWebChromeClient.WebChromeEventListener? = null
) {

    fun createConfiguredWebView(tabId: String, isIncognito: Boolean = false): WebView {
        val webView = WebView(appContext).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )

            // Transparent background for glassmorphism layer compositing
            setBackgroundColor(0x00000000)
            setLayerType(WebView.LAYER_TYPE_HARDWARE, null)

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = !isIncognito
                databaseEnabled = !isIncognito

                // Strict Sandboxing & Security
                allowFileAccess = false
                allowContentAccess = false
                allowFileAccessFromFileURLs = false
                allowUniversalAccessFromFileURLs = false
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                setGeolocationEnabled(false)

                // Viewport & Zoom Configuration
                useWideViewPort = true
                loadWithOverviewMode = true
                builtInZoomControls = true
                displayZoomControls = false
                textZoom = 100

                // Cache & Network Behavior
                cacheMode = if (isIncognito) WebSettings.LOAD_NO_CACHE else WebSettings.LOAD_DEFAULT
            }

            if (navigationListener != null) {
                webViewClient = YayraWebViewClient(appContext, navigationListener)
            }

            if (chromeListener != null) {
                webChromeClient = YayraWebChromeClient(chromeListener)
            }

            setDownloadListener(YayraDownloadListener(appContext))
        }

        if (isIncognito) {
            CookieManager.getInstance().setAcceptCookie(false)
        }

        return webView
    }

    /**
     * Cleanly teardown and dispose a WebView instance to ensure zero retained references.
     */
    fun disposeWebView(webView: WebView) {
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.stopLoading()
        webView.onPause()
        webView.clearHistory()
        webView.clearCache(true)
        webView.loadUrl("about:blank")
        webView.removeAllViews()
        webView.destroy()
    }
}
