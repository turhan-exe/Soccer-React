Storage Lifecycle & Rules (Step 2.8)

Goal
- replays/: 30d Nearline, 60d Coldline, 90d Delete
- results/: 30d Delete
- jobs/: 7d Delete
- Client access: only authenticated users can read replays; everything else closed

Lifecycle JSON
- File: infra/storage-lifecycle.json
- Already present in repo. Apply it to your bucket with gcloud.

Apply To Bucket
- Find your bucket name in Firebase Console (usually <PROJECT_ID>.appspot.com).

Linux/macOS (bash)
```
PROJECT_ID="your-project-id"
BUCKET="$PROJECT_ID.appspot.com"

gcloud storage buckets update "gs://$BUCKET" \
  --lifecycle-file=infra/storage-lifecycle.json

gcloud storage buckets describe "gs://$BUCKET" --format="value(lifecycle)"
```

Windows (PowerShell)
```
$PROJECT_ID = "your-project-id"
$BUCKET = "$PROJECT_ID.appspot.com"

gcloud storage buckets update "gs://$BUCKET" `
  --lifecycle-file="infra/storage-lifecycle.json"

gcloud storage buckets describe "gs://$BUCKET" --format "value(lifecycle)"
```

Via npm scripts (auto-detects .firebaserc default project)
```
# Apply lifecycle (uses .firebaserc projects.default unless overridden)
pnpm run gcs:lifecycle:apply

# Describe lifecycle
pnpm run gcs:lifecycle:describe

# Override project/bucket
pnpm run gcs:lifecycle:apply -- --project your-project-id --bucket your-project-id.appspot.com
```

Storage Rules
- File: storage.rules (already referenced by firebase.json)
- Deploy: `firebase deploy --only storage`

Quick Checks
- `gcloud storage buckets describe` shows lifecycle rules.
- Authenticated user can GET `replays/...json`.
- Clients cannot read/write `results/...` or `jobs/...`.
- Other paths are denied by default.
