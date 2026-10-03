package com.yayra.browser.android

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.webkit.*
import androidx.annotation.RequiresApi
import java.net.URISyntaxException

/**
 * Secure WebViewClient for Yayra Android Browser.
 * Enforces:
 * - Strict SSL error cancellation (NEVER bypass or auto-accept invalid certs)
 * - Navigation scheme filtering (block javascript:, data:, file:)
 * - Safe external intent resolution (mailto, tel, sms, geo) without intent injection
 * - Renderer process crash recovery
 * - Custom error page dispatching
 */
class YayraWebViewClient(
    private val context: Context,
    private val listener: WebViewNavigationListener
) : WebViewClient() {

    interface WebViewNavigationListener {
        fun onPageStarted(url: String, favicon: Bitmap?)
        fun onPageCommitted(url: String)
        fun onPageFinished(url: String)
        fun onNavigationError(errorCode: Int, description: String, failingUrl: String)
        fun onSslCertificateError(error: SslError, failingUrl: String)
        fun onRendererCrashed(killed: Boolean)
        fun onExternalIntentTriggered(uri: Uri): Boolean
    }

    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
        val uri = request?.url ?: return false
        val scheme = uri.scheme?.lowercase() ?: return false

        // Standard web navigation
        if (scheme == "http" || scheme == "https" || scheme == "about") {
            return false // Let WebView handle normal navigation
        }

        // Block dangerous schemes from executing
        if (scheme == "javascript" || scheme == "data" || scheme == "vbscript" || scheme == "file" || scheme == "content") {
            listener.onNavigationError(-10, "Blocked unsafe scheme: $scheme", uri.toString())
            return true
        }

        // Safe external app intents (mailto:, tel:, sms:, geo:, intent:)
        return handleExternalUri(uri)
    }

    private fun handleExternalUri(uri: Uri): Boolean {
        val scheme = uri.scheme?.lowercase() ?: return true

        try {
            if (scheme == "intent") {
                val intent = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME)
                intent.addCategory(Intent.CATEGORY_BROWSABLE)
                intent.component = null
                intent.selector = null

                // Verify intent resolves to an installed package
                val packageManager = context.packageManager
                val resolveInfo = packageManager.resolveActivity(intent, 0)
                if (resolveInfo != null) {
                    intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    context.startActivity(intent)
                    return true
                }

                // If intent specifies fallback URL, navigate to fallback
                val fallbackUrl = intent.getStringExtra("browser_fallback_url")
                if (!fallbackUrl.isNullOrBlank() && (fallbackUrl.startsWith("http://") || fallbackUrl.startsWith("https://"))) {
                    listener.onExternalIntentTriggered(Uri.parse(fallbackUrl))
                    return true
                }
                return true
            }

            // Safe URI schemes: mailto, tel, sms, geo
            if (scheme in listOf("mailto", "tel", "sms", "geo")) {
                val intent = Intent(Intent.ACTION_VIEW, uri).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                if (intent.resolveActivity(context.packageManager) != null) {
                    context.startActivity(intent)
                    return true
                }
            }
        } catch (e: URISyntaxException) {
            listener.onNavigationError(-11, "Malformed external URI", uri.toString())
        } catch (e: Exception) {
            listener.onNavigationError(-12, "Failed to launch external app", uri.toString())
        }
        return true
    }

    override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
        super.onPageStarted(view, url, favicon)
        url?.let { listener.onPageStarted(it, favicon) }
    }

    override fun onPageCommitVisible(view: WebView?, url: String?) {
        super.onPageCommitVisible(view, url)
        url?.let { listener.onPageCommitted(it) }
    }

    override fun onPageFinished(view: WebView?, url: String?) {
        super.onPageFinished(view, url)
        url?.let { listener.onPageFinished(it) }
    }

    /**
     * Strict SSL Verification: Cancel immediately on certificate error.
     * NEVER call handler.proceed() under any circumstances.
     */
    override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
        handler?.cancel() // ALWAYS REJECT invalid SSL/TLS certs
        val failingUrl = error?.url ?: view?.url ?: "unknown"
        error?.let { listener.onSslCertificateError(it, failingUrl) }
    }

    override fun onReceivedError(
        view: WebView?,
        request: WebResourceRequest?,
        error: WebResourceError?
    ) {
        super.onReceivedError(view, request, error)
        if (request?.isForMainFrame == true) {
            val errorCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                error?.errorCode ?: -1
            } else -1
            val description = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                error?.description?.toString() ?: "Navigation Error"
            } else "Navigation Error"

            val url = request.url?.toString() ?: "unknown"
            listener.onNavigationError(errorCode, description, url)
        }
    }

    @RequiresApi(Build.VERSION_CODES.O)
    override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
        val killed = detail?.didCrash() ?: false
        listener.onRendererCrashed(killed)
        return true // Prevent app termination
    }
}
