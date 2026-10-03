#pragma once

#include <windows.h>
#include <string>
#include <functional>

namespace Yayra {

struct ControllerOptions {
    bool isIncognito = false;
    bool enableHardwareAcceleration = true;
    std::wstring userDataFolder;
    std::wstring additionalBrowserArguments;
};

/**
 * Native Win32 / WebView2 Controller for Yayra Floating Browser on 64-bit Windows.
 * Manages CoreWebView2Controller lifecycle, transparent HWND composition for glassmorphism,
 * strict TLS validation, and isolated per-tab browser surfaces.
 */
class YayraWebView2Controller {
public:
    YayraWebView2Controller();
    ~YayraWebView2Controller();

    bool Initialize(HWND parentHwnd, const ControllerOptions& options);
    bool Navigate(const std::wstring& url);
    bool GoBack();
    bool GoForward();
    bool Reload(bool bypassCache = false);
    bool Stop();
    bool SetBounds(int x, int y, int width, int height);
    bool SetZoomFactor(double zoom);
    bool SetUserAgent(const std::wstring& userAgent);
    bool SetVisible(bool isVisible);
    void Close();

    bool CanGoBack() const { return m_canGoBack; }
    bool CanGoForward() const { return m_canGoForward; }
    std::wstring GetCurrentUrl() const { return m_currentUrl; }
    std::wstring GetTitle() const { return m_title; }
    bool IsInitialized() const { return m_isInitialized; }

    // Event hooks
    void SetNavigationStartingCallback(std::function<void(const std::wstring& url)> callback) {
        m_onNavigationStarting = callback;
    }
    void SetNavigationCompletedCallback(std::function<void(const std::wstring& url, bool isSuccess, int httpStatus)> callback) {
        m_onNavigationCompleted = callback;
    }
    void SetTitleChangedCallback(std::function<void(const std::wstring& title)> callback) {
        m_onTitleChanged = callback;
    }
    void SetCertificateErrorCallback(std::function<void(const std::wstring& url, const std::wstring& error)> callback) {
        m_onCertificateError = callback;
    }

private:
    HWND m_parentHwnd = nullptr;
    std::wstring m_currentUrl;
    std::wstring m_title;
    bool m_canGoBack = false;
    bool m_canGoForward = false;
    bool m_isInitialized = false;
    bool m_isDestroyed = false;

    std::function<void(const std::wstring&)> m_onNavigationStarting;
    std::function<void(const std::wstring&, bool, int)> m_onNavigationCompleted;
    std::function<void(const std::wstring&)> m_onTitleChanged;
    std::function<void(const std::wstring&, const std::wstring&)> m_onCertificateError;
};

} // namespace Yayra
