#!/bin/zsh
# 班主任工作台：双击启动，保持此终端窗口开启。
cd "${0:A:h}" || exit 1
if ! command -v node >/dev/null 2>&1; then
  if [ -x /opt/homebrew/bin/fnm ]; then
    eval "$(/opt/homebrew/bin/fnm env --shell zsh)"
  fi
fi
if ! command -v node >/dev/null 2>&1; then
  echo '未找到 Node.js。请先安装 Node.js 20 或以上版本，再重新打开。'
  read '?按回车退出'
  exit 1
fi
if curl --silent --max-time 2 http://127.0.0.1:8765/__health | /usr/bin/grep -q '"app":"workstation-teacher"'; then
  open http://127.0.0.1:8765/index.html
  echo '工作台已在运行，已打开浏览器。'
  exit 0
fi
echo '启动后请保持此窗口开启。关闭服务：Control+C。'
(sleep 1; if curl --silent --max-time 2 http://127.0.0.1:8765/__health | /usr/bin/grep -q '"app":"workstation-teacher"'; then open http://127.0.0.1:8765/index.html; fi) &
node scripts/dev.mjs
