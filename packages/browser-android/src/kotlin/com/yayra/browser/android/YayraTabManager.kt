package com.yayra.browser.android

import android.content.Context
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.WebSettings
import android.webkit.WebView
import java.util.concurrent.ConcurrentHashMap

data class AndroidTabState(
    val id: String,
    var url: String,
    var title: String,
    var isDesktopMode: Boolean = false,
    var isIncognito: Boolean = false,
    var webViewState: Bundle? = null
)

/**
 * Manages multiple independent WebView tabs on Android.
 * Features:
 * - Dynamic view attachment / detachment into host ViewGroup
 * - Background state preservation without leak
 * - Desktop/Mobile User-Agent switching
 * - Session serialization and bundle restore
 */
class YayraTabManager(
    private val context: Context,
    private val webViewManager: YayraWebViewManager
) {
    private val tabs = ConcurrentHashMap<String, AndroidTabState>()
    private val webViews = ConcurrentHashMap<String, WebView>()
    private var activeTabId: String? = null
    private var activeContainer: ViewGroup? = null

    companion object {
        const val DESKTOP_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
        const val MOBILE_USER_AGENT = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36"
    }

    fun attachContainer(container: ViewGroup) {
        this.activeContainer = container
        activeTabId?.let { showTab(it) }
    }

    fun detachContainer() {
        activeTabId?.let { tabId ->
            webViews[tabId]?.let { wv ->
                (wv.parent as? ViewGroup)?.removeView(wv)
            }
        }
        this.activeContainer = null
    }

    fun createTab(tabId: String, initialUrl: String = "https://duckduckgo.com", isIncognito: Boolean = false): WebView {
        val tabState = AndroidTabState(
            id = tabId,
            url = initialUrl,
            title = "New Tab",
            isIncognito = isIncognito
        )
        tabs[tabId] = tabState

        val webView = webViewManager.createConfiguredWebView(tabId, isIncognito)
        webViews[tabId] = webView

        if (initialUrl.isNotBlank()) {
            webView.loadUrl(initialUrl)
        }

        return webView
    }

    fun selectTab(tabId: String) {
        if (!tabs.containsKey(tabId)) return
        activeTabId = tabId
        showTab(tabId)
    }

    private fun showTab(tabId: String) {
        val container = activeContainer ?: return
        val targetWv = webViews[tabId] ?: return

        // Detach current visible webview
        for (wv in webViews.values) {
            if (wv.parent == container && wv != targetWv) {
                container.removeView(wv)
                wv.onPause()
            }
        }

        // Attach target webview
        if (targetWv.parent != container) {
            (targetWv.parent as? ViewGroup)?.removeView(targetWv)
            container.addView(targetWv)
        }
        targetWv.onResume()
    }

    fun setDesktopMode(tabId: String, enabled: Boolean) {
        val tab = tabs[tabId] ?: return
        val wv = webViews[tabId] ?: return

        tab.isDesktopMode = enabled
        wv.settings.apply {
            userAgentString = if (enabled) DESKTOP_USER_AGENT else MOBILE_USER_AGENT
            useWideViewPort = enabled
            loadWithOverviewMode = enabled
        }
        wv.reload()
    }

    fun closeTab(tabId: String) {
        tabs.remove(tabId)
        webViews.remove(tabId)?.let { wv ->
            webViewManager.disposeWebView(wv)
        }

        if (activeTabId == tabId) {
            activeTabId = tabs.keys.firstOrNull()
            activeTabId?.let { selectTab(it) }
        }
    }

    fun getActiveWebView(): WebView? {
        val id = activeTabId ?: return null
        return webViews[id]
    }

    fun getActiveTabId(): String? = activeTabId

    fun getAllTabIds(): List<String> = tabs.keys.toList()

    fun saveTabStates(): List<AndroidTabState> {
        val results = mutableListOf<AndroidTabState>()
        for ((id, tab) in tabs) {
            webViews[id]?.let { wv ->
                tab.url = wv.url ?: tab.url
                tab.title = wv.title ?: tab.title
                val bundle = Bundle()
                wv.saveState(bundle)
                tab.webViewState = bundle
            }
            results.add(tab)
        }
        return results
    }

    fun restoreTabState(tab: AndroidTabState): WebView {
        tabs[tab.id] = tab
        val wv = webViewManager.createConfiguredWebView(tab.id, tab.isIncognito)
        webViews[tab.id] = wv

        if (tab.webViewState != null) {
            wv.restoreState(tab.webViewState!!)
        } else if (tab.url.isNotBlank()) {
            wv.loadUrl(tab.url)
        }

        return wv
    }

    fun destroy() {
        detachContainer()
        for (wv in webViews.values) {
            webViewManager.disposeWebView(wv)
        }
        webViews.clear()
        tabs.clear()
        activeTabId = null
    }
}
