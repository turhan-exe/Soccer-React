@echo off
cd /d "C:\Users\TURHAN\Desktop\MGX\workspace\football-manager-ui"
"C:\Program Files\nodejs\node.exe" "C:\Users\TURHAN\Desktop\MGX\workspace\football-manager-ui\scripts\\apply-mobile-update-policy.mjs" --service-account "C:\Users\TURHAN\Desktop\MGX\secrets\live-league\osm-react-firebase-adminsdk-fbsvc-fb46fd719a.json" --apply --latest-version-code 2026032901 --latest-version-name 1.0.18 --min-supported-version-code 2026032901 --gate-mode enforce
