// app.js
// 入口文件：初始化云开发环境 + 启动提醒调度器
// 云开发环境 ID 替换为你在 CloudBase 控制台创建的环境 ID
const scheduler = require('./utils/reminder-scheduler');
const alertScheduler = require('./utils/alert-scheduler');
// 弹性待办顺延调度：App 启动时把逾期的弹性待办自动顺延（最多 3 次后交给 UI 引导减负）
let todoStore = null;
try {
  todoStore = require('./utils/todo-store');
} catch (e) {
  console.warn('[app] todo-store 未加载，顺延调度跳过', e);
}
const ScheduleStore = require('./course-schedule/store/scheduleStore');
// 「添加到桌面」埋点（仅统计从桌面图标进入的 scene 1023；无添加/监听 API）
const addToDesktop = require('./utils/add-to-desktop');
// 课程表 AI 能力已按平台审核要求整体下线：课程表录入一律走本地规则解析 + 手动编辑。

/**
 * 基础库 / 开发者工具自身的噪声错误。
 * 典型：webapi_getwxaasyncsecinfo:fail（-80001/-80002，工具未登录或网络受限时必现）、
 * reportRealtimeAction:fail（实时日志在 worker 里不支持）。
 * 这些不是业务代码异常，统一吞掉，避免掩盖真实问题。
 */
const SDK_NOISE = /webapi_getwxaasyncsecinfo|appServiceSDKScriptError|reportRealtimeAction/;

/**
 * 取当前页面栈顶的 route（如 pages/tools/tools），仅用于错误日志定位。
 * 打日志本身绝不能再抛错，所以这里任何异常都吞掉。
 */
function currentPageRoute() {
  try {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    const cur = pages && pages[pages.length - 1];
    return cur && cur.route ? cur.route : '';
  } catch (e) {
    return '';
  }
}

App({
  globalData: {
    // ↓↓↓ 替换为你的 CloudBase 环境 ID（见 README 步骤 1）
    envId: 'cloud1-d2gpqo6ndc634e36d',
    cloudReady: false,
    // 待办列表跨页内存缓存：onShow 秒回显旧数据再静默刷新，避免返回首页白屏等待
    todoCache: null,
    // 课程表工具：全局单例 store（录入走本地规则解析 + 手动编辑）
    store: null,
    currentWeek: 1,
    pendingImport: null,
    parseInstruction: null,
  },

  onLaunch() {
    this.initCloud();
    this.silenceSdkNoise();
    this.initCourseScheduleStore();

    // 启动提醒调度器：每 30 秒自动检查到期提醒（通知条/弹窗）
    scheduler.startScheduler();
    // 启动工具通用提醒调度：多人提醒 / 订阅提醒 的本地定时通知
    alertScheduler.startAlertScheduler();
    // 弹性待办顺延：把逾期的弹性待办自动往后顺延（达到上限后留待 UI 引导减负）
    if (todoStore && typeof todoStore.runSnoozePass === 'function') {
      try {
        todoStore.runSnoozePass();
      } catch (e) {
        console.warn('[app] 顺延调度执行失败，已忽略', e);
      }
    }
  },

  /**
   * 初始化课程表工具全局 store。
   * 课程表 AI 已下线：parseInstruction 保持 null，parser.js 直接走本地规则解析（localParse）。
   * 学期起始与总周数建议后续从后端/本地配置读取；当前按 2026 秋季学期默认值兜底。
   */
  initCourseScheduleStore() {
    const semesterStart = '2026-09-07'; // TODO: 替换为后端学期配置
    const totalWeeks = 16;
    try {
      this.globalData.store = new ScheduleStore({ semesterStart, totalWeeks });
      this.globalData.currentWeek = this.computeWeek(semesterStart, totalWeeks);
      console.log('[app] 课程表 store 已初始化，currentWeek=', this.globalData.currentWeek);
    } catch (e) {
      console.error('[app] 课程表 store 初始化失败', e);
    }
  },

  /** week = floor((today - semesterStart) / 7) + 1，钳制到 1~totalWeeks */
  computeWeek(semesterStart, totalWeeks) {
    const DAY = 86400000;
    const s = Date.parse(semesterStart + 'T00:00:00+08:00');
    const now = Date.now();
    const diff = Math.floor((now - s) / DAY);
    const week = Math.floor(diff / 7) + 1;
    if (week < 1) return 1;
    if (week > totalWeeks) return totalWeeks;
    return week;
  },

  /**
   * 拦截「基础库 / 开发者工具自身」产生的噪声。
   * webapi_getwxaasyncsecinfo:fail（-80001）会以「未处理的 Promise 拒绝」形式抛出，
   * 它不会走 App.onError，只能靠 onUnhandledRejection 兜住；注册该回调后，
   * 未处理的拒绝不再触发默认错误上报，控制台也就不会刷屏。
   * 注意：这是工具/网络环境问题（工具未登录 / 代理拦截 / 版本过旧），并非业务异常。
   */
  silenceSdkNoise() {
    if (typeof wx.onUnhandledRejection !== 'function') return;
    wx.onUnhandledRejection((res) => {
      const reason = res && typeof res === 'object' ? res.reason : res;
      const text =
        typeof reason === 'string'
          ? reason
          : (reason && (reason.errMsg || reason.message)) || '';
      if (SDK_NOISE.test(String(text))) return; // 已知噪声，直接吞掉
      console.error('[app] 未处理的 Promise 拒绝：', reason);
    });
  },

  /**
   * 云环境初始化。
   * 失败一律降级为「纯本地模式」——业务层（todo-store / cloud.ts）已有本地兜底，
   * 绝不因为云环境不可用就让小程序白屏。
   */
  initCloud() {
    if (!wx.cloud) {
      console.error('当前微信版本过低，请升级到最新微信后再使用本小程序');
      return;
    }
    try {
      wx.cloud.init({
        env: this.globalData.envId,
        // 关闭 traceUser：省掉每次启动向云开发上报用户访问的那次 webapi 调用
        traceUser: false
      });
      this.globalData.cloudReady = true;
      console.log('[app] wx.cloud 已初始化，环境：', this.globalData.envId);
    } catch (e) {
      this.globalData.cloudReady = false;
      console.warn('[app] wx.cloud 初始化失败，已降级为本地模式', e);
    }
  },

  onShow() {
    // 【自愈兜底】wx.showLoading({ mask: true }) 是**原生全屏遮罩**，一旦某处
    // 抛错或 Promise 永不 settle 而没关掉，它会盖住整个小程序 —— 表现就是
    // 「页面还在、点哪儿都没反应」，且不会报任何错。回到前台时无条件收一次：
    // 没有 loading 时它是空操作，不影响正常业务里的加载提示。
    try {
      wx.hideLoading();
    } catch (e) {
      /* 忽略 */
    }
    // 「添加到桌面」转化埋点：scene 1023 表示用户从桌面图标打开。
    // 微信不提供「是否添加成功」的监听能力，这是唯一的可观测信号，设置页据此展示统计。
    try {
      addToDesktop.trackEnter();
    } catch (e) {
      /* 埋点失败绝不影响启动 */
    }
    // 回到前台：先恢复调度器（切后台时被停掉），再立即补查一次
    scheduler.startScheduler();
    alertScheduler.startAlertScheduler();
    // 兜底：后台挂起期间到期的提醒。两个函数内部都有 try/catch，
    // 这里再包一层 catch 只是防止未来改动把异常抛到全局变成 unhandled rejection
    Promise.resolve(scheduler.checkNow()).catch(() => {});
    Promise.resolve(alertScheduler.sweepNow()).catch(() => {});
  },

  onHide() {
    // 小程序切后台后 JS 线程会被挂起，定时器留着只是空转耗电；
    // 这里主动停掉，回到前台由 onShow 重启并立即补查一次
    scheduler.stopScheduler();
    alertScheduler.stopAlertScheduler();
  },

  onError(msg) {
    if (SDK_NOISE.test(String(msg))) return;
    // 补上「出错时在哪个页面」：像 Component is not found in path "wx://not-found"
    // 这类报错只给组件名、不给页面上下文，没有页面栈就只能全项目猜。
    const where = currentPageRoute();
    console.error(`[app] 未捕获异常${where ? ' @ ' + where : ''}：`, msg);
    if (/not found/i.test(String(msg))) {
      console.error(
        '[app] 排查提示：该页面（或其子组件）json 的 usingComponents 里有组件没能注册成功。' +
        '常见原因是组件 .ts 在加载时抛错、或它依赖的模块加载失败——请往上翻，' +
        '找本条错误【之前】的第一条报错，那才是真正的根因。'
      );
    }
  }
});
