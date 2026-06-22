!macro customHeader
  !system "echo 'Custom ADA POS Installer'"
!macroend

!macro preInit
  SetRegView 64
!macroend

!macro customInit
  ; Custom branding colors
!macroend

!macro customInstallMode
  ; Force per-user install by default but allow change
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "مرحباً بك في ADA POS"
  !define MUI_WELCOMEPAGE_TEXT "سيقوم المعالج بتثبيت نظام نقطة البيع ADA POS على جهازك.$\r$\n$\r$\nالميزات:$\r$\n• إدارة المبيعات والمخزون$\r$\n• الفواتير والتقارير$\r$\n• مزامنة سحابية$\r$\n• دعم متعدد المتاجر$\r$\n• ماسح الباركود$\r$\n$\r$\nاضغط التالي للمتابعة."
!macroend

!macro customFinishPage
  !define MUI_FINISHPAGE_TITLE "تم التثبيت بنجاح!"
  !define MUI_FINISHPAGE_TEXT "تم تثبيت ADA POS بنجاح على جهازك.$\r$\n$\r$\nيمكنك تشغيل البرنامج الآن من سطح المكتب أو من قائمة ابدأ."
  !define MUI_FINISHPAGE_RUN "$INSTDIR\ADA POS.exe"
  !define MUI_FINISHPAGE_RUN_TEXT "تشغيل ADA POS الآن"
!macroend
