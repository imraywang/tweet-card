#!/usr/bin/env python3
"""生成 backgrounds/ 下的渐变背景（SVG，3:4 竖图 1080x1440），并输出 backgrounds/manifest.json。
不依赖任何外部图片，想加自己的照片直接丢进 backgrounds/ 再手动加进 manifest 即可。
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DST = os.path.join(ROOT, "backgrounds")
os.makedirs(DST, exist_ok=True)

# (文件名, 中文名, [渐变色停靠点], 渐变角度, 噪点透明度)
PALETTES = [
    ("ink-dawn",     "墨色黎明", ["#0f1420", "#1c2a44", "#3b537a"], 160, 0.05),
    ("deep-forest",  "深林夜色", ["#0a1410", "#16302a", "#2e5747"], 150, 0.05),
    ("ember",        "暮色余烬", ["#1a1210", "#4a2c1e", "#8a5a33"], 200, 0.06),
    ("harbor",       "海港蓝调", ["#0c1622", "#173754", "#2f6a8f"], 145, 0.05),
    ("violet-night", "紫夜",     ["#120f1e", "#2c2250", "#5b4a8f"], 170, 0.05),
    ("slate",        "石板灰",   ["#15171c", "#2a2f38", "#4a525f"], 155, 0.04),
    ("plum-smoke",   "烟紫",     ["#1c1420", "#3d2438", "#6d4260"], 190, 0.05),
    ("midnight",     "午夜",     ["#05070c", "#0d1526", "#1d2f52"], 160, 0.04),
    ("paper-warm",   "暖纸",     ["#efe8dc", "#e2d5c0", "#cdb99b"], 150, 0.05),
    ("mist",         "晨雾",     ["#dfe5ea", "#c3ced8", "#9fb0bf"], 160, 0.04),
]

SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440" viewBox="0 0 1080 1440">
  <defs>
    <linearGradient id="g" gradientTransform="rotate({angle} 0.5 0.5)">
      <stop offset="0%" stop-color="{c0}"/>
      <stop offset="55%" stop-color="{c1}"/>
      <stop offset="100%" stop-color="{c2}"/>
    </linearGradient>
    <radialGradient id="glow" cx="30%" cy="20%" r="80%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.10"/>
      <stop offset="60%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <filter id="noise">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope="{noise}"/></feComponentTransfer>
      <feComposite operator="over" in2="SourceGraphic"/>
    </filter>
  </defs>
  <rect width="1080" height="1440" fill="url(#g)"/>
  <rect width="1080" height="1440" fill="url(#glow)"/>
  <rect width="1080" height="1440" filter="url(#noise)" opacity="0.6" fill="none"/>
</svg>"""

# 真实照片（来自 picsum.photos，Unsplash 授权免费可用）；自己加图就往这里加一行
PHOTOS = [
    ("photo-misty-marsh.jpg",  "雾泽晨光"),
    ("photo-forest-coast.jpg", "森林海岸"),
    ("photo-pebble-beach.jpg", "冷调海滩"),
    ("photo-rocky-bay.jpg",    "礁石海湾"),
    ("photo-snow-peaks.jpg",   "雪山云影"),
    ("photo-dusk-forest.jpg",  "暮色林线"),
    ("photo-flower-dusk.jpg",  "花田黄昏"),
    ("photo-golden-field.jpg", "金色草原"),
    ("photo-desert-dusk.jpg",  "沙丘暮色"),
    ("photo-forest-path.jpg",  "林间小路"),
    ("photo-lighthouse.jpg",   "灯塔黑白"),
    ("photo-white-town.jpg",   "白色小镇"),
    ("photo-canal-town.jpg",   "运河小镇"),
    # 城市 / 街景
    ("photo-city-bridge-night.jpg", "大桥夜色"),
    ("photo-london-night.jpg",      "伦敦夜色"),
    ("photo-foggy-street.jpg",      "雾夜街灯"),
    ("photo-far-city-lights.jpg",   "远城灯火"),
    ("photo-city-rooftops.jpg",     "城市屋顶"),
    ("photo-city-crosswalk.jpg",    "街头行人"),
    ("photo-old-town-door.jpg",     "老城门廊"),
    ("photo-concrete-block.jpg",    "清水混凝土"),
    ("photo-vintage-cars.jpg",      "街角老爷车"),
    ("photo-cafe-silhouette.jpg",   "街角咖啡馆"),
]

manifest = [{"file": fn, "name": name} for fn, name in PHOTOS if os.path.exists(os.path.join(DST, fn))]
for slug, name, colors, angle, noise in PALETTES:
    svg = SVG.format(c0=colors[0], c1=colors[1], c2=colors[2], angle=angle, noise=noise)
    fn = f"{slug}.svg"
    open(os.path.join(DST, fn), "w").write(svg)
    manifest.append({"file": fn, "name": name})

json.dump(manifest, open(os.path.join(DST, "manifest.json"), "w"), ensure_ascii=False, indent=1)
print(f"manifest: {len(manifest)} backgrounds ({len(manifest) - len(PALETTES)} photos + {len(PALETTES)} gradients)")
