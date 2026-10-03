package com.yayra.floating.android

import android.app.*
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.view.*
import androidx.core.app.NotificationCompat

/**
 * System-wide Floating Overlay Service for Yayra Floating Browser on Android.
 * Runs as a Foreground Service to maintain persistent overlay without OS interruption.
 */
class YayraFloatWindowService : Service() {
    private lateinit var windowManager: WindowManager
    private var floatingCircleView: View? = null
    private var floatingBrowserView: View? = null
    private lateinit var circleParams: WindowManager.LayoutParams
    private lateinit var browserParams: WindowManager.LayoutParams

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        startForegroundNotification()
        setupOverlayLayouts()
    }

    private fun startForegroundNotification() {
        val channelId = "yayra_floating_channel"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId,
                "Yayra Floating Service",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }

        val notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle("Yayra Floating Browser")
            .setContentText("Floating bubble active on screen")
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .setOngoing(true)
            .build()

        startForeground(1001, notification)
    }

    private fun setupOverlayLayouts() {
        val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        circleParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            layoutType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 30
            y = 200
        }

        browserParams = WindowManager.LayoutParams(
            800,
            1200,
            layoutType,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
            WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.CENTER
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        floatingCircleView?.let { windowManager.removeView(it) }
        floatingBrowserView?.let { windowManager.removeView(it) }
        super.onDestroy()
    }
}
