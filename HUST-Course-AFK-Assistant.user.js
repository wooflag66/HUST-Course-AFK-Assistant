// ==UserScript==
// @name         华科课程平台视频挂机助手
// @namespace    http://tampermonkey.net/
// @version      6.1.1
// @description  基于 iframe 递归穿透技术的自动化挂机助手。支持 2 倍速播放、自动跳转、防后台休眠及换源自动重置。
// @author       Wangqi
// @match        *://smartcourse.hust.edu.cn/*
// @match        *://*.chaoxing.com/*
// @match        *://*.edu.cn/*
// @all_frames   true
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // 默认倍速：2.0 课程平台服务端校验的上限安全阈值
    const TARGET_SPEED = 2.0;

    // ============================================================
    // 1. 核心巡逻逻辑：递归穿透所有嵌套层级的 Iframe
    // ============================================================
    function patrolVideos(doc) {
        if (!doc) return;

        doc.querySelectorAll('video').forEach(video => {
            // 【换源检测】当视频地址改变时，重置“已完结”状态标记
            if (video._lastSrc !== video.currentSrc) {
                video._lastSrc = video.currentSrc;
                video.hasNotifiedEnd = false;
            }

            // 如果该视频已经处理完并通知跳转，则不再介入
            if (video.hasNotifiedEnd) return;

            // 基础状态锁定：强制静音、维持目标倍速
            if (!video.muted) video.muted = true;
            if (video.playbackRate !== TARGET_SPEED) video.playbackRate = TARGET_SPEED;

            // 【完结判定】提前 1.5 秒介入，防止卡在最后一帧触发平台的防刷 Bug
            if (video.ended || (video.duration > 0 && video.currentTime >= video.duration - 1.5)) {
                video.hasNotifiedEnd = true;
                video.pause(); // 拦截自动重播
                console.log('【助手日志】当前视频已完结，3秒后请求下一节跳转...');

                // 通过 postMessage 实现跨域层级的消息传递，通知顶层窗口执行跳转
                setTimeout(() => {
                    window.top.postMessage('go_to_next_lesson', '*');
                }, 3000);
            } else if (video.paused) {
                // 【自动化抗干扰】自动恢复因弹窗或切换后台导致的意外暂停
                const p = video.play();
                if (p) p.catch(() => {
                    // 捕获浏览器自动播放限制引发的报错
                });
            }
        });
    }

    // 每 1.5 秒进行一次全层级巡逻
    setInterval(() => {
        // 扫描当前顶层 DOM
        patrolVideos(document);

        // 递归扫描第一层嵌套 Iframe
        document.querySelectorAll('iframe').forEach(f => {
            try {
                patrolVideos(f.contentDocument);
                // 递归扫描第二层嵌套 Iframe (超星系统常见结构)
                f.contentDocument.querySelectorAll('iframe').forEach(f2 => {
                    try { patrolVideos(f2.contentDocument); } catch (e) { }
                });
            } catch (e) { }
        });
    }, 1500);

    // ============================================================
    // 2. 顶层指挥逻辑：处理跨域跳转及防挂机检测
    // ============================================================
    if (window === window.top) {

        // 【可见性欺骗】拦截浏览器的标签页休眠/节流机制，确保切到后台脚本依然全速运行
        try {
            Object.defineProperty(document, 'hidden', { get: () => false });
            Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
            document.addEventListener('visibilitychange', e => e.stopImmediatePropagation(), true);
        } catch (e) { }

        // 监听来自各层级内应的“完结信号”
        window.addEventListener('message', function (event) {
            if (event.data === 'go_to_next_lesson') {
                executeJump();
            }
        });

        /**
         * 基于目录索引的“降维打击”跳转：
         * 不依赖易崩溃的 UI 按钮点击，而是根据目录结构直接更新 URL
         */
        function executeJump() {
            if (window.isJumpingNow) return;
            window.isJumpingNow = true;

            try {
                const url = new URL(location.href);
                const currentId = url.searchParams.get('chapterId');

                if (!currentId) {
                    console.warn('【助手警告】无法在 URL 中定位 chapterId');
                    window.isJumpingNow = false;
                    return;
                }

                // 在顶层及所有 Iframe 中搜集目录节点 ID
                let allNodes = [];
                const collectNodes = (doc) => {
                    const nodes = [...doc.querySelectorAll('[id^="cur"]')]
                        .filter(el => /^cur\d+$/.test(el.id));
                    if (nodes.length > allNodes.length) allNodes = nodes;
                };

                collectNodes(document);
                document.querySelectorAll('iframe').forEach(f => {
                    try { collectNodes(f.contentDocument); } catch (e) { }
                });

                const idList = allNodes.map(el => el.id.replace('cur', ''));
                const curIdx = idList.indexOf(currentId);

                if (curIdx !== -1 && curIdx + 1 < idList.length) {
                    const nextId = idList[curIdx + 1];
                    url.searchParams.set('chapterId', nextId);
                    console.log(`【助手跳转】检测到进度完成：第 ${curIdx + 1} 节 → 第 ${curIdx + 2} 节`);

                    // 使用 replace 替换历史记录，防止按后退键时产生死循环
                    location.replace(url.toString());
                } else {
                    console.log('【助手通知】已到达本门课程最后一节 🎉');
                    alert('🎉 恭喜！当前课程视频已全部挂机完成！');
                    window.isJumpingNow = false;
                }

            } catch (e) {
                console.error('【助手报错】跳转执行异常:', e);
                window.isJumpingNow = false;
            }
        }

        // 绘制 UI 状态常驻角标
        const t = setInterval(() => {
            if (!document.body) return;
            clearInterval(t);
            if (document.getElementById('hust-badge')) return;

            const badge = document.createElement('div');
            badge.id = 'hust-badge';
            badge.style.cssText = `
                position:fixed; bottom:30px; right:30px; z-index:2147483647;
                padding:12px 24px; background:rgba(0,51,102,0.92); color:#fff;
                border-radius:25px; font-size:14px; font-weight:bold;
                pointer-events:none; box-shadow:0 6px 20px rgba(0,0,0,0.4);
                border:1px solid rgba(255,255,255,0.25); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            `;
            badge.textContent = `🚀 挂机运行中 (${TARGET_SPEED}x)`;
            document.body.appendChild(badge);
        }, 1000);
    }

})();