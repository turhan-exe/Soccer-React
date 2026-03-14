# Shadcn-UI Template Usage Instructions

## technology stack

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

All shadcn/ui components have been downloaded under `@/components/ui`.

## File Structure

- `index.html` - HTML entry point
- `vite.config.ts` - Vite configuration file
- `tailwind.config.js` - Tailwind CSS configuration file
- `package.json` - NPM dependencies and scripts
- `src/app.tsx` - Root component of the project
- `src/main.tsx` - Project entry point
- `src/index.css` - Existing CSS configuration

## Components

- All shadcn/ui components are pre-downloaded and available at `@/components/ui`

## Styling

- Add global styles to `src/index.css` or create new CSS files as needed
- Use Tailwind classes for styling components

## Development

- Import components from `@/components/ui` in your React components
- Customize the UI by modifying the Tailwind configuration

## Note

The `@/` path alias points to the `src/` directory

# Commands

**Install Dependencies**

```shell
pnpm i
```

**Start Preview**

```shell
pnpm run dev
```

**To build**

```shell
pnpm run build
```

## Firebase Authentication

1. Install dependencies:
   ```bash
   pnpm add firebase
   ```
2. Copy `.env.example` to `.env.local` and fill in your Firebase project keys.
3. Wrap your app with `AuthProvider` and use the `useAuth` hook to call `login`,
   `register`, and `logout`, which connect to Firebase under the hood.

## Unity Headless Worker (Plan 2.3)

- Headless simulation worker scaffolding is available under `Unity/Headless`.
- C# scripts: `Unity/Headless/Assets/Scripts` implement batch download, deterministic sim, replay/result upload, and optional live event posting.
- Containerization: `Unity/Headless/Build/Dockerfile` runs the Linux server build on Cloud Run Jobs.
- See `infra/headless/README.md` for environment variables and run instructions.
- Batch sharding: `createDailyBatch` writes shard files (default 16). Each Unity job should receive its shard `BATCH_URL`.

## Unity Render Worker (Video)

- Render worker should live under `Unity/Render` with a Linux build in `Unity/Render/Build`.
- Containerization: `Unity/Render/Build/Dockerfile` runs the render player with Xvfb + FFmpeg.
- Expected env: `REPLAY_URL` or `REPLAY_PATH`, `VIDEO_UPLOAD_URL` or `VIDEO_PATH`, and `MATCH_ID`/`LEAGUE_ID`/`SEASON_ID`.
- Render jobs are triggered from `onResultFinalize` via Cloud Tasks + Cloud Run Jobs.


## Mobile Assets

- Icon and splash sources live in ssets/logo.svg and ssets/splash.svg.
- Regenerate platform-specific assets with:
  `ash
  npx @capacitor/assets generate --iconBackgroundColor "#0f172a" --splashBackgroundColor "#0f172a" --android --ios
  `
  Run the command after adding the iOS platform so the target asset directories exist.
## Mobile Assets

- Icon and splash sources live in `assets/logo.svg` and `assets/splash.svg`.
- Regenerate platform-specific assets with:
  ```bash
  npx @capacitor/assets generate --iconBackgroundColor "#0f172a" --splashBackgroundColor "#0f172a" --android --ios
  ```
  Run the command after adding the iOS platform so the target asset directories exist.
## Mobile Assets

- Icon and splash sources live in `assets/logo.svg` and `assets/splash.svg`.
- Regenerate platform-specific assets with:
  ```bash
  npx @capacitor/assets generate --iconBackgroundColor "#0f172a" --splashBackgroundColor "#0f172a" --android --ios
  ```
  Run the command after adding the iOS platform so the target asset directories exist.
