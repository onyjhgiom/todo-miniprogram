# -*- coding: utf-8 -*-
"""查询腾讯云 TTS 资源包状态（DescribePackages），判断额度到底有没有到账。"""
import io, sys, json, hashlib, hmac, datetime, urllib.request
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import os as _os
SECRET_ID = _os.environ.get('TENCENT_SECRET_ID', '')  # 密钥改走环境变量，不再明文落盘
SECRET_KEY = _os.environ.get('TENCENT_SECRET_KEY', '')
HOST = 'tts.tencentcloudapi.com'
SERVICE = 'tts'
VERSION = '2019-08-23'
REGION = 'ap-guangzhou'


def call(action, params):
    ts = int(datetime.datetime.now().timestamp())
    date = datetime.datetime.fromtimestamp(ts, datetime.UTC).strftime('%Y-%m-%d')
    payload = json.dumps(params, separators=(',', ':'))
    hashed = hashlib.sha256(payload.encode('utf-8')).hexdigest()
    canon = 'POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:%s\ncontent-type;host\n%s' % (HOST, hashed)
    scope = '%s/%s/tc3_request' % (date, SERVICE)
    sts = 'TC3-HMAC-SHA256\n%d\n%s\n%s' % (ts, scope, hashlib.sha256(canon.encode('utf-8')).hexdigest())

    def hm(key, msg):
        return hmac.new(key, msg.encode('utf-8'), hashlib.sha256).digest()
    k = hm(hm(hm(('TC3' + SECRET_KEY).encode('utf-8'), date), SERVICE), 'tc3_request')
    sig = hmac.new(k, sts.encode('utf-8'), hashlib.sha256).hexdigest()
    auth = 'TC3-HMAC-SHA256 Credential=%s/%s, SignedHeaders=content-type;host, Signature=%s' % (SECRET_ID, scope, sig)
    req = urllib.request.Request('https://' + HOST + '/', data=payload.encode('utf-8'), headers={
        'Authorization': auth, 'Content-Type': 'application/json; charset=utf-8', 'Host': HOST,
        'X-TC-Action': action, 'X-TC-Version': VERSION, 'X-TC-Timestamp': str(ts), 'X-TC-Region': REGION
    })
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode('utf-8'))


print('== DescribePackages ==')
print(json.dumps(call('DescribePackages', {}), ensure_ascii=False, indent=1))
