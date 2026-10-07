#!/usr/bin/env python3
"""Writes the AltStore / SideStore source for VanillaTurkey Mobile (iPhone).

Published by the supervisor at https://80-91-71-177.sslip.io/vtclient/ios/apps.json (next to icon.png); the in-app updater and the
website read it too (plans/IOS.md).  Usage:
  make_apps_json.py --version 1.0.0 --ipa VanillaTurkey-1.0.0.ipa --url https://.../VanillaTurkey-1.0.0.ipa --out apps.json
"""
import argparse, datetime, hashlib, json, os

BASE = "https://80-91-71-177.sslip.io/vtclient/ios"
BUNDLE = "net.vanillaturkey.mobile"

ap = argparse.ArgumentParser()
ap.add_argument("--version", required=True)
ap.add_argument("--ipa", required=True)
ap.add_argument("--url", required=True, help="public download URL of the .ipa")
ap.add_argument("--out", required=True)
ap.add_argument("--notes", default="VanillaTurkey Client iPhone sürümü.")
a = ap.parse_args()

size = os.path.getsize(a.ipa)
h = hashlib.sha256()
with open(a.ipa, "rb") as f:
    for chunk in iter(lambda: f.read(1 << 20), b""):
        h.update(chunk)
date = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

desc = ("VanillaTurkey Client'in iPhone sürümü: aynı hesap, jeton, kozmetik, arkadaş, sesli oda ve ayarlar. "
        "Resmi olmayan değiştirilmiş Amethyst-iOS (GPL-3.0). Oyun için JIT gerekir (StikDebug / SideStore / TrollStore).")
version = {
    "version": a.version, "date": date, "localizedDescription": a.notes, "downloadURL": a.url,
    "size": size, "sha256": h.hexdigest(), "minOSVersion": "14.0",
}
app = {
    "name": "VanillaTurkey", "bundleIdentifier": BUNDLE, "developerName": "VanillaTurkey",
    "subtitle": "Minecraft Java, VanillaTurkey Client ile iPhone'da",
    "localizedDescription": desc, "iconURL": BASE + "/icon.png", "tintColor": "6F9BD6", "category": "games",
    "screenshotURLs": [],
    # AltStore 2.x reads `versions`; older AltStore / SideStore builds read the flat fields below
    "versions": [version],
    "version": a.version, "versionDate": date, "versionDescription": a.notes, "downloadURL": a.url, "size": size,
    "appPermissions": {"entitlements": [], "privacy": {
        "NSMicrophoneUsageDescription": "Ses odalarında ve oyun içi sesli sohbette konuşmak için.",
        "NSLocalNetworkUsageDescription": "AltServer / SideStore ve yerel sunucuları bulmak için."}},
}
src = {
    "name": "VanillaTurkey", "identifier": "net.vanillaturkey.source", "subtitle": "VanillaTurkey Client iPhone",
    "description": "VanillaTurkey Mobile için resmi güncelleme kaynağı.", "iconURL": BASE + "/icon.png", "tintColor": "6F9BD6",
    "website": "https://80-91-71-177.sslip.io/", "sourceURL": BASE + "/apps.json",
    "apps": [app], "news": [],
}
with open(a.out, "w", encoding="utf-8") as f:
    json.dump(src, f, ensure_ascii=False, indent=2)
print("wrote", a.out, a.version, size, "bytes")
