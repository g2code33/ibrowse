#include "YayraFloatingHost.h"

namespace Yayra {

static YayraFloatingHost* g_pHostInstance = nullptr;

YayraFloatingHost::YayraFloatingHost(HINSTANCE hInstance)
    : m_hInstance(hInstance),
      m_hwndBubble(nullptr),
      m_hwndBrowser(nullptr),
      m_hSingleInstanceMutex(nullptr),
      m_trayActive(false),
      m_mode(DesktopFloatingMode::CircleFirst),
      m_alwaysOnTop(true),
      m_minimizeToBubble(true),
      m_closeToTray(true),
      m_isDragging(false) {
    ZeroMemory(&m_nid, sizeof(m_nid));
    ZeroMemory(&m_dragStart, sizeof(m_dragStart));
    ZeroMemory(&m_dragWindowStart, sizeof(m_dragWindowStart));
    g_pHostInstance = this;
}

YayraFloatingHost::~YayraFloatingHost() {
    Shutdown();
    if (g_pHostInstance == this) {
        g_pHostInstance = nullptr;
    }
}

bool YayraFloatingHost::EnsureSingleInstance() {
    m_hSingleInstanceMutex = CreateMutexW(NULL, TRUE, L"Local\\YayraFloatingBrowserSingleInstanceMutex");
    if (GetLastError() == ERROR_ALREADY_EXISTS) {
        // Find existing instance and bring to front
        HWND existingBrowser = FindWindowW(L"YayraFloatingBrowserWindowClass", NULL);
        if (existingBrowser) {
            PostMessageW(existingBrowser, WM_YAYRA_SECOND_INSTANCE, 0, 0);
        }
        if (m_hSingleInstanceMutex) {
            CloseHandle(m_hSingleInstanceMutex);
            m_hSingleInstanceMutex = nullptr;
        }
        return false;
    }
    return true;
}

bool YayraFloatingHost::Initialize(DesktopFloatingMode mode) {
    m_mode = mode;

    m_hwndBubble = CreateBubbleWindow();
    m_hwndBrowser = CreateBrowserWindow();

    if (!m_hwndBubble || !m_hwndBrowser) {
        return false;
    }

    InitSystemTray(L"Yayra Floating Browser");
    SetMode(mode);

    return true;
}

void YayraFloatingHost::Shutdown() {
    RemoveSystemTray();

    if (m_hwndBrowser) {
        DestroyWindow(m_hwndBrowser);
        m_hwndBrowser = nullptr;
    }

    if (m_hwndBubble) {
        DestroyWindow(m_hwndBubble);
        m_hwndBubble = nullptr;
    }

    if (m_hSingleInstanceMutex) {
        ReleaseMutex(m_hSingleInstanceMutex);
        CloseHandle(m_hSingleInstanceMutex);
        m_hSingleInstanceMutex = nullptr;
    }
}

void YayraFloatingHost::SetMode(DesktopFloatingMode mode) {
    m_mode = mode;
    if (m_mode == DesktopFloatingMode::CircleFirst) {
        ShowBubble();
        HideBrowser();
    } else {
        HideBubble();
        ShowBrowser(true);
    }
}

void YayraFloatingHost::ShowBrowser(bool activate) {
    if (!m_hwndBrowser) return;

    UINT flags = SWP_SHOWWINDOW | SWP_NOMOVE | SWP_NOSIZE;
    if (!activate) {
        flags |= SWP_NOACTIVATE;
    }

    HWND insertAfter = m_alwaysOnTop ? HWND_TOPMOST : HWND_NOTOPMOST;
    SetWindowPos(m_hwndBrowser, insertAfter, 0, 0, 0, 0, flags);
    ShowWindow(m_hwndBrowser, activate ? SW_SHOW : SW_SHOWNA);

    if (m_mode == DesktopFloatingMode::BrowserFirst) {
        HideBubble();
    }
}

void YayraFloatingHost::MinimizeBrowser(bool toBubble) {
    if (!m_hwndBrowser) return;

    ShowWindow(m_hwndBrowser, SW_HIDE);

    if (toBubble || m_minimizeToBubble) {
        ShowBubble();
    }
}

void YayraFloatingHost::HideBrowser() {
    if (m_hwndBrowser) {
        ShowWindow(m_hwndBrowser, SW_HIDE);
    }
}

void YayraFloatingHost::ShowBubble() {
    if (!m_hwndBubble) return;

    HWND insertAfter = m_alwaysOnTop ? HWND_TOPMOST : HWND_NOTOPMOST;
    SetWindowPos(m_hwndBubble, insertAfter, 0, 0, 0, 0, SWP_SHOWWINDOW | SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    ShowWindow(m_hwndBubble, SW_SHOWNOACTIVATE);
}

void YayraFloatingHost::HideBubble() {
    if (m_hwndBubble) {
        ShowWindow(m_hwndBubble, SW_HIDE);
    }
}

void YayraFloatingHost::SetAlwaysOnTop(bool topmost) {
    m_alwaysOnTop = topmost;
    HWND insertAfter = topmost ? HWND_TOPMOST : HWND_NOTOPMOST;

    if (m_hwndBrowser) {
        SetWindowPos(m_hwndBrowser, insertAfter, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
    if (m_hwndBubble) {
        SetWindowPos(m_hwndBubble, insertAfter, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
}

void YayraFloatingHost::ApplyGlassmorphism(HWND hwnd) {
    if (!hwnd) return;

    // Apply Windows 11 Acrylic / Mica Transient Backdrop
    DWM_SYSTEMBACKDROP_TYPE backdrop = DWMSBT_TRANSIENTWINDOW;
    DwmSetWindowAttribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, &backdrop, sizeof(backdrop));

    // Enable rounded corners preference
    DWM_WINDOW_CORNER_PREFERENCE cornerPref = DWMWCP_ROUND;
    DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, &cornerPref, sizeof(cornerPref));

    // Extend Frame Margins into client area for seamless glass
    MARGINS margins = { -1, -1, -1, -1 };
    DwmExtendFrameIntoClientArea(hwnd, &margins);
}

HWND YayraFloatingHost::CreateBubbleWindow() {
    WNDCLASSEXW wc = { sizeof(WNDCLASSEXW) };
    wc.lpfnWndProc = BubbleWndProc;
    wc.hInstance = m_hInstance;
    wc.lpszClassName = L"YayraFloatingBubbleWindowClass";
    wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
    wc.hbrBackground = (HBRUSH)GetStockObject(BLACK_BRUSH);
    RegisterClassExW(&wc);

    // Bubble is a tool window (hidden from taskbar/Alt-Tab) with layered acrylic glass
    HWND hwnd = CreateWindowExW(
        WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
        wc.lpszClassName,
        L"Yayra Bubble",
        WS_POPUP,
        30, 120, 56, 56,
        nullptr, nullptr, m_hInstance, nullptr
    );

    if (hwnd) {
        ApplyGlassmorphism(hwnd);
        SetLayeredWindowAttributes(hwnd, 0, 235, LWA_ALPHA);
    }

    return hwnd;
}

HWND YayraFloatingHost::CreateBrowserWindow() {
    WNDCLASSEXW wc = { sizeof(WNDCLASSEXW) };
    wc.lpfnWndProc = BrowserWndProc;
    wc.hInstance = m_hInstance;
    wc.lpszClassName = L"YayraFloatingBrowserWindowClass";
    wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
    wc.hbrBackground = (HBRUSH)GetStockObject(BLACK_BRUSH);
    RegisterClassExW(&wc);

    // Browser window is an AppWindow with layered acrylic glass
    HWND hwnd = CreateWindowExW(
        WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_APPWINDOW,
        wc.lpszClassName,
        L"Yayra Browser",
        WS_POPUP | WS_THICKFRAME,
        100, 100, 800, 600,
        nullptr, nullptr, m_hInstance, nullptr
    );

    if (hwnd) {
        ApplyGlassmorphism(hwnd);
        SetLayeredWindowAttributes(hwnd, 0, 245, LWA_ALPHA);
    }

    return hwnd;
}

void YayraFloatingHost::SetBrowserPosition(int x, int y, bool clamp) {
    if (!m_hwndBrowser) return;
    SetWindowPos(m_hwndBrowser, nullptr, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    if (clamp) {
        ClampToMonitorWorkArea(m_hwndBrowser);
    }
}

void YayraFloatingHost::SetBrowserSize(int width, int height, bool clamp) {
    if (!m_hwndBrowser) return;
    SetWindowPos(m_hwndBrowser, nullptr, 0, 0, width, height, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
    if (clamp) {
        ClampToMonitorWorkArea(m_hwndBrowser);
    }
}

FloatingWindowGeometry YayraFloatingHost::GetBrowserGeometry() const {
    FloatingWindowGeometry geom = { 0, 0, 800, 600, 0 };
    if (m_hwndBrowser) {
        RECT r;
        GetWindowRect(m_hwndBrowser, &r);
        geom.x = r.left;
        geom.y = r.top;
        geom.width = r.right - r.left;
        geom.height = r.bottom - r.top;
    }
    return geom;
}

void YayraFloatingHost::SetBubblePosition(int x, int y, bool clamp) {
    if (!m_hwndBubble) return;
    SetWindowPos(m_hwndBubble, nullptr, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    if (clamp) {
        ClampToMonitorWorkArea(m_hwndBubble);
    }
}

FloatingWindowGeometry YayraFloatingHost::GetBubbleGeometry() const {
    FloatingWindowGeometry geom = { 0, 0, 56, 56, 0 };
    if (m_hwndBubble) {
        RECT r;
        GetWindowRect(m_hwndBubble, &r);
        geom.x = r.left;
        geom.y = r.top;
        geom.width = r.right - r.left;
        geom.height = r.bottom - r.top;
    }
    return geom;
}

void YayraFloatingHost::ClampToMonitorWorkArea(HWND hwnd) {
    if (!hwnd) return;

    HMONITOR hMon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
    MONITORINFO mi = { sizeof(MONITORINFO) };
    if (GetMonitorInfoW(hMon, &mi)) {
        RECT wr;
        GetWindowRect(hwnd, &wr);
        int w = wr.right - wr.left;
        int h = wr.bottom - wr.top;

        int x = max(mi.rcWork.left, min(mi.rcWork.right - w, wr.left));
        int y = max(mi.rcWork.top, min(mi.rcWork.bottom - h, wr.top));

        if (x != wr.left || y != wr.top) {
            SetWindowPos(hwnd, nullptr, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
        }
    }
}

void YayraFloatingHost::SnapToMonitorEdges(HWND hwnd, int threshold) {
    if (!hwnd) return;

    HMONITOR hMon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
    MONITORINFO mi = { sizeof(MONITORINFO) };
    if (GetMonitorInfoW(hMon, &mi)) {
        RECT wr;
        GetWindowRect(hwnd, &wr);
        int w = wr.right - wr.left;
        int h = wr.bottom - wr.top;
        int x = wr.left;
        int y = wr.top;

        if (abs(x - mi.rcWork.left) <= threshold) {
            x = mi.rcWork.left;
        }
        if (abs((x + w) - mi.rcWork.right) <= threshold) {
            x = mi.rcWork.right - w;
        }
        if (abs(y - mi.rcWork.top) <= threshold) {
            y = mi.rcWork.top;
        }
        if (abs((y + h) - mi.rcWork.bottom) <= threshold) {
            y = mi.rcWork.bottom - h;
        }

        if (x != wr.left || y != wr.top) {
            SetWindowPos(hwnd, nullptr, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
        }
    }
}

void YayraFloatingHost::InitSystemTray(const std::wstring& tooltip) {
    if (m_trayActive) return;

    ZeroMemory(&m_nid, sizeof(m_nid));
    m_nid.cbSize = sizeof(NOTIFYICONDATAW);
    m_nid.hWnd = m_hwndBrowser ? m_hwndBrowser : m_hwndBubble;
    m_nid.uID = 1001;
    m_nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
    m_nid.uCallbackMessage = WM_YAYRA_TRAY;
    m_nid.hIcon = LoadIcon(m_hInstance, IDI_APPLICATION);
    wcsncpy_s(m_nid.szTip, tooltip.c_str(), _TRUNCATE);

    if (Shell_NotifyIconW(NIM_ADD, &m_nid)) {
        m_trayActive = true;
    }
}

void YayraFloatingHost::UpdateTrayTooltip(const std::wstring& tooltip) {
    if (!m_trayActive) return;
    wcsncpy_s(m_nid.szTip, tooltip.c_str(), _TRUNCATE);
    m_nid.uFlags = NIF_TIP;
    Shell_NotifyIconW(NIM_MODIFY, &m_nid);
}

void YayraFloatingHost::ShowTrayNotification(const std::wstring& title, const std::wstring& message) {
    if (!m_trayActive) return;
    m_nid.uFlags = NIF_INFO;
    wcsncpy_s(m_nid.szInfoTitle, title.c_str(), _TRUNCATE);
    wcsncpy_s(m_nid.szInfo, message.c_str(), _TRUNCATE);
    m_nid.dwInfoFlags = NIIF_INFO;
    Shell_NotifyIconW(NIM_MODIFY, &m_nid);
}

void YayraFloatingHost::RemoveSystemTray() {
    if (m_trayActive) {
        Shell_NotifyIconW(NIM_DELETE, &m_nid);
        m_trayActive = false;
    }
}

void YayraFloatingHost::ShowContextMenu(POINT pt) {
    HMENU hMenu = CreatePopupMenu();
    if (!hMenu) return;

    InsertMenuW(hMenu, 0, MF_BYPOSITION | MF_STRING, 1, L"Open Floating Browser");
    InsertMenuW(hMenu, 1, MF_BYPOSITION | MF_STRING | (m_alwaysOnTop ? MF_CHECKED : MF_UNCHECKED), 2, L"Always on Top");
    InsertMenuW(hMenu, 2, MF_BYPOSITION | MF_STRING, 3, m_mode == DesktopFloatingMode::CircleFirst ? L"Switch to Browser-First" : L"Switch to Circle-First");
    InsertMenuW(hMenu, 3, MF_BYPOSITION | MF_SEPARATOR, 0, nullptr);
    InsertMenuW(hMenu, 4, MF_BYPOSITION | MF_STRING, 4, L"Exit Yayra");

    SetForegroundWindow(m_nid.hWnd);
    int cmd = TrackPopupMenuEx(hMenu, TPM_RETURNCMD | TPM_RIGHTBUTTON, pt.x, pt.y, m_nid.hWnd, nullptr);
    DestroyMenu(hMenu);

    switch (cmd) {
        case 1:
            ShowBrowser(true);
            break;
        case 2:
            SetAlwaysOnTop(!m_alwaysOnTop);
            break;
        case 3:
            SetMode(m_mode == DesktopFloatingMode::CircleFirst ? DesktopFloatingMode::BrowserFirst : DesktopFloatingMode::CircleFirst);
            break;
        case 4:
            Shutdown();
            break;
    }
}

LRESULT CALLBACK YayraFloatingHost::BubbleWndProc(HWND hwnd, UINT uMsg, WPARAM wParam, LPARAM lParam) {
    if (!g_pHostInstance) return DefWindowProcW(hwnd, uMsg, wParam, lParam);

    switch (uMsg) {
        case WM_LBUTTONUP: {
            g_pHostInstance->ShowBrowser(true);
            return 0;
        }
        case WM_NCHITTEST: {
            return HTCAPTION; // Draggable anywhere on bubble
        }
        case WM_WINDOWPOSCHANGED: {
            g_pHostInstance->SnapToMonitorEdges(hwnd, 16);
            return 0;
        }
        case WM_DESTROY: {
            return 0;
        }
    }
    return DefWindowProcW(hwnd, uMsg, wParam, lParam);
}

LRESULT CALLBACK YayraFloatingHost::BrowserWndProc(HWND hwnd, UINT uMsg, WPARAM wParam, LPARAM lParam) {
    if (!g_pHostInstance) return DefWindowProcW(hwnd, uMsg, wParam, lParam);

    switch (uMsg) {
        case WM_NCHITTEST: {
            POINT pt = { GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam) };
            RECT rc;
            GetWindowRect(hwnd, &rc);

            const int border = 8;
            bool left = (pt.x < rc.left + border);
            bool right = (pt.x >= rc.right - border);
            bool top = (pt.y < rc.top + border);
            bool bottom = (pt.y >= rc.bottom - border);

            if (top && left) return HTTOPLEFT;
            if (top && right) return HTTOPRIGHT;
            if (bottom && left) return HTBOTTOMLEFT;
            if (bottom && right) return HTBOTTOMRIGHT;
            if (left) return HTLEFT;
            if (right) return HTRIGHT;
            if (top) return HTTOP;
            if (bottom) return HTBOTTOM;

            // Title bar region (top 44px)
            if (pt.y < rc.top + 44) {
                return HTCAPTION;
            }

            return HTCLIENT;
        }
        case WM_WINDOWPOSCHANGED: {
            g_pHostInstance->SnapToMonitorEdges(hwnd, 16);
            return 0;
        }
        case WM_DPICHANGED: {
            RECT* prc = (RECT*)lParam;
            if (prc) {
                SetWindowPos(hwnd, nullptr, prc->left, prc->top, prc->right - prc->left, prc->bottom - prc->top,
                             SWP_NOZORDER | SWP_NOACTIVATE);
            }
            return 0;
        }
        case WM_CLOSE: {
            if (g_pHostInstance->m_closeToTray) {
                g_pHostInstance->MinimizeBrowser(g_pHostInstance->m_minimizeToBubble);
                return 0;
            }
            break;
        }
        case WM_YAYRA_TRAY: {
            if (lParam == WM_RBUTTONUP) {
                POINT pt;
                GetCursorPos(&pt);
                g_pHostInstance->ShowContextMenu(pt);
            } else if (lParam == WM_LBUTTONUP) {
                g_pHostInstance->ShowBrowser(true);
            }
            return 0;
        }
        case WM_YAYRA_SECOND_INSTANCE: {
            g_pHostInstance->ShowBrowser(true);
            g_pHostInstance->ShowTrayNotification(L"Yayra Floating Browser", L"Yayra is already running.");
            return 0;
        }
        case WM_DESTROY: {
            return 0;
        }
    }
    return DefWindowProcW(hwnd, uMsg, wParam, lParam);
}

} // namespace Yayra
