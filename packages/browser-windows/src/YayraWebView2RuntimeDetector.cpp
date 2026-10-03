#include "YayraWebView2RuntimeDetector.h"

namespace Yayra {

const wchar_t* REG_KEY_EVERGREEN_64 = L"SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-F552-44DD-8A16-874D04E350C6}";
const wchar_t* REG_KEY_EVERGREEN_USER = L"Software\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-F552-44DD-8A16-874D04E350C6}";
const wchar_t* EVERGREEN_BOOTSTRAPPER_URL = L"https://go.microsoft.com/fwlink/p/?LinkId=2124703";

WebView2RuntimeInfo YayraWebView2RuntimeDetector::DetectRuntime() {
    WebView2RuntimeInfo info;
    info.status = WebView2RuntimeStatus::NotInstalled;
    info.recoveryGuidance = GetRecoveryInstructions();

    std::wstring version;
    std::wstring location;

    // Check 64-bit system-wide registry
    if (QueryRegistryKey(HKEY_LOCAL_MACHINE, REG_KEY_EVERGREEN_64, L"pv", version)) {
        if (!version.empty() && version != L"0.0.0.0") {
            info.status = WebView2RuntimeStatus::Available;
            info.version = version;
            QueryRegistryKey(HKEY_LOCAL_MACHINE, REG_KEY_EVERGREEN_64, L"location", info.installPath);
            return info;
        }
    }

    // Check user-level registry
    if (QueryRegistryKey(HKEY_CURRENT_USER, REG_KEY_EVERGREEN_USER, L"pv", version)) {
        if (!version.empty() && version != L"0.0.0.0") {
            info.status = WebView2RuntimeStatus::Available;
            info.version = version;
            QueryRegistryKey(HKEY_CURRENT_USER, REG_KEY_EVERGREEN_USER, L"location", info.installPath);
            return info;
        }
    }

    return info;
}

bool YayraWebView2RuntimeDetector::IsAvailable() {
    return DetectRuntime().status == WebView2RuntimeStatus::Available;
}

std::wstring YayraWebView2RuntimeDetector::GetDownloadUrl() {
    return EVERGREEN_BOOTSTRAPPER_URL;
}

std::wstring YayraWebView2RuntimeDetector::GetRecoveryInstructions() {
    return L"Microsoft Edge WebView2 Runtime is required to run Yayra on Windows.\n"
           L"1. Download the Evergreen Bootstrapper: https://go.microsoft.com/fwlink/p/?LinkId=2124703\n"
           L"2. Run MicrosoftEdgeWebview2Setup.exe as Administrator\n"
           L"3. Restart Yayra Floating Browser.";
}

bool YayraWebView2RuntimeDetector::QueryRegistryKey(HKEY rootKey, const std::wstring& subKey, const std::wstring& valueName, std::wstring& outValue) {
    HKEY hKey;
    if (RegOpenKeyExW(rootKey, subKey.c_str(), 0, KEY_READ, &hKey) != ERROR_SUCCESS) {
        return false;
    }

    wchar_t buffer[512];
    DWORD bufferSize = sizeof(buffer);
    DWORD type = 0;

    LONG result = RegQueryValueExW(hKey, valueName.c_str(), nullptr, &type, reinterpret_cast<LPBYTE>(buffer), &bufferSize);
    RegCloseKey(hKey);

    if (result == ERROR_SUCCESS && (type == REG_SZ || type == REG_EXPAND_SZ)) {
        outValue = buffer;
        return true;
    }
    return false;
}

} // namespace Yayra
