# -*- coding: utf-8 -*-
"""
远程配置 tts 云函数环境变量并云端验证（TC3-HMAC-SHA256 签名直调腾讯云 API）。
1) scf UpdateFunctionConfiguration：写入 TENCENT_SECRET_ID / TENCENT_SECRET_KEY
2) scf Invoke：{"text":"...","voiceType":502001} 端到端验证 TextToVoice
"""
import json
import hashlib
import hmac
import time
import datetime
import urllib.request

import os as _os
SECRET_ID = _os.environ.get('TENCENT_SECRET_ID', '')  # 密钥改走环境变量，不再明文落盘
SECRET_KEY = _os.environ.get('TENCENT_SECRET_KEY', '')
NAMESPACE = 'cloud1-d2gpqo6ndc634e36d'
REGIONS = ['ap-shanghai', 'ap-guangzhou']


def call_api(service, version, action, payload, region):
    host = service + '.tencentcloudapi.com'
    ts = int(time.time())
    date = datetime.datetime.utcfromtimestamp(ts).strftime('%Y-%m-%d')
    body = json.dumps(payload, separators=(',', ':'), ensure_ascii=False).encode('utf-8')

    canonical_headers = 'content-type:application/json; charset=utf-8\nhost:%s\nx-tc-action:%s\n' % (host.lower(), action.lower())
    signed_headers = 'content-type;host;x-tc-action'
    canonical_request = 'POST\n/\n\n' + canonical_headers + '\n' + signed_headers + '\n' + hashlib.sha256(body).hexdigest()

    scope = '%s/%s/tc3_request' % (date, service)
    k_date = hmac.new(('TC3' + SECRET_KEY).encode(), date.encode(), hashlib.sha256).digest()
    k_service = hmac.new(k_date, service.encode(), hashlib.sha256).digest()
    k_signing = hmac.new(k_service, b'tc3_request', hashlib.sha256).digest()
    string_to_sign = 'TC3-HMAC-SHA256\n%d\n%s\n%s' % (ts, scope, hashlib.sha256(canonical_request.encode()).hexdigest())
    signature = hmac.new(k_signing, string_to_sign.encode(), hashlib.sha256).hexdigest()

    auth = ('TC3-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s'
            % (SECRET_ID, scope, signed_headers, signature))
    req = urllib.request.Request('https://' + host, data=body, method='POST')
    req.add_header('Host', host)
    req.add_header('Content-Type', 'application/json; charset=utf-8')
    req.add_header('X-TC-Action', action)
    req.add_header('X-TC-Version', version)
    req.add_header('X-TC-Region', region)
    req.add_header('X-TC-Timestamp', str(ts))
    req.add_header('Authorization', auth)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return {'HTTP_ERROR': e.code, 'body': e.read().decode('utf-8', 'ignore')[:500]}


def main():
    # ---- 1. 找到函数所在地域并写入环境变量 ----
    cfg = {
        'FunctionName': 'tts',
        'Namespace': NAMESPACE,
        'Environment': {'Variables': [
            {'Key': 'TENCENT_SECRET_ID', 'Value': SECRET_ID},
            {'Key': 'TENCENT_SECRET_KEY', 'Value': SECRET_KEY}
        ]}
    }
    ok_region = None
    for r in REGIONS:
        res = call_api('scf', '2018-04-16', 'UpdateFunctionConfiguration', cfg, r)
        print('[%s] UpdateFunctionConfiguration ->' % r, json.dumps(res, ensure_ascii=False)[:300])
        err = (res.get('Response') or {}).get('Error')
        if not err:
            ok_region = r
            break
        code = err.get('Code', '')
        # 函数不存在 → 换地域继续；其他错误（如签名/权限）直接停
        if 'ResourceNotFound' not in code and 'FunctionName' not in code:
            print('非地域问题，停止：', err)
            return
    if not ok_region:
        print('两个地域都没找到 tts 函数：检查云函数是否部署、密钥是否属于同一腾讯云账号')
        return

    # ---- 2. 等配置生效后云端调用验证 ----
    time.sleep(8)
    for attempt in range(3):
        res = call_api('scf', '2018-04-16', 'Invoke',
                       {'FunctionName': 'tts', 'Namespace': NAMESPACE,
                        'ClientContext': json.dumps({'text': '你好呀，我是鞠婧祎', 'voiceType': 502001})},
                       ok_region)
        resp = res.get('Response') or {}
        ret = resp.get('Ret')
        err = resp.get('Error')
        print('[Invoke #%d]' % attempt, json.dumps(res, ensure_ascii=False)[:600])
        if err and 'tatus' in (err.get('Message') or '') + (err.get('Code') or ''):
            time.sleep(6)  # 函数还在 Updating，重试
            continue
        break

    # ---- 3. 结论 ----
    if isinstance(ret, str):
        try:
            ret = json.loads(ret)
        except Exception:
            pass
    if isinstance(ret, dict) and ret.get('success'):
        print('RESULT_OK tts 端到端打通：segments=%d 段' % len(ret.get('segments') or []))
    else:
        print('RESULT_FAIL 函数已通但合成失败，看上面 Ret/message')


main()
