$exportRoot = 'C:\Users\TURHAN\Desktop\MGX\workspace\football-manager-ui\.tmp\AndroidUnityLibraryExport\unityLibrary'
$targetRoot = 'C:\Users\TURHAN\Desktop\MGX\workspace\football-manager-ui\android\unityLibrary'
$backupRoot = 'C:\Users\TURHAN\Desktop\MGX\workspace\football-manager-ui\.tmp\unityLibrary-custom-backup'

if (Test-Path $targetRoot) {
    Remove-Item $targetRoot -Recurse -Force
}

Copy-Item $exportRoot $targetRoot -Recurse -Force
New-Item -ItemType Directory -Path (Join-Path $targetRoot 'src\main\java\com\unity3d\player') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $targetRoot 'src\main\res\values') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $targetRoot 'src\main\res\values-v21') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $targetRoot 'src\main\res\values-v31') -Force | Out-Null
Copy-Item (Join-Path $backupRoot 'build.gradle') (Join-Path $targetRoot 'build.gradle') -Force
Copy-Item (Join-Path $backupRoot 'proguard-unity.txt') (Join-Path $targetRoot 'proguard-unity.txt') -Force
Copy-Item (Join-Path $backupRoot 'src\main\AndroidManifest.xml') (Join-Path $targetRoot 'src\main\AndroidManifest.xml') -Force
Copy-Item (Join-Path $backupRoot 'src\main\java\com\unity3d\player\UnityPlayerActivity.java') (Join-Path $targetRoot 'src\main\java\com\unity3d\player\UnityPlayerActivity.java') -Force
Copy-Item (Join-Path $backupRoot 'src\main\java\com\unity3d\player\EmbeddedUnityPlayerActivity.java') (Join-Path $targetRoot 'src\main\java\com\unity3d\player\EmbeddedUnityPlayerActivity.java') -Force
Copy-Item (Join-Path $backupRoot 'src\main\res\values\styles.xml') (Join-Path $targetRoot 'src\main\res\values\styles.xml') -Force
Copy-Item (Join-Path $backupRoot 'src\main\res\values-v21\styles.xml') (Join-Path $targetRoot 'src\main\res\values-v21\styles.xml') -Force
Copy-Item (Join-Path $backupRoot 'src\main\res\values-v31\styles.xml') (Join-Path $targetRoot 'src\main\res\values-v31\styles.xml') -Force
