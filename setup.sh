#!/bin/zsh
# macOS setup. Run once: zsh setup.sh
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js가 없습니다. https://nodejs.org 에서 LTS를 설치한 뒤 다시 실행하세요."; exit 1; }
[[ -d "/Applications/Google Chrome.app" ]] || { echo "Google Chrome이 없습니다. 설치한 뒤 다시 실행하세요."; exit 1; }
npm install --no-audit --no-fund || exit 1
[[ -f config.json ]] || cp config.example.json config.json
echo "설치 완료."
