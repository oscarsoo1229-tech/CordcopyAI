# ChordLens — GitHub Pages 배포용 파일

## GitHub Pages에 올리는 방법
1. ZIP을 PC에서 압축 해제합니다.
2. GitHub 저장소의 최상위 파일 목록으로 이동합니다.
3. `Add file` → `Upload files`를 누릅니다.
4. 압축 해제한 폴더 안의 **파일과 폴더 전체**를 업로드합니다. `ChordLens_GitHub_Pages` 폴더 자체를 통째로 중첩 업로드하지 마세요.
5. `Commit changes`를 누릅니다.
6. 저장소 `Settings` → `Pages`에서 `Deploy from a branch`, 브랜치 `main`, 폴더 `/(root)`를 선택하고 Save를 누릅니다.
7. 배포가 완료되면 Pages 화면의 `Visit site`를 누릅니다.

## 중요
- 시작 파일은 `index.html`이며, 파일 이름을 번역하거나 바꾸지 마세요.
- `app.js`, `styles.css`, `manifest.json`, `sw.js`, `icons` 경로를 그대로 유지하세요.
- GitHub Pages는 정적 호스팅이므로 `backend/server.py`를 실행하지 않습니다. 로컬 음원 파일 분석 기능을 위한 프런트엔드이며, YouTube URL 음원 분석에는 별도의 서버 배포 및 설정이 필요합니다.
- 공개 저장소에 비밀번호, API 키 또는 개인정보를 올리지 마세요.
