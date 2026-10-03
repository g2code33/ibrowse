package com.yayra.floating.android

import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import android.content.res.Configuration
import android.graphics.PixelFormat
import android.os.Build
import android.util.DisplayMetrics
import android.view.*
import android.view.animation.DecelerateInterpolator

/**
 * Manages the floating bubble WindowManager lifecycle, edge snapping physics,
 * display cutout avoidance, and position persistence across app restarts and rotation.
 */
class YayraFloatBubbleManager(
    private val context: Context,
    private val onBubbleTapListener: () -> Unit,
    private val onQuickActionListener: (YayraQuickActionsView.QuickAction) -> Unit
) : YayraFloatingBubbleView.BubbleGestureListener {

    private val windowManager: WindowManager =
        context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val prefs: SharedPreferences =
        context.getSharedPreferences("yayra_floating_bubble_prefs", Context.MODE_PRIVATE)

    private var bubbleView: YayraFloatingBubbleView? = null
    private var quickActionsView: YayraQuickActionsView? = null
    private lateinit var bubbleParams: WindowManager.LayoutParams
    private var isBubbleAttached = false

    // Screen Dimensions & Insets
    private var screenWidth = 1080
    private var screenHeight = 2400
    private var statusBarHeight = 72
    private var navBarHeight = 120
    private var safeMargin = 16

    init {
        updateScreenMetrics()
        createBubbleParams()
    }

    private fun updateScreenMetrics() {
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        windowManager.defaultDisplay.getMetrics(metrics)
        screenWidth = metrics.widthPixels
        screenHeight = metrics.heightPixels
    }

    private fun createBubbleParams() {
        val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        bubbleParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            layoutType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }

        // Restore saved position
        restoreSavedPosition()
    }

    fun showBubble() {
        if (!YayraOverlayPermissionHelper.canDrawOverlays(context)) {
            return
        }

        if (!isBubbleAttached) {
            bubbleView = YayraFloatingBubbleView(context).apply {
                gestureListener = this@YayraFloatBubbleManager
            }
            try {
                windowManager.addView(bubbleView, bubbleParams)
                isBubbleAttached = true
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    fun hideBubble() {
        dismissQuickActions()
        if (isBubbleAttached && bubbleView != null) {
            try {
                windowManager.removeView(bubbleView)
            } catch (e: Exception) {
                e.printStackTrace()
            }
            bubbleView = null
            isBubbleAttached = false
        }
    }

    // Gesture Callbacks
    override fun onBubbleTap() {
        dismissQuickActions()
        onBubbleTapListener.invoke()
    }

    override fun onBubbleLongPress() {
        showQuickActions()
    }

    override fun onBubbleDrag(deltaX: Float, deltaY: Float, rawX: Float, rawY: Float) {
        dismissQuickActions()
        bubbleParams.x = (bubbleParams.x + deltaX.toInt()).coerceIn(
            safeMargin, screenWidth - (bubbleView?.width ?: 160) - safeMargin
        )
        bubbleParams.y = (bubbleParams.y + deltaY.toInt()).coerceIn(
            statusBarHeight + safeMargin, screenHeight - navBarHeight - (bubbleView?.height ?: 160) - safeMargin
        )

        if (isBubbleAttached && bubbleView != null) {
            windowManager.updateViewLayout(bubbleView, bubbleParams)
        }
    }

    override fun onBubbleDragReleased(rawX: Float, rawY: Float) {
        val bubbleWidth = bubbleView?.width ?: 160
        val midX = screenWidth / 2

        // Snap to nearest edge
        val targetX = if (rawX < midX) {
            safeMargin
        } else {
            screenWidth - bubbleWidth - safeMargin
        }

        animateSnapX(targetX)
        savePosition(targetX, bubbleParams.y)
    }

    private fun animateSnapX(targetX: Int) {
        val startX = bubbleParams.x
        val animator = ValueAnimator.ofInt(startX, targetX).apply {
            duration = 260
            interpolator = DecelerateInterpolator(1.5f)
            addUpdateListener {
                bubbleParams.x = it.animatedValue as Int
                if (isBubbleAttached && bubbleView != null) {
                    try {
                        windowManager.updateViewLayout(bubbleView, bubbleParams)
                    } catch (e: Exception) {
                        // ignore if unattached during animation
                    }
                }
            }
        }
        animator.start()
    }

    private fun showQuickActions() {
        if (quickActionsView != null) return

        val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val quickActionParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            layoutType,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
            WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
            PixelFormat.TRANSLUCENT
        )

        quickActionsView = YayraQuickActionsView(
            context,
            onActionSelected = { action ->
                dismissQuickActions()
                onQuickActionListener.invoke(action)
            },
            onDismiss = { dismissQuickActions() }
        )

        try {
            windowManager.addView(quickActionsView, quickActionParams)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun dismissQuickActions() {
        if (quickActionsView != null) {
            try {
                windowManager.removeView(quickActionsView)
            } catch (e: Exception) {
                e.printStackTrace()
            }
            quickActionsView = null
        }
    }

    fun onConfigurationChanged(newConfig: Configuration) {
        updateScreenMetrics()
        // Clamp existing position to new screen bounds & re-snap
        val bubbleWidth = bubbleView?.width ?: 160
        val isLeft = bubbleParams.x < screenWidth / 2
        val targetX = if (isLeft) safeMargin else screenWidth - bubbleWidth - safeMargin
        bubbleParams.x = targetX
        bubbleParams.y = bubbleParams.y.coerceIn(
            statusBarHeight + safeMargin, screenHeight - navBarHeight - (bubbleView?.height ?: 160) - safeMargin
        )
        if (isBubbleAttached && bubbleView != null) {
            windowManager.updateViewLayout(bubbleView, bubbleParams)
        }
    }

    private fun savePosition(x: Int, y: Int) {
        val xPercent = x.toFloat() / screenWidth.toFloat()
        val yPercent = y.toFloat() / screenHeight.toFloat()
        prefs.edit()
            .putFloat("bubble_x_percent", xPercent)
            .putFloat("bubble_y_percent", yPercent)
            .apply()
    }

    private fun restoreSavedPosition() {
        val xPercent = prefs.getFloat("bubble_x_percent", 0.05f)
        val yPercent = prefs.getFloat("bubble_y_percent", 0.35f)
        bubbleParams.x = (xPercent * screenWidth).toInt().coerceIn(safeMargin, screenWidth - 160)
        bubbleParams.y = (yPercent * screenHeight).toInt().coerceIn(statusBarHeight + safeMargin, screenHeight - 200)
    }

    fun destroy() {
        hideBubble()
    }
}
