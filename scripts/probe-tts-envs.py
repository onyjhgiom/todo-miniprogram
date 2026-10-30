# -*- coding: utf-8 -*-
"""查账号名下所有 TCB 云环境（地域 x DescribeEnvs）"""
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location('cte', __file__.replace('probe-tts-envs.py', 'configure-tts-env.py'))
# 直接复制 call_api 逻辑，避免 import 副作用
import hashlib, hmac, time, datetime, urllib.request

import os as _os
SECRET_ID = _os.environ.get('TENCENT_SECRET_ID', '')  # 密钥改走环境变量，不再明文落盘
SECRET_KEY = _os.environ.get('TENCENT_SECRET_KEY', '')


def call_api(service, version, action, payload, region):
    host = service + '.tencentcloudapi.com'
    ts = int(time.time())
    date = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d')
    body = json.dumps(payload, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    canonical_headers = 'content-type:application/json; charset=utf-8\nhost:%s\nx-tc-action:%s\n' % (host.lower(), action.lower())
    signed_headers = 'content-type;host;x-tc-action'
    canonical_request = 'POST\n/\n\n' + canonical_headers + '\n' + signed_headers + '\n' + hashlib.sha256(body).hexdigest()
    scope = '%s/%s/tc3_request' % (date, service)
    k_date = hmac.new(('TC3' + SECRET_KEY).encode(), date.encode(), hashlib.sha256).digest()
    k_service = hmac.new(k_date, service.encode(), hashlib.sha256).digest()
    k_signing = hmac.new(k_service, b'tc3_request', hashlib.sha256).digest()
    sts = 'TC3-HMAC-SHA256\n%d\n%s\n%s' % (ts, scope, hashlib.sha256(canonical_request.encode()).hexdigest())
    sig = hmac.new(k_signing, sts.encode(), hashlib.sha256).hexdigest()
    auth = 'TC3-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s' % (SECRET_ID, scope, signed_headers, sig)
    req = urllib.request.Request('https://' + host, data=body, method='POST')
    for k, v in [('Host', host), ('Content-Type', 'application/json; charset=utf-8'), ('X-TC-Action', action),
                 ('X-TC-Version', version), ('X-TC-Region', region), ('X-TC-Timestamp', str(ts)), ('Authorization', auth)]:
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return {'HTTP_ERROR': e.code, 'body': e.read().decode('utf-8', 'ignore')[:300]}


for r in ['ap-shanghai', 'ap-guangzhou', 'ap-beijing', 'ap-chengdu', 'ap-nanjing', 'ap-chongqing']:
    res = call_api('tcb', '2018-06-08', 'DescribeEnvs', {}, r)
    resp = res.get('Response') or {}
    err = resp.get('Error')
    if err:
        print('[%s] ERR %s %s' % (r, err.get('Code'), (err.get('Message') or '')[:60]))
        continue
    envs = resp.get('EnvList') or []
    for e in envs:
        print('[%s] ENV %s alias=%s status=%s source=%s' % (
            r, e.get('EnvId'), e.get('Alias'), e.get('Status'), e.get('Source')))
    if not envs:
        print('[%s] 无环境' % r)
