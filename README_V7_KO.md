# ChordLens v7 — 범용 화성 판정 실험판

기준: 사용자가 제공한 GitHub ZIP (CordcopyAI-main (2).zip).

변경:
- harmony-engine.js: maj7/m7/7/sus4 판정 시 특징음이 약하면 감점하여 무분별한 확장 코드 판정 감소. 베이스 가중치 완화.
- music-structure.js: 낮은 신뢰도 코드 경계를 박자 그리드에 억지로 이동시키지 않도록 제한.
- sw.js: 캐시 갱신.

주의: 이 변경은 정확도 향상을 보장하지 않는 실험적 개선입니다. NIGHTCRAWLER 및 여러 장르의 정답 코드/변경시점 데이터로 평가가 필요합니다. 고정 초 단위 분할은 추가하지 않았습니다.

적용: 위 세 파일을 GitHub 저장소 최상위에 교체한 후 Commit. Render 배포 후 캐시 새로고침.
