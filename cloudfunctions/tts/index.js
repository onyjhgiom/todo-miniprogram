// 云函数：tts —— 语音合成（腾讯云基础语音合成 TextToVoice）
//
// 职责：接收文本与「音色来源」参数 → 清洗文本（去掉不适合朗读的旁白/表情/韩文）
//       → 调用腾讯云 TTS → 返回 base64 音频分段，前端落临时文件后播放。
//
// 为什么在云函数里做：小程序前端不能持有腾讯云密钥；而语音合成需要 SecretId/SecretKey，
// 放在云函数环境变量里最安全（与 asr 云函数共用同一对密钥）。
//
// 部署前需配置环境变量（云开发控制台 → 云函数 tts → 配置 → 环境变量）：
//   TENCENT_SECRET_ID   腾讯云 API 密钥 SecretId（与 asr 相同）
//   TENCENT_SECRET_KEY  腾讯云 API 密钥 SecretKey（与 asr 相同）
//   TTS_REGION          可选，默认 ap-guangzhou
//   TTS_DEFAULT_VOICE   可选，默认 502001（超自然大模型音色·智小柔）
//
// 另需在腾讯云控制台开通「语音合成」服务：https://console.cloud.tencent.com/tts
// （未开通会返回 UnsupportedOperation.ServerNotOpen）
//
// 入参：
//   text            必填，待合成文本
//   voiceType       可选，音色 ID（腾讯云 VoiceType），默认取环境变量
//   speed           可选，语速 [-2,6]，0 = 1.0 倍
//   volume          可选，音量 [-10,10]，0 = 正常
//   emotion         可选，多情感音色才支持（neutral/sad/happy/sajiao…），留空不传
//   sampleRate      可选，默认 24000
//   codec           可选，默认 mp3
//   maxSegments     可选，最多合成几段（默认 6，防止长文本费用失控）
// 出参：
//   { success, segments: [base64…], mime, voiceType, charCount, cleanedText }
//
// 部署：右键 cloudfunctions/tts → 上传并部署（云端安装依赖）

const cloud = require('wx-server-sdk');
const https = require('https');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

/* ==================== 腾讯云 TTS 签名（TC3-HMAC-SHA256） ==================== */

const HOST = 'tts.tencentcloudapi.com';
const SERVICE = 'tts';
const ACTION = 'TextToVoice';
const VERSION = '2019-08-23';

/** 单次请求的中文长度上限：官方 150 汉字，这里留出安全余量 */
const SEGMENT_LIMIT = 120;

function sha256Hex(str, isHex) {
  return crypto.createHash('sha256').update(str, isHex ? 'hex' : 'utf8').digest('hex');
}

function hmac(key, msg) {
  return crypto.createHmac('sha256', key).update(msg, 'utf8').digest();
}

/** 生成腾讯云 TC3-HMAC-SHA256 签名与请求头（与 asr 云函数同一套逻辑） */
function buildAuthHeaders(payloadStr) {
  // 密钥必须来自环境变量：部署时在云函数配置里填写 TENCENT_SECRET_ID / TENCENT_SECRET_KEY
  // 切勿在此硬编码密钥，否则上传到公开仓库会造成密钥泄露
  const secretId = process.env.TENCENT_SECRET_ID;
  const secretKey = process.env.TENCENT_SECRET_KEY;
  if (!secretId || !secretKey) {
    throw new Error('未配置 TENCENT_SECRET_ID / TENCENT_SECRET_KEY');
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

  const canonicalRequest = [
    'POST',
    '/',
    '',
    `content-type:application/json; charset=utf-8\nhost:${HOST}\n`,
    'content-type;host',
    sha256Hex(payloadStr)
  ].join('\n');

  const credentialScope = `${date}/${SERVICE}/tc3_request`;
  const stringToSign = [
    'TC3-HMAC-SHA256',
    timestamp,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join('\n');

  const secretDate = hmac('TC3' + secretKey, date);
  const secretService = hmac(secretDate, SERVICE);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = crypto
    .createHmac('sha256', secretSigning)
    .update(stringToSign, 'utf8')
    .digest('hex');

  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, ` +
    `SignedHeaders=content-type;host, Signature=${signature}`;

  return {
    Authorization: authorization,
    'Content-Type': 'application/json; charset=utf-8',
    Host: HOST,
    'X-TC-Action': ACTION,
    'X-TC-Version': VERSION,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Region': process.env.TTS_REGION || 'ap-guangzhou'
  };
}

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
            reject(new Error('TTS 返回内容无法解析：' + raw.slice(0, 200)));
          }
        });
      }
    );
    req.on('error', (e) => reject(e));
    req.write(body);
    req.end();
  });
}

/* ==================== 文本清洗与分段 ==================== */

/**
 * 朗读前清洗：语音只用「能读得出口」的那部分，保证语音与文字的人设语气一致，
 * 只是剔除了不适合朗读的成分：
 *   1) （旁白/动作描写）—— 拟人化细节是给眼睛看的，念出来会出戏
 *   2) emoji / 颜文字      —— 会被引擎读成乱码或直接报非法字符
 *   3) 韩文 / 日文假名      —— 该引擎中文音色读不了，避免出现奇怪发音（如 IU 的韩语问候）
 *   4) 连续空白与行首标点
 */
function cleanForSpeech(text) {
  let t = String(text || '');
  t = t.replace(/（[^）]*）/g, ' ').replace(/\([^)]*\)/g, ' ');
  t = t.replace(/\[[^\]]*\]/g, ' ').replace(/【[^】]*】/g, ' ');
  t = t.replace(/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/g, ''); // 韩文
  t = t.replace(/[\u3040-\u30FF]/g, '');                            // 日文假名
  t = t.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '');             // emoji（代理对）
  t = t.replace(/[\u2190-\u21FF\u2300-\u27BF\u2B00-\u2BFF\uFE0F\u2600-\u26FF]/g, ''); // 符号/杂项
  t = t.replace(/[~～^_*=#>`"']/g, ' ');
  t = t.replace(/\s+/g, ' ');
  t = t.replace(/^[，。！？、；：,.!?;:]+/, '');
  return t.trim();
}

/** 按标点切句，再聚合成 <= limit 字的段落（保证朗读的断句自然） */
function splitSegments(text, limit) {
  const sentences = text
    .split(/(?<=[。！？；!?;])/)
    .map((s) => s.trim())
    .filter(Boolean);

  const segs = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + s).length <= limit) {
      cur += s;
      continue;
    }
    if (cur) segs.push(cur);
    // 单句本身就超长：硬切
    if (s.length > limit) {
      for (let i = 0; i < s.length; i += limit) segs.push(s.slice(i, i + limit));
      cur = '';
    } else {
      cur = s;
    }
  }
  if (cur) segs.push(cur);
  return segs;
}

/* ==================== 主逻辑 ==================== */

async function synthOne(text, opts) {
  const payload = {
    Text: text,
    SessionId: 'sister-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    VoiceType: opts.voiceType,
    Speed: opts.speed,
    Volume: opts.volume,
    ProjectId: 0,
    ModelType: 1,
    PrimaryLanguage: 1,
    SampleRate: opts.sampleRate,
    Codec: opts.codec
  };
  // 多情感音色才支持 EmotionCategory；未显式指定时不传，避免非多情感音色报参数非法
  if (opts.emotion) {
    payload.EmotionCategory = opts.emotion;
    payload.EmotionIntensity = opts.emotionIntensity || 130;
  }

  const payloadStr = JSON.stringify(payload);
  const headers = buildAuthHeaders(payloadStr);
  const resp = await httpsPost(headers, payloadStr);
  const r = resp && resp.Response;
  if (!r) throw new Error('TTS 无响应');
  if (r.Error) throw new Error(`${r.Error.Code}: ${r.Error.Message}`);
  if (!r.Audio) throw new Error('TTS 未返回音频数据');
  return r.Audio;
}

exports.main = async (event) => {
  const raw = event && event.text;
  if (!raw || typeof raw !== 'string') {
    return { success: false, message: '缺少 text 参数' };
  }

  const voiceType = Number(event.voiceType) || Number(process.env.TTS_DEFAULT_VOICE) || 502001;
  const opts = {
    voiceType,
    speed: typeof event.speed === 'number' ? event.speed : 0,
    volume: typeof event.volume === 'number' ? event.volume : 0,
    sampleRate: Number(event.sampleRate) || 24000,
    codec: event.codec === 'wav' ? 'wav' : 'mp3',
    emotion: typeof event.emotion === 'string' ? event.emotion : '',
    emotionIntensity: Number(event.emotionIntensity) || 0
  };

  const cleaned = cleanForSpeech(raw);
  if (!cleaned) return { success: false, message: '清洗后没有可朗读内容' };

  const maxSegments = Math.max(1, Math.min(10, Number(event.maxSegments) || 6));
  const segs = splitSegments(cleaned, SEGMENT_LIMIT).slice(0, maxSegments);

  try {
    const segments = [];
    for (const s of segs) {
      segments.push(await synthOne(s, opts));
    }
    return {
      success: true,
      segments,
      mime: opts.codec === 'wav' ? 'audio/wav' : 'audio/mp3',
      voiceType: opts.voiceType,
      charCount: cleaned.length,
      cleanedText: cleaned
    };
  } catch (err) {
    console.error('[tts] 合成失败', err);
    return { success: false, message: (err && err.message) || '语音合成失败' };
  }
};
