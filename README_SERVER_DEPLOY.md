# ChordLens backend deployment (Render)

## 1. Push these files to the root of the same GitHub repository
Keep the existing frontend files at the repository root. Add `Dockerfile` and update `backend/server.py` and `app.js` from this package. Do not upload the enclosing folder itself.

## 2. Create the backend on Render
- Open https://render.com and sign in.
- New + -> Web Service -> connect the same GitHub repository.
- Runtime/Language: Docker.
- Dockerfile path: `./Dockerfile` (repository root).
- Create/Deploy the service. Render will assign a URL like `https://your-service-name.onrender.com`.

## 3. Configure allowed frontend origin
In Render service -> Environment, add:
- Key: `CHORDLENS_ALLOWED_ORIGIN`
- Value: the exact GitHub Pages origin, e.g. `https://USERNAME.github.io` (no path and no trailing slash).

If the GitHub Pages project site is `https://USERNAME.github.io/REPOSITORY/`, the origin value is still `https://USERNAME.github.io`.
Save and redeploy.

## 4. Point the frontend to the backend
Edit the first lines of `app.js` and replace:
`https://YOUR-CHORDLENS-SERVER.onrender.com`
with the exact Render service URL, without a trailing slash. Commit the change to GitHub.

## 5. Verify
Open `https://your-service-name.onrender.com/` in a browser. This server currently serves the frontend root too; if it shows the app, the server is running. Then open the GitHub Pages site and test a YouTube URL you are allowed to access.

Notes:
- Render must run the Dockerfile so FFmpeg and yt-dlp are installed.
- Public server endpoints can be abused and video downloads may be blocked by YouTube or its terms/access restrictions. Do not use this to bypass DRM, paywalls, or access controls. Prefer audio files you have permission to use.
- Free hosting may sleep or be resource-limited; the first request can take longer.
