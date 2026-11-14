#!/usr/bin/env python3
"""临时从工程里摘掉 / 装回 watch target 依赖。

为什么需要它：
    iPhone 版 App 里嵌着 BlindWalkWatch.app，两个包必须一起签名。
    watchOS 的描述文件需要「已配对的实体 Apple Watch」才能生成；
    这台 Mac 上只有模拟器手表（盲走 Watch 45mm 是 simulated），
    所以 watch target 的签名必然失败，连带 iPhone 版也构建不出来。

用法：
    python3 scripts/watch-off.py off     # 摘掉依赖（只构建 iPhone 版）
    python3 scripts/watch-off.py on      # 装回依赖
    python3 scripts/watch-off.py status

工程文件改动前会自动备份到 /tmp/bw-pbxproj-backup.pbxproj。
"""
import shutil
import sys
from pathlib import Path

PROJ = Path(__file__).resolve().parent.parent / "apple/BlindWalk.xcodeproj/project.pbxproj"
BACKUP = Path("/tmp/bw-pbxproj-backup.pbxproj")

BLOCK_WITH = """			buildPhases = (
				CFE9534CFBA0C855919001A3 /* Sources */,
				D7293E2154AA5AAD541C4E55 /* Resources */,
				97D982018C7F3E3FF1D439E9 /* Embed Watch Content */,
			);
			buildRules = (
			);
			dependencies = (
				780D2B66268D9DF8CA0AF19A /* PBXTargetDependency */,
			);
			name = BlindWalk;"""

BLOCK_WITHOUT = """			buildPhases = (
				CFE9534CFBA0C855919001A3 /* Sources */,
				D7293E2154AA5AAD541C4E55 /* Resources */,
			);
			buildRules = (
			);
			dependencies = (
			);
			name = BlindWalk;"""


def main() -> int:
    action = (sys.argv[1] if len(sys.argv) > 1 else "status").lower()
    text = PROJ.read_text(encoding="utf-8")

    has_watch = BLOCK_WITH in text
    without_watch = BLOCK_WITHOUT in text

    if action == "status":
        if has_watch:
            print("当前：盲盒 iPhone 版依赖 watch target（真机签名会失败）")
        elif without_watch:
            print("当前：已摘掉 watch 依赖（只构建 iPhone 版）")
        else:
            print("❌ 无法识别工程文件结构，可能已被改动过")
            return 1
        return 0

    if action == "off":
        if not has_watch:
            print("已经是摘掉状态，无需操作")
            return 0
        if not BACKUP.exists():
            shutil.copy2(PROJ, BACKUP)
            print(f"已备份 → {BACKUP}")
        PROJ.write_text(text.replace(BLOCK_WITH, BLOCK_WITHOUT), encoding="utf-8")
        print("✅ 已摘掉 watch 依赖")
        return 0

    if action == "on":
        if has_watch:
            print("已经装回状态，无需操作")
            return 0
        if not without_watch:
            print("❌ 无法识别工程文件结构")
            return 1
        PROJ.write_text(text.replace(BLOCK_WITHOUT, BLOCK_WITH), encoding="utf-8")
        print("✅ 已装回 watch 依赖")
        return 0

    print(f"未知动作：{action}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
