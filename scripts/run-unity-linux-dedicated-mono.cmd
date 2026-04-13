@echo off
setlocal
if exist "C:\Users\TURHAN\Desktop\MGX\workspace\football-manager-ui\unity-linux-build.log" del /f /q "C:\Users\TURHAN\Desktop\MGX\workspace\football-manager-ui\unity-linux-build.log"
"C:\Program Files\Unity\Hub\Editor\6000.3.11f1\Editor\Unity.exe" -batchmode -quit -buildTarget Linux64 -projectPath "C:\UnityProject\FHS" -executeMethod FStudio.EditorTools.AutomatedBuilds.BuildLinuxDedicatedMono -logFile "C:\Users\TURHAN\Desktop\MGX\workspace\football-manager-ui\unity-linux-build.log" %*
exit /b %errorlevel%
