; ============================================================
; ADA POS - Themed Installer
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
  !define MUI_WELCOMEPAGE_TITLE "Welcome to ADA POS Setup"
  !define MUI_WELCOMEPAGE_TITLE_3LINES
  !define MUI_WELCOMEPAGE_TEXT "This wizard will install ADA POS on your computer.$\r$\n$\r$\nADA POS is a complete Point of Sale system with:$\r$\n$\r$\n    *  Sales & Inventory Management$\r$\n    *  Invoices & Financial Reports$\r$\n    *  Real-time Cloud Sync$\r$\n    *  Multi-Store Support$\r$\n    *  Barcode Scanner Integration$\r$\n    *  Automatic Updates$\r$\n$\r$\nClick Next to continue."
!macroend

; --- Finish Page ---
!macro customFinishPage
  !define MUI_FINISHPAGE_TITLE "Installation Complete!"
  !define MUI_FINISHPAGE_TITLE_3LINES
  !define MUI_FINISHPAGE_TEXT "ADA POS has been successfully installed.$\r$\n$\r$\nYou can launch the application from:$\r$\n$\r$\n    *  Desktop shortcut$\r$\n    *  Start menu$\r$\n$\r$\nThank you for choosing ADA POS.$\r$\nFor support, visit web-designer-555.pages.dev"
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