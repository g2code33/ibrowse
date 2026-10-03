; Yayra Floating Browser - NSIS 64-bit Production Installer Configuration
; Hardened for clean installation, upgrade data preservation, and WebView2 detection

!include "MUI2.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

; General Installer Settings
Name "Yayra"
Caption "Yayra Setup"
OutFile "release/yayra-setup-0.1.0.exe"
InstallDir "$LOCALAPPDATA\Programs\yayra"
InstallDirRegKey HKCU "Software\Yayra" "InstallPath"
RequestExecutionLevel user

; Version Information Metadata
VIProductVersion "0.1.0.0"
VIAddVersionKey "ProductName" "Yayra"
VIAddVersionKey "CompanyName" "Yayra Project"
VIAddVersionKey "LegalCopyright" "Copyright (c) 2026 Yayra Project"
VIAddVersionKey "FileDescription" "Yayra Floating Browser Installer"
VIAddVersionKey "FileVersion" "0.1.0.0"
VIAddVersionKey "ProductVersion" "0.1.0.0"

; Interface Configuration
!define MUI_ABORTWARNING
!define MUI_ICON "build/icons/installer.ico"
!define MUI_UNICON "build/icons/uninstaller.ico"
!define MUI_HEADERIMAGE
!define MUI_WELCOMEFINISHPAGE_BITMAP_NOSTRETCH

; Installer Pages
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

; Uninstaller Pages
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; Language
!insertmacro MUI_LANGUAGE "English"

; Initialization & Runtime Checks
Function .onInit
  ${If} ${RunningX64}
    SetRegView 64
  ${Else}
    MessageBox MB_OK|MB_ICONSTOP "Yayra 64-bit requires a 64-bit version of Windows."
    Abort
  ${EndIf}

  ; Check for Microsoft Edge WebView2 Runtime
  Call CheckWebView2Runtime
FunctionEnd

Function CheckWebView2Runtime
  ClearErrors
  ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${If} ${Errors}
    ClearErrors
    ReadRegStr $0 HKCU "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${EndIf}

  ${If} $0 == ""
    MessageBox MB_YESNO|MB_ICONQUESTION "Microsoft Edge WebView2 Runtime was not detected on this machine.$\n$\nYayra requires WebView2 to render modern web content.$\nWould you like to open the WebView2 download page now?" IDNO +2
    ExecShell "open" "https://developer.microsoft.com/en-us/microsoft-edge/webview2/"
  ${EndIf}
FunctionEnd

; Installation Section
Section "MainSection" SEC01
  SetOutPath "$INSTDIR"
  
  ; Terminate running instances before file replacement on upgrade
  nsExec::Exec 'taskkill /F /IM yayra.exe /T'

  ; Write Application Binaries
  File /r "dist\*.*"
  File "build\icons\icon.ico"
  
  ; Write Registry Keys for Uninstall and App Paths
  WriteRegStr HKCU "Software\Yayra" "InstallPath" "$INSTDIR"
  WriteRegStr HKCU "Software\Yayra" "Version" "0.1.0"

  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Yayra" "DisplayName" "Yayra"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Yayra" "DisplayIcon" "$INSTDIR\icon.ico"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Yayra" "DisplayVersion" "0.1.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Yayra" "Publisher" "Yayra Project"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Yayra" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Yayra" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Yayra" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Yayra" "NoRepair" 1

  ; Create Shortcuts
  CreateDirectory "$SMPROGRAMS\Yayra"
  CreateShortcut "$SMPROGRAMS\Yayra\Yayra.lnk" "$INSTDIR\yayra.exe" "" "$INSTDIR\icon.ico" 0
  CreateShortcut "$SMPROGRAMS\Yayra\Uninstall Yayra.lnk" "$INSTDIR\Uninstall.exe" "" "$INSTDIR\Uninstall.exe" 0
  CreateShortcut "$DESKTOP\Yayra.lnk" "$INSTDIR\yayra.exe" "" "$INSTDIR\icon.ico" 0

  ; Create Uninstaller
  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

; Uninstaller Section
Section "Uninstall"
  ; Terminate running process if active
  nsExec::Exec 'taskkill /F /IM yayra.exe /T'

  ; Delete Shortcuts
  Delete "$DESKTOP\Yayra.lnk"
  Delete "$SMPROGRAMS\Yayra\Yayra.lnk"
  Delete "$SMPROGRAMS\Yayra\Uninstall Yayra.lnk"
  RMDir "$SMPROGRAMS\Yayra"

  ; Delete Registry Keys
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Yayra"
  DeleteRegKey HKCU "Software\Yayra"

  ; Delete Installed Application Binaries
  RMDir /r "$INSTDIR"

  ; Note: User browsing history, settings, and local database stored in
  ; %APPDATA%\yayra are intentionally preserved during uninstall unless
  ; explicitly removed by user action to prevent catastrophic data loss.
SectionEnd
