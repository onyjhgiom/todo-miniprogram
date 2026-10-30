# -*- coding: utf-8 -*-
"""直连腾讯云 TTS（TextToVoice）做端到端真验证，绕开小程序链路。
依次测试：鞠婧祎音色 502001 / IU 音色 603007 / 张凌赫音色 603005 / 备用男声 101030。"""
import io, sys, json, hashlib, hmac, time, datetime
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
import urllib.request

import os as _os
SECRET_ID = _os.environ.get('TENCENT_SECRET_ID', '')  # 密钥改走环境变量，不再明文落盘
SECRET_KEY = _os.environ.get('TENCENT_SECRET_KEY', '')
HOST = "tts.tencentcloudapi.com"
SERVICE = "tts"
VERSION = "2019-08-23"


def tc3_call(action, payload):
    ts = int(time.time())
    date = datetime.datetime.utcfromtimestamp(ts).strftime('%Y-%m-%d')
    http_body = json.dumps(payload, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    hashed = hashlib.sha256(http_body).hexdigest()
    canonical = "POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:%s\n\ncontent-type;host\n%s" % (HOST, hashed)
    scoped = "%s/%s/tc3_request" % (date, SERVICE)
    sig_str = ("TC3-HMAC-SHA256\n%d\n%s\n%s" % (ts, scoped, hashlib.sha256(canonical.encode('utf-8')).hexdigest())).encode('utf-8')

    def _h(key, msg):
        return hmac.new(key, msg, hashlib.sha256).digest()

    k_date = _h(("TC3" + SECRET_KEY).encode('utf-8'), date.encode('utf-8'))
    k_service = _h(k_date, SERVICE.encode('utf-8'))
    k_signing = _h(k_service, b"tc3_request")
    signature = hmac.new(k_signing, sig_str, hashlib.sha256).hexdigest()
    auth = ("TC3-HMAC-SHA256 Credential=%s/%s, SignedHeaders=content-type;host, "
            "Signature=%s" % (SECRET_ID, scoped, signature))
    req = urllib.request.Request("https://" + HOST, data=http_body, method='POST')
    req.add_header("Authorization", auth)
    req.add_header("Content-Type", "application/json; charset=utf-8")
    req.add_header("Host", HOST)
    req.add_header("X-TC-Action", action)
    req.add_header("X-TC-Version", VERSION)
    req.add_header("X-TC-Timestamp", str(ts))
    req.add_header("X-TC-Language", "zh-CN")
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        body = ''
        if hasattr(e, 'read'):
            try:
                body = e.read().decode('utf-8')
            except Exception:
                pass
        return {"__http_error__": str(e), "body": body[:600]}


if __name__ == '__main__':
    tests = [
        ("jujingyi 502001 智小柔", 502001),
        ("iu 602003 爱小悠", 602003),
        ("linghe 501006 千嶂", 501006),
        ("backup 101030 智柯", 101030),
    ]
    for name, vt in tests:
        r = tc3_call("TextToVoice", {"Text": "你好呀", "VoiceType": vt, "SessionId": "diag-" + str(vt)})
        resp = r.get("Response", r)
        if "Error" in resp:
            print(name, "=> FAIL", resp["Error"].get("Code"), resp["Error"].get("Message"))
        elif "__http_error__" in r:
            print(name, "=> HTTP_ERR", r["__http_error__"], r.get("body", ""))
        else:
            audio = resp.get("Audio", "")
            print(name, "=> OK, audio len", len(audio))
