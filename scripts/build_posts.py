#!/usr/bin/env python3
"""把 data/raw/page-*.json（X API get_users_posts 原始返回）合并成 posts.json。

处理内容：
- 按 id 去重、按时间倒序
- 长推优先取 note_tweet 全文
- t.co 链接：媒体/自引用链接直接删掉，普通链接替换成 display_url
- 关键词自动分类 topic（best-effort，可随时改 TOPIC_RULES 或直接改 posts.json）
"""
import json
import re
import glob
import os
from datetime import datetime, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TOPIC_RULES = [
    ("AI 与工具", ["AI", "ai", "skill", "Skill", "SKILL", "Claude", "claude", "GPT", "gpt",
                   "agent", "Agent", "模型", "prompt", "Prompt", "智能体", "codex", "Codex",
                   "MCP", "mcp", "开源", "token", "编程", "代码", "Obsidian", "工具"]),
    ("内容与流量", ["视频", "抖音", "小红书", "流量", "内容", "自媒体", "公众号", "粉丝",
                   "播放", "选题", "爆款", "账号", "推文", "直播", "B 站", "B站", "视频号",
                   "创作者", "博主", "涨粉", "口播", "对标", "起号", "标题", "封面"]),
    ("商业与产品", ["赚钱", "变现", "产品", "用户", "客户", "生意", "创业", "商业", "付费",
                   "价格", "收入", "交付", "咨询", "课程", "知识付费", "订单", "销售",
                   "获客", "私域", "成本", "利润"]),
]
DEFAULT_TOPIC = "观察与思考"


def classify(text: str) -> str:
    best, best_hits = DEFAULT_TOPIC, 0
    for topic, kws in TOPIC_RULES:
        hits = sum(text.count(k) for k in kws)
        if hits > best_hits:
            best, best_hits = topic, hits
    return best


def url_map(post):
    """t.co -> 替换文本（None 表示整段删除）"""
    m = {}
    for holder in (post.get("entities"), (post.get("note_tweet") or {}).get("entities")):
        if not holder:
            continue
        for u in holder.get("urls", []):
            tco = u.get("url")
            if not tco:
                continue
            expanded = u.get("expanded_url", "")
            display = u.get("display_url", "")
            # 自己推文的媒体链接（图/视频）在正文里没有意义，删除
            if "/photo/" in expanded or "/video/" in expanded or display.startswith("pic.x.com") or display.startswith("pic.twitter.com"):
                m[tco] = None
            else:
                m[tco] = display
    return m


def clean_text(post) -> str:
    note = post.get("note_tweet") or {}
    text = note.get("text") or post["text"]
    for tco, repl in url_map(post).items():
        text = text.replace(tco, repl if repl else "")
    # 兜底：残留的 t.co（多为媒体链接，entities 缺失时）直接删
    text = re.sub(r"https://t\.co/\w+", "", text)
    # 清理行尾空格与结尾多余空行
    text = "\n".join(line.rstrip() for line in text.split("\n")).strip()
    return text


def main():
    handle = "user"
    try:
        handle = json.load(open(os.path.join(ROOT, "profile.json"))).get("handle", handle)
    except Exception:
        pass

    posts = {}
    for path in sorted(glob.glob(os.path.join(ROOT, "data", "raw", "page-*.json"))):
        page = json.load(open(path))
        for p in page.get("data", []):
            posts[p["id"]] = p

    out = []
    for p in posts.values():
        text = clean_text(p)
        if not text:
            continue
        created = datetime.strptime(p["created_at"], "%Y-%m-%dT%H:%M:%S.%fZ")
        local = created + timedelta(hours=8)  # 北京时间
        pm = p.get("public_metrics", {}) or {}
        out.append({
            "id": p["id"],
            "date": local.strftime("%Y-%m-%d"),
            "datetime": local.strftime("%Y-%m-%d %H:%M"),
            "text": text,
            "long": bool(p.get("note_tweet")),
            "sourceUrl": p.get("url") or f"https://x.com/{handle}/status/{p['id']}",
            "topic": classify(text),
            "metrics": {
                "likes": pm.get("like_count", 0),
                "replies": pm.get("reply_count", 0),
                "reposts": pm.get("retweet_count", 0) + pm.get("quote_count", 0),
                "bookmarks": pm.get("bookmark_count", 0),
                "views": pm.get("impression_count", 0),
            },
        })

    out.sort(key=lambda x: x["id"], reverse=True)
    dst = os.path.join(ROOT, "posts.json")
    json.dump(out, open(dst, "w"), ensure_ascii=False, indent=None, separators=(",", ":"))
    topics = {}
    for x in out:
        topics[x["topic"]] = topics.get(x["topic"], 0) + 1
    print(f"posts: {len(out)}  range: {out[-1]['date']} → {out[0]['date']}")
    print("topics:", json.dumps(topics, ensure_ascii=False))
    print("long posts:", sum(1 for x in out if x["long"]))


if __name__ == "__main__":
    main()
