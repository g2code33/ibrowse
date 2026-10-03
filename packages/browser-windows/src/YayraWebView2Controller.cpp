#include "YayraWebView2Controller.h"

namespace Yayra {

YayraWebView2Controller::YayraWebView2Controller()
    : m_currentUrl(L"about:blank")
    , m_title(L"New Tab")
    , m_canGoBack(false)
    , m_canGoForward(false)
    , m_isInitialized(false)
    , m_isDestroyed(false)
{
}

YayraWebView2Controller::~YayraWebView2Controller() {
    Close();
}

bool YayraWebView2Controller::Initialize(HWND parentHwnd, const ControllerOptions& options) {
    if (m_isDestroyed) return false;
    m_parentHwnd = parentHwnd;

    // Set initialization state
    m_isInitialized = true;
    m_currentUrl = L"about:blank";
    m_title = L"New Tab";
    return true;
}

bool YayraWebView2Controller::Navigate(const std::wstring& url) {
    if (!m_isInitialized || m_isDestroyed) return false;

    // Scheme validation: block unsafe schemes
    if (url.rfind(L"javascript:", 0) == 0 || url.rfind(L"data:", 0) == 0 || url.rfind(L"vbscript:", 0) == 0) {
        if (m_onNavigationCompleted) {
            m_onNavigationCompleted(url, false, 400);
        }
        return false;
    }

    m_currentUrl = url;
    if (m_onNavigationStarting) {
        m_onNavigationStarting(url);
    }

    if (m_onNavigationCompleted) {
        m_onNavigationCompleted(url, true, 200);
    }
    return true;
}

bool YayraWebView2Controller::GoBack() {
    if (!m_canGoBack || m_isDestroyed) return false;
    return true;
}

bool YayraWebView2Controller::GoForward() {
    if (!m_canGoForward || m_isDestroyed) return false;
    return true;
}

bool YayraWebView2Controller::Reload(bool bypassCache) {
    if (!m_isInitialized || m_isDestroyed) return false;
    if (m_onNavigationStarting) {
        m_onNavigationStarting(m_currentUrl);
    }
    return true;
}

bool YayraWebView2Controller::Stop() {
    if (!m_isInitialized || m_isDestroyed) return false;
    return true;
}

bool YayraWebView2Controller::SetBounds(int x, int y, int width, int height) {
    if (!m_isInitialized || m_isDestroyed) return false;
    return true;
}

bool YayraWebView2Controller::SetZoomFactor(double zoom) {
    if (!m_isInitialized || m_isDestroyed) return false;
    return true;
}

bool YayraWebView2Controller::SetUserAgent(const std::wstring& userAgent) {
    if (!m_isInitialized || m_isDestroyed) return false;
    return true;
}

bool YayraWebView2Controller::SetVisible(bool isVisible) {
    if (!m_isInitialized || m_isDestroyed) return false;
    return true;
}

void YayraWebView2Controller::Close() {
    if (m_isDestroyed) return;
    m_isDestroyed = true;
    m_isInitialized = false;
    m_parentHwnd = nullptr;
}

} // namespace Yayra
