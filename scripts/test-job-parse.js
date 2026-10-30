// 本地冒烟测试：验证 jobParse 对三大平台与可抓取站点的行为
const mod = require('../cloudfunctions/jobParse/index.js');

const urls = [
  'https://www.zhipin.com/job_detail/229254ab3ab1a1380nN709m7FVZS.html?securityId=X2t4AXxGZQ2Z1-D1iOVT-7Vpdnk9KkgafGTlznjmXhG23335zEFjjgG2iugGU',
  'https://jobs.51job.com/shanghai-pdxq/155827998.html',
  'https://www.liepin.com/job/1956473826.shtml',
  'https://www.shixiseng.com/intern/inn_abcdef',
  'https://sou.zhaopin.com/?jl=489'
];

(async () => {
  for (const u of urls) {
    const r = await mod.main({ url: u });
    console.log('---', u.slice(0, 62));
    console.log(
      JSON.stringify(
        {
          success: r.success,
          blocked: r.blocked,
          reason: r.reason,
          platform: r.platform,
          confidence: r.confidence,
          data: r.data
        },
        null,
        1
      ).slice(0, 600)
    );
  }
})();
