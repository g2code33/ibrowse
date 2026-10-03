#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

#include <windows.h>
#include <windowsx.h>
#include <dwmapi.h>
#include <shellapi.h>
#include <string>
#include <vector>
#include <functional>

#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "user32.lib")

namespace Yayra {

enum class DesktopFloatingMode {
    CircleFirst,
    BrowserFirst
};

struct FloatingWindowGeometry {
    int x;
    int y;
    int width;
    int height;
    int monitorIndex;
};

struct MonitorBounds {
    int index;
    RECT bounds;
    RECT workArea;
    UINT dpi;
    double scaleFactor;
    bool isPrimary;
};

/**
 * Native Win32 Floating Host Window Manager for Yayra on Windows.
 * Configures dual independent native windows (Bubble HWND and Browser HWND),
 * DWM Acrylic/Mica system backdrop, Per-Monitor V2 DPI scaling,
 * Work area boundary clamping, Magnetic edge snapping, Single Instance Mutex,
 * and System Tray integration.
 */
class YayraFloatingHost {
public:
    YayraFloatingHost(HINSTANCE hInstance);
    ~YayraFloatingHost();

    bool Initialize(DesktopFloatingMode mode = DesktopFloatingMode::CircleFirst);
    void Shutdown();

    // Mode orchestration
    void SetMode(DesktopFloatingMode mode);
    DesktopFloatingMode GetMode() const { return m_mode; }

    // Window controls
    void ShowBrowser(bool activate = true);
    void MinimizeBrowser(bool toBubble = true);
    void HideBrowser();
    void ShowBubble();
    void HideBubble();

    void SetAlwaysOnTop(bool topmost);
    bool IsAlwaysOnTop() const { return m_alwaysOnTop; }

    void SetMinimizeToBubble(bool toBubble) { m_minimizeToBubble = toBubble; }
    void SetCloseToTray(bool toTray) { m_closeToTray = toTray; }

    // Geometry and positioning
    void SetBrowserPosition(int x, int y, bool clamp = true);
    void SetBrowserSize(int width, int height, bool clamp = true);
    FloatingWindowGeometry GetBrowserGeometry() const;

    void SetBubblePosition(int x, int y, bool clamp = true);
    FloatingWindowGeometry GetBubbleGeometry() const;

    // Multi-monitor & DPI scaling
    std::vector<MonitorBounds> EnumerateMonitors();
    void SnapToMonitorEdges(HWND hwnd, int threshold = 16);
    void ClampToMonitorWorkArea(HWND hwnd);

    // Single-instance mutex
    bool EnsureSingleInstance();

    // System Tray
    void InitSystemTray(const std::wstring& tooltip);
    void UpdateTrayTooltip(const std::wstring& tooltip);
    void ShowTrayNotification(const std::wstring& title, const std::wstring& message);
    void RemoveSystemTray();

    HWND GetBubbleHwnd() const { return m_hwndBubble; }
    HWND GetBrowserHwnd() const { return m_hwndBrowser; }

private:
    HINSTANCE m_hInstance;
    HWND m_hwndBubble;
    HWND m_hwndBrowser;
    HANDLE m_hSingleInstanceMutex;
    NOTIFYICONDATAW m_nid;
    bool m_trayActive;

    DesktopFloatingMode m_mode;
    bool m_alwaysOnTop;
    bool m_minimizeToBubble;
    bool m_closeToTray;
    bool m_isDragging;
    POINT m_dragStart;
    RECT m_dragWindowStart;

    static const UINT WM_YAYRA_TRAY = WM_USER + 100;
    static const UINT WM_YAYRA_SECOND_INSTANCE = WM_USER + 200;

    static LRESULT CALLBACK BubbleWndProc(HWND hwnd, UINT uMsg, WPARAM wParam, LPARAM lParam);
    static LRESULT CALLBACK BrowserWndProc(HWND hwnd, UINT uMsg, WPARAM wParam, LPARAM lParam);

    HWND CreateBubbleWindow();
    HWND CreateBrowserWindow();
    void ApplyGlassmorphism(HWND hwnd);
    void ShowContextMenu(POINT pt);
};

} // namespace Yayra
