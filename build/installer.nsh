; ============================================================
; RTS Business - Royal Technology Solutions installer
; ============================================================

!macro customHeader
  !system "echo 'RTS Business Installer'"
  BrandingText "R.T.S Business Setup"
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
  !define MUI_WELCOMEPAGE_TITLE "Welcome to RTS Business"
  !define MUI_WELCOMEPAGE_TITLE_3LINES
  !define MUI_WELCOMEPAGE_TEXT "This will install RTS Business — your complete business operations system.$\r$\n$\r$\n$\u25CF  Sales & Inventory Management$\r$\n$\u25CF  Cloud Sync & Multi-Store$\r$\n$\u25CF  Barcode Scanner & Receipts$\r$\n$\u25CF  Financial Reports$\r$\n$\u25CF  Automatic Updates$\r$\n$\r$\nClick Next to continue."
!macroend

; --- Finish Page ---
!macro customFinishPage
  !define MUI_FINISHPAGE_TITLE "RTS Business Installed Successfully"
  !define MUI_FINISHPAGE_TITLE_3LINES
  !define MUI_FINISHPAGE_TEXT "RTS Business is ready to use.$\r$\n$\r$\nYou can launch it from the desktop shortcut or the Start menu.$\r$\n$\r$\nThank you for choosing RTS Business.$\r$\nVisit rts-royal.pages.dev for support."
  !define MUI_FINISHPAGE_RUN "$INSTDIR\RTS Business.exe"
  !define MUI_FINISHPAGE_RUN_TEXT "Launch RTS Business now"
  !define MUI_FINISHPAGE_NOREBOOTSUPPORT
  !define MUI_FINISHPAGE_LINK "Visit our website"
  !define MUI_FINISHPAGE_LINK_LOCATION "https://rts-royal.pages.dev"
  !define MUI_FINISHPAGE_LINK_COLOR "48115B"
!macroend

; --- Uninstall ---
!macro customUnInstall
  ExecShell "open" "https://rts-royal.pages.dev/?from=uninstall"
!macroend