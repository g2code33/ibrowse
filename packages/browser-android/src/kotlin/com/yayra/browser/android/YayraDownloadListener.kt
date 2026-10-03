package com.yayra.browser.android

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.URLUtil

/**
 * Native Android DownloadListener for Yayra.
 * Integrates with Android DownloadManager service with cookie propagation,
 * user-agent forwarding, and sandboxed storage paths.
 */
class YayraDownloadListener(
    private val context: Context,
    private val onDownloadStarted: ((url: String, filename: String, mimeType: String, contentLength: Long) -> Unit)? = null
) : DownloadListener {

    override fun onDownloadStart(
        url: String?,
        userAgent: String?,
        contentDisposition: String?,
        mimetype: String?,
        contentLength: Long
    ) {
        if (url == null || (!url.startsWith("http://") && !url.startsWith("https://"))) {
            return
        }

        val filename = URLUtil.guessFileName(url, contentDisposition, mimetype)
        val cookies = CookieManager.getInstance().getCookie(url)

        try {
            val request = DownloadManager.Request(Uri.parse(url)).apply {
                setMimeType(mimetype ?: "application/octet-stream")
                addRequestHeader("cookie", cookies)
                addRequestHeader("User-Agent", userAgent)
                setDescription("Downloading $filename via Yayra Floating Browser")
                setTitle(filename)
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename)
            }

            val downloadManager = context.getSystemService(Context.DOWNLOAD_SERVICE) as? DownloadManager
            downloadManager?.enqueue(request)

            onDownloadStarted?.invoke(url, filename, mimetype ?: "application/octet-stream", contentLength)
        } catch (e: Exception) {
            // Log or report download trigger failure
        }
    }
}
