@echo off
setlocal
if exist "C:\Users\TURHAN\Desktop\MGX\workspace\football-manager-ui\unity-android-export.log" del /f /q "C:\Users\TURHAN\Desktop\MGX\workspace\football-manager-ui\unity-android-export.log"
"C:\Program Files\Unity\Hub\Editor\6000.3.11f1\Editor\Unity.exe" -batchmode -quit -projectPath "C:\UnityProject\FHS" -executeMethod FStudio.EditorTools.AutomatedBuilds.BuildAndroidLibraryExport -logFile "C:\Users\TURHAN\Desktop\MGX\workspace\football-manager-ui\unity-android-export.log"
exit /b %errorlevel%
