!macro customHeader
  !system "echo 'ADA POS Installer'"
!macroend

!macro preInit
  SetRegView 64
!macroend

!macro customInit
  SetSilent normal
!macroend

!macro customInstallMode
  ; Default per-user
!macroend

; --- Custom MUI Theme Colors ---
!macro customWelcomePage
  ; Dark navy background with purple accent text
  !define MUI_BGCOLOR "0F0A1E"
  !define MUI_TEXTCOLOR "FFFFFF"

  !define MUI_WELCOMEFINISHPAGE_BITMAP_NOSTRETCH
  !define MUI_WELCOMEPAGE_TITLE "                    ADA POS"
  !define MUI_WELCOMEPAGE_TITLE_3LINES
  !define MUI_WELCOMEPAGE_TEXT "$\r$\n  Welcome to the ADA POS installer.$\r$\n$\r$\n  This wizard will install the complete Point of Sale$\r$\n  system on your computer.$\r$\n$\r$\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━$\r$\n$\r$\n  FEATURES:$\r$\n$\r$\n    ▸  Sales & Inventory Management$\r$\n    ▸  Invoices & Reports$\r$\n    ▸  Cloud Sync (Real-time)$\r$\n    ▸  Multi-Store Support$\r$\n    ▸  Barcode Scanner$\r$\n    ▸  Auto Updates$\r$\n$\r$\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━$\r$\n$\r$\n  Click Next to continue."
!macroend

!macro customFinishPage
  !define MUI_FINISHPAGE_TITLE "                    Installation Complete"
  !define MUI_FINISHPAGE_TITLE_3LINES
  !define MUI_FINISHPAGE_TEXT "$\r$\n  ADA POS has been successfully installed!$\r$\n$\r$\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━$\r$\n$\r$\n  You can now launch the application from:$\r$\n$\r$\n    ▸  Desktop shortcut$\r$\n    ▸  Start menu$\r$\n$\r$\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━$\r$\n$\r$\n  Thank you for choosing ADA POS.$\r$\n  For support, visit web-designer-555.pages.dev"
  !define MUI_FINISHPAGE_RUN "$INSTDIR\ADA POS.exe"
  !define MUI_FINISHPAGE_RUN_TEXT "Launch ADA POS now"
  !define MUI_FINISHPAGE_LINK "Visit our website"
  !define MUI_FINISHPAGE_LINK_LOCATION "https://web-designer-555.pages.dev"
!macroend

; --- Custom Install Page Colors ---
!macro customPageColors
  ; Set dark theme for installer dialogs
  SetCtlColors $HWNDPARENT "FFFFFF" "0F0A1E"
!macroend

!macro customUnInstall
  ; Open review page after uninstall
  ExecShell "open" "https://web-designer-555.pages.dev/review/?from=uninstall"
!macroend
