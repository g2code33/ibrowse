package com.yayra.floating.android

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Glassmorphism Quick Actions menu presented when long-pressing the floating bubble.
 */
@SuppressLint("ViewConstructor")
class YayraQuickActionsView(
    context: Context,
    private val onActionSelected: (QuickAction) -> Unit,
    private val onDismiss: () -> Unit
) : FrameLayout(context) {

    enum class QuickAction {
        NEW_TAB,
        SEARCH,
        SETTINGS,
        CLOSE_BUBBLE
    }

    init {
        setupView()
    }

    private fun setupView() {
        setBackgroundColor(Color.argb(100, 0, 0, 0))
        setOnClickListener { onDismiss() }

        val cardLayout = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dpToPx(16), dpToPx(12), dpToPx(16), dpToPx(12))

            // Glassmorphism card styling
            background = GradientDrawable().apply {
                setColor(Color.argb(220, 13, 23, 54))
                cornerRadius = dpToPx(16).toFloat()
                setStroke(dpToPx(1), Color.argb(80, 255, 255, 255))
            }
        }

        // Title Header
        val header = TextView(context).apply {
            text = "Yayra Quick Actions"
            setTextColor(Color.parseColor("#38bdf8"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setPadding(0, 0, 0, dpToPx(8))
        }
        cardLayout.addView(header)

        // Add Action Buttons
        cardLayout.addView(createActionButton("New Tab", "🌐", QuickAction.NEW_TAB))
        cardLayout.addView(createActionButton("Instant Search", "🔍", QuickAction.SEARCH))
        cardLayout.addView(createActionButton("Settings", "⚙️", QuickAction.SETTINGS))
        cardLayout.addView(createActionButton("Dismiss Bubble", "✕", QuickAction.CLOSE_BUBBLE, true))

        val cardParams = LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT).apply {
            gravity = Gravity.CENTER
        }
        addView(cardLayout, cardParams)
    }

    private fun createActionButton(label: String, iconStr: String, action: QuickAction, isDanger: Boolean = false): View {
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dpToPx(12), dpToPx(10), dpToPx(12), dpToPx(10))
            isClickable = true
            isFocusable = true

            background = GradientDrawable().apply {
                setColor(Color.argb(40, 255, 255, 255))
                cornerRadius = dpToPx(8).toFloat()
            }

            setOnClickListener {
                onActionSelected(action)
                onDismiss()
            }
        }

        val iconView = TextView(context).apply {
            text = iconStr
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setPadding(0, 0, dpToPx(10), 0)
        }

        val textView = TextView(context).apply {
            text = label
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setTextColor(if (isDanger) Color.parseColor("#ef4444") else Color.WHITE)
        }

        row.addView(iconView)
        row.addView(textView)

        val rowParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            setMargins(0, dpToPx(4), 0, dpToPx(4))
        }
        row.layoutParams = rowParams
        return row
    }

    private fun dpToPx(dp: Int): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP, dp.toFloat(), resources.displayMetrics
        ).toInt()
    }
}
