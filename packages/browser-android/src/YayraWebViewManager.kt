package com.yayra.browser.android

import android.content.Context
import android.graphics.Bitmap
import android.net.http.SslError
import android.view.ViewGroup
import android.webkit.*

/**
 * Hardened Android WebView Factory & Lifecycle Manager for Yayra.
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

            setBackgroundColor(0x00000000)
            setLayerType(WebView.LAYER_TYPE_HARDWARE, null)

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = !isIncognito
                databaseEnabled = !isIncognito

                allowFileAccess = false
                allowContentAccess = false
                allowFileAccessFromFileURLs = false
                allowUniversalAccessFromFileURLs = false
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                setGeolocationEnabled(false)

                useWideViewPort = true
                loadWithOverviewMode = true
                builtInZoomControls = true
                displayZoomControls = false
                textZoom = 100

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
