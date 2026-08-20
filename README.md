# 推文卡片工场 Tweet Card Studio

把你的推文快速做成可发布的图片卡片：选一条推文（或现写文案）→ 选背景 → 导出 PNG。适合把 X 上的内容二次分发到抖音、小红书、视频号等图文平台。

纯静态、零框架、零构建、无后端——克隆下来起个静态服务器就能用。灵感来自 [dontbesilent 抖音图文生成器](https://dontbesilent-tweet-card-studio.vercel.app/)。

> Turn your tweets into shareable image cards (3:4 poster or transparent PNG). Pure static HTML/CSS/JS, no build step, no backend. Bring your own tweets via a simple JSON file; customize avatar/name/handle right in the UI.

## 快速开始

```bash
git clone <repo-url> tweet-cards
cd tweet-cards
python3 -m http.server 8798
```

打开 http://localhost:8798 。任何静态服务器都行（`npx serve`、nginx、Vercel……）；直接双击 index.html 不行，fetch 数据需要 http 协议。

首次打开是示例数据，两步换成你自己的：

1. **账号信息**（左侧 05 区）：上传头像、填名称和用户名、选择是否显示蓝 V——保存在本机浏览器（localStorage），不会上传到任何地方
2. **导入推文库**：点「导入推文库 JSON」上传你的推文文件，格式见下

## 推文库格式

一个 JSON 数组，每条只有 `text` 必填：

```json
[
  {
    "date": "2026-01-01",
    "text": "推文内容\n支持换行",
    "topic": "分类（可选）",
    "sourceUrl": "https://x.com/you/status/xxx（可选）",
    "metrics": { "likes": 0, "replies": 0, "reposts": 0, "bookmarks": 0, "views": 0 }
  }
]
```

`metrics` 用于素材库的「最热/最多收藏」排序；卡片上显示的互动数据是随机生成的，与它无关。

数据来源四选一：

- **BYOK 同步**（页面 06 区）：填你自己的 X API Bearer Token（需 Basic 及以上套餐）和用户名，一键拉取并自动填充头像昵称。Key 只存你的浏览器 localStorage；因浏览器无法直连 api.x.com，请求经 tools.upthos.com 的无状态转发（开源 Worker，不记录不存储）。同账号再次同步自动增量。注意每拉一条消耗你套餐的 posts read 配额。

- **UI 导入 JSON**：上面说的「导入推文库 JSON」，存在浏览器本机
- **项目文件**：把文件存成项目根目录的 `posts.json`，加载优先级：本机导入 > `posts.json` > `posts.sample.json`
- **X API 抓取**：如果你用 Claude Code 且接了 X API（MCP），直接让它「用 get_users_posts 拉我的原创推文，跑 scripts/build_posts.py 生成 posts.json」。原始返回存进 `data/raw/page-*.json`，脚本负责合并去重、抽取长推全文（note_tweet）、清洗 t.co 链接、按关键词自动分类。注意时间线接口最多回溯最近 3200 条；更早的历史用 X 设置里的「下载你的数据」归档补齐

## 功能

- **素材库**：关键词搜索、主题筛选、最新/最热/最多收藏排序、随机抽取
- **自定义文案**：现写现上卡，实时预览
- **三种成品**：3:4 竖图（1080×1440）、9:16 竖图（1080×1920）或纯卡片（透明背景 PNG）
- **抖音安全区参考线**：避开状态栏、右侧互动按钮列、底部文案区，可开关，不进导出成品
- **Live 图素材**：导出 3 秒动效 MP4（背景推近 + 卡片呼吸，WebCodecs 本地编码），手机端用 intoLive/快捷指令转成实况照片即可按 Live 图发布
- **卡片样式**：白/黑主题、直角卡片、整体等比缩放（50%–140%，不改变排版换行）、透明度（30%–100%，文字不透）
- **自由构图**：竖图模式下卡片可拖到画框任意位置（出框裁切），双击回中；超长推文自动缩放适配
- **互动数据**：随机生成的好看数字（按真实比例区间派生），一键换一组，可隐藏
- **背景**：13 张风景照 + 10 张城市街景 + 10 张渐变（内置），支持本地上传和图片 URL
- **导出**：html-to-image（DOM → SVG foreignObject → canvas）所见即所得，一键复制文案

## 项目结构

```
index.html / styles.css / app.js   应用本体（vanilla JS，无依赖）
profile.json                        默认账号信息（部署你自己的实例时改这里）
posts.json                          你的推文库（可选，作者的库已内置）
posts.sample.json                   示例数据（兜底加载）
avatar.png                          默认头像
backgrounds/ + manifest.json        内置背景库
vendor/html-to-image.js             导出库（本地 vendored，v1.11.13）
scripts/build_posts.py              X API 原始数据 → posts.json
scripts/gen_backgrounds.py          重新生成渐变背景 + manifest
data/raw/                           X API 原始返回（增量更新的基础）
```

## 部署你自己的实例

整个目录就是成品，任何静态托管都能放：

```bash
npx vercel deploy   # 或 Netlify / GitHub Pages / Cloudflare Pages
```

部署前把 `profile.json`、`avatar.png`、`posts.json` 换成你自己的即可；访客在 UI 里的修改只影响他们自己的浏览器。

## 自定义

- **背景**：图片丢进 `backgrounds/`，在 `scripts/gen_backgrounds.py` 的 `PHOTOS` 列表加一行，重跑脚本（内置照片来自 [Lorem Picsum](https://picsum.photos/)，Unsplash 授权）
- **自动分类关键词**：`scripts/build_posts.py` 里的 `TOPIC_RULES`
- **卡片样式**：`styles.css` 的 `.tweet-card` 一节

## License

[MIT](LICENSE)
