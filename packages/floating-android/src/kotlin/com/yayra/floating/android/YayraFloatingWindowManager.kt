package com.yayra.floating.android

import android.content.Context
import android.content.SharedPreferences
import android.content.res.Configuration
import android.graphics.PixelFormat
import android.os.Build
import android.util.DisplayMetrics
import android.util.TypedValue
import android.view.*
import android.webkit.WebView

/**
 * Coordinates the Android WindowManager lifecycle for the resizable Floating Browser Window.
 * Manages dimensions, positions, safe insets, and WebView session attach/detach protocols.
 */
class YayraFloatingWindowManager(
    private val context: Context,
    private val onMinimizeCallback: () -> Unit,
    private val onCloseCallback: () -> Unit,
    private val onNavigateCallback: (String) -> Unit
) : YayraFloatingBrowserWindowView.WindowInteractionListener {

    private val windowManager: WindowManager =
        context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val prefs: SharedPreferences =
        context.getSharedPreferences("yayra_floating_window_prefs", Context.MODE_PRIVATE)

    private var windowView: YayraFloatingBrowserWindowView? = null
    private lateinit var windowParams: WindowManager.LayoutParams
    private var isWindowAttached = false
    private var isMaximized = false
    private var preMaximizeBounds = Rect(0, 0, 0, 0)

    // Screen Dimensions & Bounds
    private var screenWidth = 1080
    private var screenHeight = 2400
    private var statusBarHeight = 72
    private var navBarHeight = 120
    private var safeMargin = 16

    val minWidthPx = dpToPx(280)
    val minHeightPx = dpToPx(360)

    init {
        updateScreenMetrics()
        createWindowParams()
    }

    private fun updateScreenMetrics() {
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        windowManager.defaultDisplay.getMetrics(metrics)
        screenWidth = metrics.widthPixels
        screenHeight = metrics.heightPixels
    }

    private fun createWindowParams() {
        val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val defaultWidth = (screenWidth * 0.85f).toInt().coerceAtLeast(minWidthPx)
        val defaultHeight = (screenHeight * 0.60f).toInt().coerceAtLeast(minHeightPx)

        windowParams = WindowManager.LayoutParams(
            defaultWidth,
            defaultHeight,
            layoutType,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = (screenWidth - defaultWidth) / 2
            y = statusBarHeight + dpToPx(30)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }

        restoreSavedBounds()
    }

    fun showBrowserWindow(webView: WebView? = null) {
        if (!YayraOverlayPermissionHelper.canDrawOverlays(context)) return

        if (!isWindowAttached) {
            windowView = YayraFloatingBrowserWindowView(context).apply {
                interactionListener = this@YayraFloatingWindowManager
            }
            if (webView != null) {
                windowView?.attachWebView(webView)
            }
            try {
                windowManager.addView(windowView, windowParams)
                isWindowAttached = true
            } catch (e: Exception) {
                e.printStackTrace()
            }
        } else if (webView != null) {
            windowView?.attachWebView(webView)
        }
    }

    fun hideBrowserWindow(): WebView? {
        var detachedWebView: WebView? = null
        if (isWindowAttached && windowView != null) {
            detachedWebView = windowView?.detachWebView()
            try {
                windowManager.removeView(windowView)
            } catch (e: Exception) {
                e.printStackTrace()
            }
            windowView = null
            isWindowAttached = false
        }
        return detachedWebView
    }

    fun isVisible(): Boolean = isWindowAttached

    fun getWindowBounds(): Rect {
        return Rect(windowParams.x, windowParams.y, windowParams.x + windowParams.width, windowParams.y + windowParams.height)
    }

    // Window Interaction Callbacks
    override fun onWindowMove(deltaX: Float, deltaY: Float) {
        if (isMaximized) return

        val maxAllowedX = screenWidth - windowParams.width - safeMargin
        val minAllowedY = statusBarHeight + safeMargin
        val maxAllowedY = screenHeight - navBarHeight - windowParams.height - safeMargin

        windowParams.x = (windowParams.x + deltaX.toInt()).coerceIn(safeMargin, maxAllowedX.coerceAtLeast(safeMargin))
        windowParams.y = (windowParams.y + deltaY.toInt()).coerceIn(minAllowedY, maxAllowedY.coerceAtLeast(minAllowedY))

        updateViewLayout()
        saveBounds()
    }

    override fun onWindowResize(deltaWidth: Float, deltaHeight: Float) {
        if (isMaximized) return

        val maxAllowedW = screenWidth - windowParams.x - safeMargin
        val maxAllowedH = screenHeight - windowParams.y - navBarHeight - safeMargin

        val newW = (windowParams.width + deltaWidth.toInt()).coerceIn(minWidthPx, maxAllowedW.coerceAtLeast(minWidthPx))
        val newH = (windowParams.height + deltaHeight.toInt()).coerceIn(minHeightPx, maxAllowedH.coerceAtLeast(minHeightPx))

        windowParams.width = newW
        windowParams.height = newH

        updateViewLayout()
        saveBounds()
    }

    override fun onMinimizeClicked() {
        onMinimizeCallback.invoke()
    }

    override fun onMaximizeClicked() {
        if (!isMaximized) {
            preMaximizeBounds = Rect(windowParams.x, windowParams.y, windowParams.width, windowParams.height)
            windowParams.x = safeMargin
            windowParams.y = statusBarHeight + safeMargin
            windowParams.width = screenWidth - (2 * safeMargin)
            windowParams.height = screenHeight - statusBarHeight - navBarHeight - (2 * safeMargin)
            isMaximized = true
        } else {
            windowParams.x = preMaximizeBounds.left
            windowParams.y = preMaximizeBounds.top
            windowParams.width = preMaximizeBounds.right
            windowParams.height = preMaximizeBounds.bottom
            isMaximized = false
        }
        updateViewLayout()
    }

    override fun onCloseClicked() {
        onCloseCallback.invoke()
    }

    override fun onNavigateRequested(url: String) {
        onNavigateCallback.invoke(url)
    }

    override fun onBackClicked() {
        val wv = windowView?.getChildAt(0) as? WebView
        if (wv?.canGoBack() == true) wv.goBack()
    }

    override fun onForwardClicked() {
        val wv = windowView?.getChildAt(0) as? WebView
        if (wv?.canGoForward() == true) wv.goForward()
    }

    override fun onReloadClicked() {
        val wv = windowView?.getChildAt(0) as? WebView
        wv?.reload()
    }

    override fun onStopClicked() {
        val wv = windowView?.getChildAt(0) as? WebView
        wv?.stopLoading()
    }

    private fun updateViewLayout() {
        if (isWindowAttached && windowView != null) {
            try {
                windowManager.updateViewLayout(windowView, windowParams)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    fun onConfigurationChanged(newConfig: Configuration) {
        updateScreenMetrics()
        // Clamp bounds to new screen orientation
        val maxW = screenWidth - (2 * safeMargin)
        val maxH = screenHeight - statusBarHeight - navBarHeight - (2 * safeMargin)
        windowParams.width = windowParams.width.coerceIn(minWidthPx, maxW.coerceAtLeast(minWidthPx))
        windowParams.height = windowParams.height.coerceIn(minHeightPx, maxH.coerceAtLeast(minHeightPx))
        windowParams.x = windowParams.x.coerceIn(safeMargin, (screenWidth - windowParams.width - safeMargin).coerceAtLeast(safeMargin))
        windowParams.y = windowParams.y.coerceIn(statusBarHeight + safeMargin, (screenHeight - navBarHeight - windowParams.height - safeMargin).coerceAtLeast(statusBarHeight + safeMargin))
        updateViewLayout()
    }

    private fun saveBounds() {
        prefs.edit()
            .putInt("window_x", windowParams.x)
            .putInt("window_y", windowParams.y)
            .putInt("window_width", windowParams.width)
            .putInt("window_height", windowParams.height)
            .apply()
    }

    private fun restoreSavedBounds() {
        val savedW = prefs.getInt("window_width", windowParams.width)
        val savedH = prefs.getInt("window_height", windowParams.height)
        val savedX = prefs.getInt("window_x", windowParams.x)
        val savedY = prefs.getInt("window_y", windowParams.y)

        windowParams.width = savedW.coerceIn(minWidthPx, screenWidth - 2 * safeMargin)
        windowParams.height = savedH.coerceIn(minHeightPx, screenHeight - statusBarHeight - navBarHeight - 2 * safeMargin)
        windowParams.x = savedX.coerceIn(safeMargin, screenWidth - windowParams.width - safeMargin)
        windowParams.y = savedY.coerceIn(statusBarHeight + safeMargin, screenHeight - navBarHeight - windowParams.height - safeMargin)
    }

    private fun dpToPx(dp: Int): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP, dp.toFloat(), context.resources.displayMetrics
        ).toInt()
    }

    fun destroy() {
        hideBrowserWindow()
    }
}
