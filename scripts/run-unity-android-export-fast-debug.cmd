@echo off
setlocal
if exist "C:\Users\TURHAN\Desktop\MGX\workspace\football-manager-ui\unity-android-export.log" del /f /q "C:\Users\TURHAN\Desktop\MGX\workspace\football-manager-ui\unity-android-export.log"
"C:\Program Files\Unity\Hub\Editor\6000.3.11f1\Editor\Unity.exe" -batchmode -quit -projectPath "C:\UnityProject\FHS" -executeMethod FStudio.EditorTools.AutomatedBuilds.BuildAndroidLibraryExportFastDebug -skipAddressablesBuild -skipCleanBuildCache -logFile "C:\Users\TURHAN\Desktop\MGX\workspace\football-manager-ui\unity-android-export.log" %*
if errorlevel 1 exit /b %errorlevel%
powershell -ExecutionPolicy Bypass -File "C:\Users\TURHAN\Desktop\MGX\workspace\football-manager-ui\scripts\write-android-build-manifest.ps1" -ExportRoot "C:\Users\TURHAN\Desktop\MGX\workspace\football-manager-ui\.tmp\AndroidUnityLibraryExport" -UpdateCurrentManifest
exit /b %errorlevel%
