package com.yayra.floating.android

import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.graphics.*
import android.os.Handler
import android.os.Looper
import android.util.AttributeSet
import android.util.TypedValue
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.animation.OvershootInterpolator

/**
 * Custom Android View for the 60dp Glassmorphism FloatBrowse Bubble.
 * Handles touch gestures, tap vs drag disambiguation, long press detection,
 * and high-fidelity hardware-accelerated canvas rendering.
 */
class YayraFloatingBubbleView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : View(context, attrs, defStyleAttr) {

    interface BubbleGestureListener {
        fun onBubbleTap()
        fun onBubbleLongPress()
        fun onBubbleDrag(deltaX: Float, deltaY: Float, rawX: Float, rawY: Float)
        fun onBubbleDragReleased(rawX: Float, rawY: Float)
    }

    var gestureListener: BubbleGestureListener? = null

    // Sizing (60dp default)
    private val bubbleDiameterPx = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, 60f, context.resources.displayMetrics
    )
    private val radius = bubbleDiameterPx / 2f

    // Configurable visual properties
    var idleOpacity: Float = 0.85f
        set(value) {
            field = value.coerceIn(0.2f, 1.0f)
            alpha = field
            invalidate()
        }

    var activeOpacity: Float = 1.0f
        set(value) {
            field = value.coerceIn(0.2f, 1.0f)
        }

    // Touch tracking
    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop.toFloat()
    private val longPressTimeout = ViewConfiguration.getLongPressTimeout().toLong()
    private val handler = Handler(Looper.getMainLooper())

    private var initialTouchX = 0f
    private var initialTouchY = 0f
    private var lastRawX = 0f
    private var lastRawY = 0f
    private var isDragging = false
    private var isLongPressFired = false

    private val longPressRunnable = Runnable {
        if (!isDragging) {
            isLongPressFired = true
            performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
            animateScale(1.15f)
            gestureListener?.onBubbleLongPress()
        }
    }

    // Rendering Paints
    private val glassPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val ringPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 2.5f
        color = Color.parseColor("#38bdf8")
    }
    private val corePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = Color.parseColor("#22d3ee")
    }
    private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 1.5f
        color = Color.argb(120, 255, 255, 255)
    }

    // Brand logo bitmap (logo-ONLY bubble, matching desktop/web): the
    // ensure-capacitor-platform script copies the transparent brand PNG
    // into res/drawable as `yayra_bubble_logo`. Resolved by name so this
    // file compiles even in a project without the asset - in that case
    // the legacy shader-drawn orb below is the fallback.
    private val logoPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val logoBitmap: Bitmap? = try {
        val resId = context.resources.getIdentifier("yayra_bubble_logo", "drawable", context.packageName)
        if (resId != 0) BitmapFactory.decodeResource(context.resources, resId) else null
    } catch (_err: Exception) {
        null
    }

    init {
        alpha = idleOpacity
        setLayerType(LAYER_TYPE_HARDWARE, null)
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val size = bubbleDiameterPx.toInt()
        setMeasuredDimension(size, size)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val cx = width / 2f
        val cy = height / 2f
        val r = radius - 4f // Inset for glow and stroke

        // Logo-ONLY bubble (product requirement on every platform): when the
        // brand asset is available the bubble IS the logo - no circular
        // glass plate, ring or glow painted behind it.
        val logo = logoBitmap
        if (logo != null) {
            val dest = RectF(0f, 0f, width.toFloat(), height.toFloat())
            canvas.drawBitmap(logo, null, dest, logoPaint)
            return
        }

        // 1. Subtle Outer Cyan Glow
        glowPaint.shader = RadialGradient(
            cx, cy, radius,
            intArrayOf(Color.argb(80, 6, 182, 212), Color.TRANSPARENT),
            floatArrayOf(0.7f, 1.0f),
            Shader.TileMode.CLAMP
        )
        canvas.drawCircle(cx, cy, radius, glowPaint)

        // 2. Glassmorphism Sphere Gradient
        glassPaint.shader = RadialGradient(
            cx - r * 0.35f, cy - r * 0.35f, r * 1.3f,
            intArrayOf(
                Color.parseColor("#38bdf8"),
                Color.parseColor("#0e7490"),
                Color.parseColor("#060b19")
            ),
            floatArrayOf(0.0f, 0.5f, 1.0f),
            Shader.TileMode.CLAMP
        )
        canvas.drawCircle(cx, cy, r, glassPaint)

        // 3. Orbital Ring
        canvas.save()
        canvas.rotate(-25f, cx, cy)
        val ringRect = RectF(cx - r * 1.05f, cy - r * 0.4f, cx + r * 1.05f, cy + r * 0.4f)
        canvas.drawOval(ringRect, ringPaint)
        canvas.restore()

        // 4. Center Glowing Orb Core
        corePaint.shader = RadialGradient(
            cx, cy, r * 0.35f,
            intArrayOf(Color.WHITE, Color.parseColor("#22d3ee")),
            null,
            Shader.TileMode.CLAMP
        )
        canvas.drawCircle(cx, cy, r * 0.32f, corePaint)

        // 5. Translucent Glass Border
        canvas.drawCircle(cx, cy, r, borderPaint)
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                initialTouchX = event.rawX
                initialTouchY = event.rawY
                lastRawX = event.rawX
                lastRawY = event.rawY
                isDragging = false
                isLongPressFired = false

                alpha = activeOpacity
                animateScale(0.92f)
                performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)

                handler.postDelayed(longPressRunnable, longPressTimeout)
                return true
            }

            MotionEvent.ACTION_MOVE -> {
                val dx = event.rawX - lastRawX
                val dy = event.rawY - lastRawY
                val totalDx = event.rawX - initialTouchX
                val totalDy = event.rawY - initialTouchY
                val dist = Math.hypot(totalDx.toDouble(), totalDy.toDouble()).toFloat()

                if (dist > touchSlop && !isDragging) {
                    isDragging = true
                    handler.removeCallbacks(longPressRunnable)
                    animateScale(1.05f)
                }

                if (isDragging) {
                    lastRawX = event.rawX
                    lastRawY = event.rawY
                    gestureListener?.onBubbleDrag(dx, dy, event.rawX, event.rawY)
                }
                return true
            }

            MotionEvent.ACTION_UP -> {
                handler.removeCallbacks(longPressRunnable)
                animateScale(1.0f)
                alpha = idleOpacity

                if (!isDragging && !isLongPressFired) {
                    performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
                    gestureListener?.onBubbleTap()
                } else if (isDragging) {
                    gestureListener?.onBubbleDragReleased(event.rawX, event.rawY)
                }
                return true
            }

            MotionEvent.ACTION_CANCEL -> {
                handler.removeCallbacks(longPressRunnable)
                animateScale(1.0f)
                alpha = idleOpacity
                isDragging = false
                return true
            }
        }
        return super.onTouchEvent(event)
    }

    private fun animateScale(targetScale: Float) {
        val animX = ValueAnimator.ofFloat(scaleX, targetScale).apply {
            duration = 180
            interpolator = OvershootInterpolator(1.2f)
            addUpdateListener {
                val v = it.animatedValue as Float
                scaleX = v
                scaleY = v
            }
        }
        animX.start()
    }
}
