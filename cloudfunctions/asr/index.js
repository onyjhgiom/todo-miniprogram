// 云函数：asr —— 语音识别（腾讯云一句话识别）
//
// 职责：接收小程序上传到云存储的录音 fileID → 下载音频 → 调用腾讯云 ASR → 返回文本。
// 不依赖任何小程序插件，个人主体小程序同样可用。
//
// 部署前需配置环境变量（云开发控制台 → 云函数 asr → 配置 → 环境变量）：
//   TENCENT_SECRET_ID   腾讯云 API 密钥 SecretId
//   TENCENT_SECRET_KEY  腾讯云 API 密钥 SecretKey
//   ASR_REGION          可选，默认 ap-guangzhou
//   ASR_ENGINE          可选，默认 16k_zh（中文普通话，16k 采样率）
//
// 部署：右键 cloudfunctions/asr → 上传并部署（云端安装依赖）

const cloud = require('wx-server-sdk');
const https = require('https');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

/* ==================== 腾讯云 ASR 签名（TC3-HMAC-SHA256） ==================== */

const HOST = 'asr.tencentcloudapi.com';
const SERVICE = 'asr';
const ACTION = 'SentenceRecognition';
const VERSION = '2019-06-14';

function sha256Hex(str, isHex) {
  return crypto.createHash('sha256').update(str, isHex ? 'hex' : 'utf8').digest('hex');
}

function hmac(key, msg) {
  return crypto.createHmac('sha256', key).update(msg, 'utf8').digest();
}

/**
 * 生成腾讯云 TC3-HMAC-SHA256 签名与请求头。
 */
function buildAuthHeaders(payloadStr) {
  const secretId = process.env.TENCENT_SECRET_ID;
  const secretKey = process.env.TENCENT_SECRET_KEY;
  if (!secretId || !secretKey) {
    throw new Error('未配置 TENCENT_SECRET_ID / TENCENT_SECRET_KEY 环境变量');
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

  // 1. 拼接规范请求串
  const canonicalRequest = [
    'POST',
    '/',
    '',
    `content-type:application/json; charset=utf-8\nhost:${HOST}\n`,
    'content-type;host',
    sha256Hex(payloadStr)
  ].join('\n');

  // 2. 拼接待签名字符串
  const credentialScope = `${date}/${SERVICE}/tc3_request`;
  const stringToSign = [
    'TC3-HMAC-SHA256',
    timestamp,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join('\n');

  // 3. 计算签名
  const secretDate = hmac('TC3' + secretKey, date);
  const secretService = hmac(secretDate, SERVICE);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = crypto
    .createHmac('sha256', secretSigning)
    .update(stringToSign, 'utf8')
    .digest('hex');

  // 4. 拼接 Authorization
  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, ` +
    `SignedHeaders=content-type;host, Signature=${signature}`;

  return {
    Authorization: authorization,
    'Content-Type': 'application/json; charset=utf-8',
    Host: HOST,
    'X-TC-Action': ACTION,
    'X-TC-Version': VERSION,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Region': process.env.ASR_REGION || 'ap-guangzhou'
  };
}

/** 发起 HTTPS POST，返回解析后的 JSON */
function httpsPost(headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: HOST,
        path: '/',
        method: 'POST',
        headers: Object.assign({}, headers, { 'Content-Length': Buffer.byteLength(body) })
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(new Error('ASR 返回内容无法解析：' + raw.slice(0, 200)));
          }
        });
      }
    );
    req.on('error', (e) => reject(e));
    req.write(body);
    req.end();
  });
}

/* ==================== 主逻辑 ==================== */

exports.main = async (event) => {
  const fileID = event && event.fileID;
  if (!fileID || typeof fileID !== 'string') {
    return { success: false, message: '缺少 fileID 参数' };
  }

  try {
    // 1. 从云存储下载录音
    const dl = await cloud.downloadFile({ fileID });
    const audioBase64 = dl.fileContent.toString('base64');

    // 2. 组装 ASR 请求
    const payload = {
      ProjectId: 0,
      SubServiceType: 2,          // 2 = 一句话识别
      EngSerViceType: process.env.ASR_ENGINE || '16k_zh',
      SourceType: 1,              // 1 = 音频数据（base64）
      VoiceFormat: 'mp3',
      Data: audioBase64,
      DataLen: dl.fileContent.length
    };
    const payloadStr = JSON.stringify(payload);

    // 3. 调用腾讯云 ASR
    const headers = buildAuthHeaders(payloadStr);
    const resp = await httpsPost(headers, payloadStr);

    const r = resp && resp.Response;
    if (!r) return { success: false, message: 'ASR 无响应' };
    if (r.Error) {
      return { success: false, message: `${r.Error.Code}: ${r.Error.Message}` };
    }
    return { success: true, text: r.Result || '', requestId: r.RequestId };
  } catch (err) {
    console.error('[asr] 识别失败', err);
    return { success: false, message: (err && err.message) || '语音识别失败' };
  }
};
