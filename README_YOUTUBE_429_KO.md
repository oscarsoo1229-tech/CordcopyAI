# YouTube 429 대응 수정 안내

이 버전은 YouTube의 서버 IP 제한을 우회하거나 해제하지 않습니다.

- 429 / 봇 인증 요구가 발생하면 15분간 서버 측 재요청을 제한합니다.
- yt-dlp 재시도 횟수를 줄여 과도한 추가 요청을 방지합니다.
- Render Logs에서 `category=rate_limited` 또는 `category=extractor_error`로 원인을 확인할 수 있습니다.
- 동시에 여러 YouTube 요청을 실행하지 않습니다.
- 기존 업로드 및 분석 화면은 변경하지 않았습니다.

## 아이패드 GitHub 적용
GitHub 저장소에서 `backend/server.py`를 수정본으로 교체하고 Commit changes를 누릅니다. Render 자동 배포를 확인하세요. `README_YOUTUBE_429_KO.md`는 선택적으로 추가할 수 있습니다.

## 주의
Render IP에 대한 YouTube의 접근 제한은 코드 수정만으로 해제되지 않습니다. 로그인 쿠키를 공개 서버에 업로드하지 마세요.
