/* ==================================================================
   安卓桥：把桌面版 pywebview 的 window.pywebview.api 语义搬到 WebView。
   前端 30-boot.js 只认 window.pywebview.api，所以这里用一个 Proxy 兜住
   所有方法名，调用后交给原生层转发给 Python，再把结果 resolve 回 Promise。
   ================================================================== */

(function () {
  'use strict';

  const native = window.AndroidBridge;
  const pending = new Map();
  let seq = 0;

  // 由原生层 evaluateJavascript 回调（必须挂在 window 上）
  window.__ledgerBridgeResolve = function (id, payload) {
    const item = pending.get(id);
    if (!item) return;
    pending.delete(id);
    try {
      item.resolve(JSON.parse(payload));
    } catch (err) {
      item.reject(new Error('后台返回的内容无法解析'));
    }
  };

  function invoke(method, args) {
    return new Promise(function (resolve, reject) {
      if (!native) {
        reject(new Error('原生桥接不可用，请重新安装应用'));
        return;
      }
      const id = 'req' + (++seq);
      pending.set(id, { resolve: resolve, reject: reject });
      try {
        native.request(id, method, JSON.stringify(args || []));
      } catch (err) {
        pending.delete(id);
        reject(err);
        return;
      }
      // AI 请求可能跑上一两分钟，这里给足时间；真到了说明后台卡住
      setTimeout(function () {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error('后台响应超时'));
        }
      }, 600000);
    });
  }

  // 导出 CSV：Python 先写进应用私有目录，再让原生层复制到系统「下载」目录
  function exportCsv() {
    const args = Array.prototype.slice.call(arguments);
    return invoke('export_csv', args).then(function (res) {
      if (res && res.ok && res.data && res.data.path && native
          && typeof native.saveToDownloads === 'function') {
        try {
          const saved = native.saveToDownloads(res.data.path, '');
          if (saved) {
            res.data.android_saved = true;
            res.data.app_path = res.data.path;
            res.data.path = saved;
          }
        } catch (err) {
          // 复制失败时保留原路径，前端仍会提示
        }
      }
      return res;
    });
  }

  // 安卓上没有「资源管理器」，改成导出一份数据库快照到「下载」目录
  function openDataFolder() {
    try {
      if (native && typeof native.exportDatabase === 'function') {
        native.exportDatabase();
      }
    } catch (err) {
      // 忽略：下面仍会返回真实数据目录
    }
    return invoke('open_data_folder', []);
  }

  const api = new Proxy({}, {
    get: function (target, prop) {
      if (typeof prop !== 'string' || prop === 'then' || prop === 'toJSON') {
        return undefined;
      }
      if (prop === 'export_csv') return exportCsv;
      if (prop === 'open_data_folder') return openDataFolder;
      return function () {
        return invoke(prop, Array.prototype.slice.call(arguments));
      };
    },
  });

  window.pywebview = { api: api, android: true };
  window.__ledgerAndroid = true;
  // 桌面版等的是这个事件，这里直接具备桥接能力，再补一次广播
  window.dispatchEvent(new Event('pywebviewready'));
})();
