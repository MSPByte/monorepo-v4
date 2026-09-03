; MSPByte Agent Core — NSIS installer script
; Build: makensis -DVERSION=0.1.0 -DSERVER_URL=https://agents.mspbyte.com -DENROLLMENT_TOKEN=<token> agent-core.nsi
;
; Prerequisites: NSIS >= 3.09, the compiled agent-core.exe must be in the same
; directory as this script when makensis runs.

!define APP_NAME     "MSPByte Agent Core"
!define APP_EXE      "agent-core.exe"
!define INSTALL_DIR  "$PROGRAMDATA\MSPAgent"
!define SVC_NAME     "MSPAgentCore"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${SVC_NAME}"

Name "${APP_NAME}"
OutFile "MSPAgentCore-${VERSION}-setup.exe"
InstallDir "${INSTALL_DIR}"
RequestExecutionLevel admin
SetCompressor lzma

; Modern UI
!include "MUI2.nsh"
!include "LogicLib.nsh"

!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

; ── Install ─────────────────────────────────────────────────────────────────

Section "Main" SecMain
  SetOutPath "${INSTALL_DIR}"

  ; Stop existing service if running (best-effort)
  ExecWait 'sc stop "${SVC_NAME}"' $0
  Sleep 2000

  File "${APP_EXE}"

  ; Write config.toml only on first install (don't overwrite existing config)
  ${IfNot} ${FileExists} "${INSTALL_DIR}\config.toml"
    FileOpen  $9 "${INSTALL_DIR}\config.toml" w
    FileWrite $9 "[agent]$\r$\n"
    FileWrite $9 "server_url = `${SERVER_URL}`$\r$\n"
    FileWrite $9 "enrollment_token = `${ENROLLMENT_TOKEN}`$\r$\n"
    FileClose $9
  ${EndIf}

  ; Register Windows service
  ExecWait 'sc create "${SVC_NAME}" binPath= "${INSTALL_DIR}\${APP_EXE}" start= auto DisplayName= "${APP_NAME}"' $0
  ExecWait 'sc description "${SVC_NAME}" "MSPByte end-user support agent core"' $0
  ; Restart on failure: 60s delay, up to 3 times
  ExecWait 'sc failure "${SVC_NAME}" reset= 86400 actions= restart/60000/restart/60000/restart/60000' $0
  ExecWait 'sc start "${SVC_NAME}"' $0

  ; Add uninstall registry entry
  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "UninstallString" '"${INSTALL_DIR}\uninstall.exe"'
  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "Publisher" "MSPByte"
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoRepair" 1

  WriteUninstaller "${INSTALL_DIR}\uninstall.exe"
SectionEnd

; ── Uninstall ────────────────────────────────────────────────────────────────

Section "Uninstall"
  ExecWait 'sc stop "${SVC_NAME}"' $0
  Sleep 2000
  ExecWait 'sc delete "${SVC_NAME}"' $0

  ; Remove binaries but preserve config.toml and state.json so re-enrollment
  ; isn't needed if the MSP reinstalls.
  Delete "${INSTALL_DIR}\${APP_EXE}"
  Delete "${INSTALL_DIR}\uninstall.exe"
  Delete "${INSTALL_DIR}\agent-core.log"
  Delete "${INSTALL_DIR}\bundle.json"
  RMDir  "${INSTALL_DIR}\pending"

  DeleteRegKey HKLM "${UNINSTALL_KEY}"
SectionEnd
