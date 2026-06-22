; ============================================================
; ADA POS - Themed Installer (Violet + Cyan)
; ============================================================

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

; --- Welcome Page ---
!macro customWelcomePage
  !define MUI_WELCOMEFINISHPAGE_BITMAP_NOSTRETCH
  !define MUI_WELCOMEPAGE_TITLE "Welcome to ADA POS"
  !define MUI_WELCOMEPAGE_TITLE_3LINES
  !define MUI_WELCOMEPAGE_TEXT "This will install ADA POS — your complete Point of Sale system.$\r$\n$\r$\n$\u25CF  Sales & Inventory Management$\r$\n$\u25CF  Cloud Sync & Multi-Store$\r$\n$\u25CF  Barcode Scanner & Receipts$\r$\n$\u25CF  Financial Reports$\r$\n$\u25CF  Automatic Updates$\r$\n$\r$\nClick Next to continue."
!macroend

; --- Finish Page ---
!macro customFinishPage
  !define MUI_FINISHPAGE_TITLE "ADA POS Installed Successfully"
  !define MUI_FINISHPAGE_TITLE_3LINES
  !define MUI_FINISHPAGE_TEXT "ADA POS is ready to use.$\r$\n$\r$\nYou can launch it from the desktop shortcut or the Start menu.$\r$\n$\r$\nThank you for choosing ADA POS.$\r$\nVisit web-designer-555.pages.dev for support."
  !define MUI_FINISHPAGE_RUN "$INSTDIR\ADA POS.exe"
  !define MUI_FINISHPAGE_RUN_TEXT "Launch ADA POS now"
  !define MUI_FINISHPAGE_NOREBOOTSUPPORT
  !define MUI_FINISHPAGE_LINK "Visit our website"
  !define MUI_FINISHPAGE_LINK_LOCATION "https://web-designer-555.pages.dev"
  !define MUI_FINISHPAGE_LINK_COLOR "7C3AED"
!macroend

; --- Uninstall ---
!macro customUnInstall
  ExecShell "open" "https://web-designer-555.pages.dev/review/?from=uninstall"
!macroend