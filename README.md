# Capture Kit

웹사이트 화면을 내 Mac의 Chrome으로 자동 수집해서 Figma에 정리해 주는 키트입니다. Claude Code에 문장 하나만 보내면 설치부터 Figma 배치까지 진행합니다.

*Capture website screens with your local Chrome and place them in Figma through Claude Code and Figma MCP. macOS only. Documentation is in Korean.*

## 어떻게 동작하나요

| 단계 | 하는 일 | 토큰 |
|---|---|---|
| 설정 | Claude가 사이트와 화면 설정을 작성 | 사용 |
| 수집 | 내 PC의 스크립트가 화면을 찍고 긴 이미지로 이어붙임 | 사용 안 함 |
| 검수 | Claude가 결과 표와 썸네일 한 장을 확인 | 사용 |
| Figma 배치 | Figma MCP로 프레임을 만들고 이미지를 업로드 | 사용 |

수집은 AI 없이 돌아가서, 사이트가 많아도 토큰이 크게 늘지 않습니다. 이미지는 채팅을 거치지 않고 내 PC에서 Figma로 바로 올라갑니다.

## 준비물

- Mac, [Google Chrome](https://www.google.com/chrome/), [Node.js LTS](https://nodejs.org)
- [Claude Code](https://claude.com/claude-code)
- 수정 권한이 있는 Figma 파일

## Figma 연결

처음 한 번만 하면 됩니다. 터미널에서 실행하세요.

```bash
claude plugin install figma@claude-plugins-official
```

Claude Code에서 `/plugin`을 열고 Installed 탭에서 Figma를 인증합니다. 자세한 내용은 [Figma 공식 안내](https://help.figma.com/hc/en-us/articles/39888612464151-Claude-Code-and-Figma-Set-up-the-MCP-server)를 보세요.

## 시작하기

Claude Code에 아래 문장을 채워서 보내세요.

```text
Capture Kit으로 웹 화면을 수집해서 Figma에 넣어줘. 키트의 CLAUDE.md 순서대로 끝까지 진행해줘.

키트: https://github.com/chammyee/capture-kit
Figma 페이지: {링크}
작업 목적: {예: 호텔 앱 예약 플로우 벤치마킹}
사이트: {이름과 URL 목록, 또는 CSV 경로}
수집할 화면: {예: 홈, 객실 리스트, 객실 상세}
```

기기와 언어를 적지 않으면 모바일, 한국어로 진행합니다. 결과를 확인한 뒤 원하는 대로 다시 요청하면 됩니다.

## 결과

- Figma: 페이지에 새 섹션이 생기고, 그룹별로 사이트와 화면이 정리됩니다. 이름에는 원본 URL이 링크됩니다.
- 내 PC: `output/` 폴더에 긴 화면 이미지, `review.jpg` (첫 장 모음), `report.csv` (화면별 결과)가 저장됩니다.

## 직접 실행하기

Claude 없이 수집만 할 수도 있습니다.

```bash
zsh setup.sh
```

`config.json`을 수정한 뒤 실행합니다. 항목 설명은 [docs/config.md](docs/config.md)에 있습니다.

```bash
npm run capture
```

중간에 멈춰도 다시 실행하면 끝난 화면은 건너뜁니다. 다시 찍으려면 `output/사이트/언어/화면` 폴더를 지우고 실행하세요.

## 할 수 없는 일

- 로그인이 필요한 화면 수집 (매번 빈 브라우저로 시작합니다)
- 결제, 예약 같은 입력 흐름 수집
- 봇 차단 화면 우회
- Windows, Linux 실행

## 사용 전에 확인하세요

- **책임:** 이 키트는 도구일 뿐 수집을 허가하지 않습니다. 대상 사이트의 약관과 관련 법 준수는 사용자 책임입니다.
- **약관:** 자동 검사는 키워드만 보며 법률 판단이 아닙니다. 금지 문구가 있거나 약관을 찾지 못한 사이트는 건너뜁니다. 약관을 직접 읽고 문제없을 때만 `terms`를 `ok`로 지정하세요.
- **robots.txt:** 수집을 막은 경로는 건너뜁니다.
- **봇 차단:** 차단 화면이 뜨면 우회하지 않고 건너뛰어 목록에 남깁니다.
- **기기 표시:** 모바일 모드는 모바일 화면을 재현하려고 iPhone 브라우저로 표시됩니다. 차단을 피하는 기능은 없습니다.
- **쿠키:** 거부를 먼저 누르고, 거부 버튼이 없으면 팝업을 화면에서 가립니다. 동의는 누르지 않습니다.
- **저작권:** 수집한 화면은 내부 참고용으로 쓰고, 공개 전에 권리를 확인하세요.
- **회사 환경:** 회사 PC나 계정이면 설치와 MCP 연결이 허용되는지 먼저 확인하세요.
- **사용량:** Figma MCP 사용량 제한은 요금제에 따라 다를 수 있습니다.

## 폴더 구조

```text
README.md            사용 안내
CLAUDE.md            Claude가 따르는 작업 순서
config.example.json  설정 예시
docs/config.md       설정 항목 설명
scripts/             수집, 내보내기, 업로드 스크립트
```

코드를 수정했다면 `npm run check`로 Figma 배치 로직을 점검할 수 있습니다.

## 안내

[MIT 라이선스](LICENSE)로 배포합니다. 이 라이선스는 키트 코드에만 적용되며, 수집한 화면의 권리와는 무관합니다.

Figma, Claude 및 수집 대상 사이트와 제휴하거나 승인받은 프로젝트가 아닙니다. 각 상표는 해당 소유자의 것입니다.
