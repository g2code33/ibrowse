#pragma once

#include <windows.h>
#include <string>

namespace Yayra {

enum class WebView2RuntimeStatus {
    Available,
    NotInstalled,
    VersionTooOld,
    Corrupted
};

struct WebView2RuntimeInfo {
    WebView2RuntimeStatus status;
    std::wstring version;
    std::wstring installPath;
    std::wstring recoveryGuidance;
};

/**
 * Runtime availability detector for Microsoft Edge WebView2 on 64-bit Windows.
 * Queries Windows Registry and Microsoft Edge Update APIs.
 */
class YayraWebView2RuntimeDetector {
public:
    static WebView2RuntimeInfo DetectRuntime();
    static bool IsAvailable();
    static std::wstring GetDownloadUrl();
    static std::wstring GetRecoveryInstructions();

private:
    static bool QueryRegistryKey(HKEY rootKey, const std::wstring& subKey, const std::wstring& valueName, std::wstring& outValue);
};

} // namespace Yayra
