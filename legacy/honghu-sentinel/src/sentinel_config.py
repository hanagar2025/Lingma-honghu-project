#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""资金哨兵（Honghu Sentinel）· 统一配置

配置优先级：
  1. 环境变量（HONGHU_VAULT / HONGHU_CLOUDBASE_ENV_ID / HONGHU_SITE_TOKEN）
  2. 包内 config/settings.json（不入库，从 settings.example.json 复制）
  3. 旧部署机上的 web_site 凭证文件（向后兼容现有 launchd 运行环境）
  4. 空字符串占位（代码中不内置任何真实 token / 环境 ID）

迁移到阿里云后：把本模块替换为配置中心 / 环境变量注入即可，
四个业务脚本只依赖这里暴露的三个函数，不需要逐个改。
"""
import os
import json
from pathlib import Path

_THIS_DIR = Path(__file__).resolve().parent      # src/
_PKG_ROOT = _THIS_DIR.parent                      # honghu-sentinel/

# 旧部署机（本机 launchd）的研究库默认位置，仅为向后兼容保留
_LEGACY_VAULT = Path("/Users/muscap/鸿鹄研究库")


def vault_root():
    """数据研究库根目录：原始数据(97)/成品(80)/看板(40)都在它下面"""
    v = os.environ.get("HONGHU_VAULT")
    if v:
        return Path(v).expanduser()
    return _LEGACY_VAULT


def _settings():
    for p in (_PKG_ROOT / "config" / "settings.json",
              vault_root() / "98_自动化" / "web_site" / "settings.json"):
        try:
            if p.exists():
                return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


_SETTINGS = _settings()


def cloudbase_env_id():
    """腾讯云 CloudBase 环境 ID（当前 Web 适配器用；迁阿里云后弃用）"""
    return os.environ.get("HONGHU_CLOUDBASE_ENV_ID") or _SETTINGS.get("cloudbase_env_id", "")


def site_token():
    """网页随机路径 token（URL 里的不可猜测段），空则发布功能不可用"""
    env = os.environ.get("HONGHU_SITE_TOKEN")
    if env:
        return env
    if _SETTINGS.get("site_token"):
        return _SETTINGS["site_token"]
    f = vault_root() / "98_自动化" / "web_site" / ".token"
    try:
        if f.exists():
            return f.read_text().strip()
    except Exception:
        pass
    return ""


def pushplus_token_file():
    """PushPlus 微信推送 token 文件路径（文件权限建议 600，不入库）"""
    return vault_root() / "98_自动化" / "web_site" / ".pushplus_token"
