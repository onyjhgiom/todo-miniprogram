// 云函数 triggerDueReminders
// 定时器触发（每分钟跑一次）：调用 todos.remind 扫描即将触发的提醒项，
// 把 reminded 标记为 true 并返回扫描/发送统计
//
// 部署步骤：右键 cloudfunctions/triggerDueReminders → 上传并部署
// 然后在云开发控制台 → 云函数 → triggerDueReminders → 函数配置 → 触发器
// 创建定时触发器：cron "* * * * * *" 表示每分钟触发一次（按需调整）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async () => {
  try {
    const res = await cloud.callFunction({
      name: 'todos',
      data: { action: 'remind' }
    });
    const payload = (res && res.result) || {};
    console.log('[triggerDueReminders] result:', JSON.stringify(payload));
    return { success: true, ...payload };
  } catch (err) {
    console.error('[triggerDueReminders] error:', err);
    return { success: false, error: err.message || String(err) };
  }
};