; CodeCritter NSIS hooks (Tauri bundle.windows.nsis.installerHooks).
; The Tauri template stores the install dir in HKCU\Software\<publisher>\<product> and never removes it.
!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\rsd-06\CodeCritter"
  DeleteRegKey /ifempty HKCU "Software\rsd-06"
!macroend
