/**
 * Clash管理UI模块
 * 处理Clash节点切换相关的UI功能
 */

const { ipcRenderer } = require('electron');
const { logger } = require('../console.js');

// 当前Clash状态
let clashState = {
    currentUid: null,
    currentNode: null,
    profiles: [],
    nodes: [],
    tunMode: false,
    systemProxy: false
};

let selectedClashNode = null;

function emitClashStateUpdated(source = 'unknown') {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') {
        return;
    }

    window.dispatchEvent(new CustomEvent('clash-state-updated', {
        detail: {
            source,
            currentUid: clashState.currentUid,
            currentNode: clashState.currentNode,
            profiles: Array.isArray(clashState.profiles) ? [...clashState.profiles] : [],
            nodes: Array.isArray(clashState.nodes) ? [...clashState.nodes] : [],
            tunMode: clashState.tunMode,
            systemProxy: clashState.systemProxy
        }
    }));
}

/**
 * 初始化Clash管理器
 */
async function initClashManager(refreshClashStatusFn, elements, logger) {
    try {
        await refreshClashStatusFn();
    } catch (error) {
        console.warn('Clash管理器初始化失败:', error.message);
    }
}

/**
 * 刷新Clash状态
 */
async function refreshClashStatus(elements, showClashErrorFn, updateClashProfileSelectFn, loadClashProfileNodesFn, logger) {
    if (!elements || !logger) return;

    try {
        const result = await ipcRenderer.invoke('clash-get-status');

        if (result.success) {
            const data = result.data;
            clashState.currentUid = data.currentUid;
            clashState.currentNode = data.currentNode;
            clashState.profiles = data.profiles;
            clashState.tunMode = data.tunMode || false;
            clashState.systemProxy = data.systemProxy || false;

            // 更新当前状态显示
            if (elements.clashStatus) {
                elements.clashStatus.style.display = '';
            }
            if (elements.clashCurrentProfileName) {
                elements.clashCurrentProfileName.textContent = data.currentProfileName || '-';
            }
            if (elements.clashCurrentNodeName) {
                elements.clashCurrentNodeName.textContent = data.currentNode || '-';
            }
            
            // 更新系统代理开关
            if (elements.clashSystemProxy) {
                elements.clashSystemProxy.checked = clashState.systemProxy;
            }
            
            // 更新TUN模式开关
            if (elements.clashTunMode) {
                elements.clashTunMode.checked = clashState.tunMode;
            }

            // 更新订阅下拉框
            updateClashProfileSelectFn(data.profiles, data.currentUid, elements);

            // 如果有当前订阅，加载其节点
            if (data.currentUid) {
                await loadClashProfileNodesFn(data.currentUid, elements, refreshClashStatusFn => {
                    // 内部调用需要传递正确的函数引用
                });
            }

            emitClashStateUpdated('refresh');
            logger.info(`Clash状态已刷新 - 订阅: ${data.currentProfileName}, 节点: ${data.currentNode || '未选择'}`);
        } else {
            showClashErrorFn(result.error || 'Clash Verge Rev未安装或配置不存在', elements);
        }
    } catch (error) {
        logger.error(`刷新Clash状态失败: ${error.message}`);
        showClashErrorFn(error.message, elements);
    }
}

/**
 * 显示Clash错误状态
 */
function showClashError(message, elements) {
    if (elements.clashStatus) {
        elements.clashStatus.style.display = 'none';
    }

    if (elements.clashProfileSelect) {
        elements.clashProfileSelect.innerHTML = '<option value="">Clash未配置</option>';
        elements.clashProfileSelect.disabled = true;
    }

    if (elements.clashNodesList) {
        elements.clashNodesList.innerHTML = `<div class="clash-error">${message}</div>`;
    }

    if (elements.clashSwitchNodeBtn) {
        elements.clashSwitchNodeBtn.disabled = true;
    }
}

/**
 * 更新订阅下拉框
 */
function updateClashProfileSelect(profiles, currentUid, elements) {
    if (!elements.clashProfileSelect) return;

    let html = '';

    if (profiles && profiles.length > 0) {
        html = '<option value="">请选择订阅</option>';
        for (const profile of profiles) {
            const isSelected = profile.uid === currentUid ? 'selected' : '';
            html += `<option value="${profile.uid}" ${isSelected}>${profile.name}</option>`;
        }
    } else {
        html = '<option value="">未找到订阅</option>';
    }

    elements.clashProfileSelect.innerHTML = html;
    elements.clashProfileSelect.disabled = false;
}

/**
 * 当选择订阅变化时
 */
async function onClashProfileChanged(elements, switchClashProfileFn) {
    const selectedUid = elements.clashProfileSelect.value;

    if (!selectedUid) {
        if (elements.clashNodesList) {
            elements.clashNodesList.innerHTML = '<div class="clash-nodes-empty">请先选择订阅</div>';
        }
        if (elements.clashSwitchNodeBtn) {
            elements.clashSwitchNodeBtn.disabled = true;
        }
        clashState.currentUid = null;
        clashState.nodes = [];
        return;
    }

    await switchClashProfileFn(selectedUid, elements);
}

/**
 * 切换订阅
 */
async function switchClashProfile(uid, elements, renderClashNodesFn, loadClashProfileNodesFn) {
    try {
        const nodesResult = await ipcRenderer.invoke('clash-get-profile-nodes', uid);

            if (nodesResult.success) {
            clashState.nodes = nodesResult.nodes;
            clashState.currentUid = uid;

            renderClashNodesFn(nodesResult.nodes, clashState.currentNode, elements);

            if (elements.clashCurrentProfileName) {
                elements.clashCurrentProfileName.textContent = nodesResult.profileName || '-';
            }

            emitClashStateUpdated('switch-profile');
            logger.info(`已加载订阅 "${nodesResult.profileName}" 的 ${nodesResult.nodes.length} 个节点`);
        } else {
            const switchResult = await ipcRenderer.invoke('clash-switch-profile', uid);
            if (switchResult.success) {
                clashState.currentUid = uid;
                clashState.currentNode = switchResult.data.currentNode;

                if (elements.clashCurrentProfileName) {
                    elements.clashCurrentProfileName.textContent = switchResult.data.profileName;
                }
                if (elements.clashCurrentNodeName) {
                    elements.clashCurrentNodeName.textContent = switchResult.data.currentNode || '-';
                }

                await loadClashProfileNodesFn(uid, elements);
                emitClashStateUpdated('switch-profile');
            } else {
                throw new Error(switchResult.error || '切换订阅失败');
            }
        }
    } catch (error) {
        logger.error(`切换订阅失败: ${error.message}`);
    }
}

/**
 * 加载指定订阅的节点
 */
async function loadClashProfileNodes(uid, elements, refreshClashStatusFn) {
    try {
        if (elements.clashNodesList) {
            elements.clashNodesList.innerHTML = '<div class="clash-nodes-loading">加载节点中...</div>';
        }
        
        // 禁用操作按钮
        if (elements.clashSwitchNodeBtn) elements.clashSwitchNodeBtn.disabled = true;
        if (elements.clashTestLatencyBtn) elements.clashTestLatencyBtn.disabled = true;
        if (elements.clashTestAllLatencyBtn) elements.clashTestAllLatencyBtn.disabled = true;

        const result = await ipcRenderer.invoke('clash-get-profile-nodes', uid);

        if (result.success) {
            clashState.nodes = result.nodes;

            const statusResult = await ipcRenderer.invoke('clash-get-status');
            if (statusResult.success) {
                clashState.currentNode = statusResult.data.currentNode;
                if (elements.clashCurrentNodeName) {
                    elements.clashCurrentNodeName.textContent = statusResult.data.currentNode || '-';
                }
            }

            renderClashNodes(result.nodes, clashState.currentNode, elements);
            emitClashStateUpdated('load-nodes');
        } else {
            if (elements.clashNodesList) {
                elements.clashNodesList.innerHTML = `<div class="clash-nodes-empty">${result.error || '加载节点失败'}</div>`;
            }
        }
    } catch (error) {
        logger.error(`加载节点失败: ${error.message}`);
        if (elements.clashNodesList) {
            elements.clashNodesList.innerHTML = `<div class="clash-nodes-empty">加载失败: ${error.message}</div>`;
        }
    }
}

/**
 * 渲染节点列表
 */
function renderClashNodes(nodes, currentNode, elements) {
    if (!elements.clashNodesList) return;

    let html = '';

    if (nodes && nodes.length > 0) {
        html = '<div class="clash-nodes-container">';
        for (const node of nodes) {
            const isCurrent = node === currentNode;
            const isSelected = node === selectedClashNode;
            html += `
                <div class="clash-node-item ${isSelected ? 'selected' : ''} ${isCurrent ? 'current' : ''}"
                     data-node-name="${escapeHtml(node)}"
                     onclick="window.selectClashNodeGlobal(this.dataset.nodeName)">
                    <input type="radio" name="clash-node" class="clash-node-radio"
                           value="${escapeHtml(node)}" ${isSelected ? 'checked' : ''}>
                    <span class="clash-node-name" title="${escapeHtml(node)}">${escapeHtml(node)}</span>
                    ${isCurrent ? '<span class="clash-node-badge">当前</span>' : ''}
                </div>
            `;
        }
        html += '</div>';
    } else {
        html = '<div class="clash-nodes-empty">该订阅暂无节点</div>';
    }

    elements.clashNodesList.innerHTML = html;

    if (elements.clashSwitchNodeBtn) {
        elements.clashSwitchNodeBtn.disabled = false;
    }
    
    // 启用"测试全部"按钮
    if (elements.clashTestAllLatencyBtn) {
        elements.clashTestAllLatencyBtn.disabled = false;
    }
}

/**
 * 选择节点
 */
function selectClashNode(nodeName, elements) {
    selectedClashNode = nodeName;

    document.querySelectorAll('.clash-node-item').forEach(item => {
        item.classList.remove('selected');
        const radio = item.querySelector('.clash-node-radio');
        if (radio && radio.value === nodeName) {
            item.classList.add('selected');
            radio.checked = true;
        }
    });

    logger.info(`已选择节点: ${nodeName}`);

    // 启用"测试选中"按钮
    if (elements.clashTestLatencyBtn) {
        elements.clashTestLatencyBtn.disabled = false;
    }
}

/**
 * 切换节点
 */
async function switchClashNode(elements, showMessage, renderClashNodesFn, logger) {
    const profileUid = elements.clashProfileSelect?.value;
    const nodeName = selectedClashNode;

    if (!profileUid) {
        showMessage('请先选择订阅', 'warning', elements);
        return;
    }

    if (!nodeName) {
        showMessage('请先选择要切换的节点', 'warning', elements);
        return;
    }

    try {
        if (elements.clashSwitchNodeBtn) {
            elements.clashSwitchNodeBtn.disabled = true;
            elements.clashSwitchNodeBtn.textContent = '切换中...';
        }

        const result = await ipcRenderer.invoke('clash-switch-node', profileUid, nodeName);

        if (result.success) {
            clashState.currentNode = nodeName;

            if (elements.clashCurrentNodeName) {
                elements.clashCurrentNodeName.textContent = nodeName;
            }

            renderClashNodesFn(clashState.nodes, nodeName, elements);
            emitClashStateUpdated('switch-node');

            logger.info(`节点切换成功: ${result.data.profileName} - ${nodeName}`);
            showMessage(`节点切换成功!\n订阅: ${result.data.profileName}\n新节点: ${nodeName}`, 'success', elements);
        } else {
            throw new Error(result.error || '切换节点失败');
        }
    } catch (error) {
        logger.error(`切换节点失败: ${error.message}`);
        showMessage(`切换节点失败: ${error.message}`, 'error', elements);
    } finally {
        if (elements.clashSwitchNodeBtn) {
            elements.clashSwitchNodeBtn.disabled = false;
            elements.clashSwitchNodeBtn.textContent = '切换节点';
        }
    }
}

/**
 * 测试节点延迟
 */
async function testNodeLatency(elements, showMessage, logger) {
    const nodeName = selectedClashNode;
    
    if (!nodeName) {
        showMessage('请先选择要测试的节点', 'warning', elements);
        return;
    }
    
    const btn = document.getElementById('clash-test-latency-btn');
    const originalText = btn ? btn.textContent : '测试延迟';
    
    try {
        if (btn) {
            btn.disabled = true;
            btn.textContent = '测试中...';
        }
        
        const result = await ipcRenderer.invoke('clash-test-latency', nodeName);
        
        if (result.success) {
            const delay = result.delay;
            let msgType = 'success';
            if (delay > 1000) msgType = 'warning';
            
            logger.info(`节点 "${nodeName}" 延迟: ${delay}ms`);
            showMessage(`节点: ${nodeName}\n延迟: ${delay}ms`, msgType, elements);
            
            // 更新节点列表中的延迟显示
            updateNodeLatencyDisplay(nodeName, delay);
        } else {
            throw new Error(result.error || '测试失败');
        }
    } catch (error) {
        logger.error(`测试节点延迟失败: ${error.message}`);
        showMessage(`测试延迟失败: ${error.message}`, 'error', elements);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }
}

/**
 * 测试所有节点延迟
 */
async function testAllNodesLatency(elements, showMessage, logger) {
    if (!clashState.nodes || clashState.nodes.length === 0) {
        showMessage('没有可用的节点', 'warning', elements);
        return;
    }

    const btn = document.getElementById('clash-test-all-latency-btn');
    const originalText = btn ? btn.textContent : '测试全部';
    
    try {
        if (btn) {
            btn.disabled = true;
            btn.textContent = '测试中...';
        }
        
        logger.info(`开始测试 ${clashState.nodes.length} 个节点的延迟...`);
        
        // 并发控制，每次5个
        const concurrency = 5;
        const nodes = [...clashState.nodes];
        let completed = 0;
        
        for (let i = 0; i < nodes.length; i += concurrency) {
            const batch = nodes.slice(i, i + concurrency);
            const promises = batch.map(async (nodeName) => {
                try {
                    // 显示加载状态
                    updateNodeLatencyDisplay(nodeName, '...', '#999');
                    
                    const result = await ipcRenderer.invoke('clash-test-latency', nodeName);
                    if (result.success) {
                        updateNodeLatencyDisplay(nodeName, result.delay);
                    } else {
                        updateNodeLatencyDisplay(nodeName, '超时', '#ff4d4f');
                    }
                } catch (e) {
                    updateNodeLatencyDisplay(nodeName, '错误', '#ff4d4f');
                } finally {
                    completed++;
                }
            });
            
            await Promise.all(promises);
            
            // 更新按钮进度
            if (btn) {
                btn.textContent = `测试中 (${completed}/${nodes.length})`;
            }
        }
        
        logger.info('所有节点延迟测试完成');
        showMessage('所有节点延迟测试完成', 'success', elements);
        
    } catch (error) {
        logger.error(`批量测试延迟失败: ${error.message}`);
        showMessage(`批量测试失败: ${error.message}`, 'error', elements);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }
}

/**
 * 更新节点延迟显示
 */
function updateNodeLatencyDisplay(nodeName, delay, colorOverride = null) {
    const items = document.querySelectorAll('.clash-node-item');
    items.forEach(item => {
        const nameSpan = item.querySelector('.clash-node-name');
        if (nameSpan && nameSpan.textContent === nodeName) {
            let badge = item.querySelector('.clash-node-latency');
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'clash-node-latency';
                badge.style.marginLeft = '8px';
                badge.style.fontSize = '12px';
                item.appendChild(badge);
            }
            
            if (typeof delay === 'number') {
                badge.textContent = `${delay}ms`;
                if (colorOverride) {
                    badge.style.color = colorOverride;
                } else {
                    if (delay < 500) badge.style.color = '#52c41a';
                    else if (delay < 1000) badge.style.color = '#faad14';
                    else badge.style.color = '#ff4d4f';
                }
            } else {
                badge.textContent = delay;
                if (colorOverride) badge.style.color = colorOverride;
            }
        }
    });
}

/**
 * 切换系统代理
 */
async function toggleSystemProxy(enable, elements, showMessage, logger) {
    try {
        if (elements.clashSystemProxy) {
            elements.clashSystemProxy.disabled = true;
        }

        const result = await ipcRenderer.invoke('clash-set-system-proxy', enable);
        
        if (result.success) {
            clashState.systemProxy = enable;
            logger.info(`系统代理已${enable ? '开启' : '关闭'}`);
            showMessage(`系统代理已${enable ? '开启' : '关闭'}`, 'success', elements);
            emitClashStateUpdated('toggle-system-proxy');
        } else {
            // 恢复开关状态
            if (elements.clashSystemProxy) {
                elements.clashSystemProxy.checked = !enable;
            }
            throw new Error(result.error || '设置系统代理失败');
        }
    } catch (error) {
        logger.error(`设置系统代理失败: ${error.message}`);
        showMessage(`设置系统代理失败: ${error.message}`, 'error', elements);
        // 恢复开关状态
        if (elements.clashSystemProxy) {
            elements.clashSystemProxy.checked = !enable;
        }
    } finally {
        if (elements.clashSystemProxy) {
            elements.clashSystemProxy.disabled = false;
        }
    }
}

/**
 * 切换TUN模式
 */
async function toggleTunMode(enable, elements, showMessage, logger) {
    try {
        if (elements.clashTunMode) {
            elements.clashTunMode.disabled = true;
        }

        const result = await ipcRenderer.invoke('clash-set-tun-mode', enable);
        
        if (result.success) {
            clashState.tunMode = enable;
            logger.info(`TUN模式已${enable ? '开启' : '关闭'}`);
            showMessage(`TUN模式已${enable ? '开启' : '关闭'}`, 'success', elements);
            emitClashStateUpdated('toggle-tun-mode');
        } else {
            // 恢复开关状态
            if (elements.clashTunMode) {
                elements.clashTunMode.checked = !enable;
            }
            throw new Error(result.error || '设置TUN模式失败');
        }
    } catch (error) {
        logger.error(`设置TUN模式失败: ${error.message}`);
        showMessage(`设置TUN模式失败: ${error.message}`, 'error', elements);
        // 恢复开关状态
        if (elements.clashTunMode) {
            elements.clashTunMode.checked = !enable;
        }
    } finally {
        if (elements.clashTunMode) {
            elements.clashTunMode.disabled = false;
        }
    }
}

/**
 * 检查 Clash 进程是否运行
 */
async function checkClashProcess(elements, logger) {
    if (!elements || !logger) return false;
    
    try {
        const result = await ipcRenderer.invoke('check-clash-process');
        
        if (result.success && result.isRunning) {
            // 正在运行
            if (elements.clashProfileSelect) elements.clashProfileSelect.disabled = false;
            
            // 启用其他控件
            if (elements.clashSystemProxy) elements.clashSystemProxy.disabled = false;
            if (elements.clashTunMode) elements.clashTunMode.disabled = false;
            
            return true;
        } else {
            // 未运行
            if (elements.clashProfileSelect) elements.clashProfileSelect.disabled = true;
            
            // 禁用其他控件
            if (elements.clashSystemProxy) elements.clashSystemProxy.disabled = true;
            if (elements.clashTunMode) elements.clashTunMode.disabled = true;
            
            // 清空状态显示
            const profileName = document.getElementById('clash-current-profile-name');
            const nodeName = document.getElementById('clash-current-node-name');
            if (profileName) profileName.textContent = '-';
            if (nodeName) nodeName.textContent = '-';
            
            logger.info('Clash Verge Rev 未运行，请先确认其已启动');
            return false;
        }
    } catch (error) {
        logger.error(`检查 Clash 进程失败: ${error.message}`);
        return false;
    }
}

/**
 * HTML转义
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 获取Clash状态
 */
function getClashState() {
    return clashState;
}

/**
 * 获取选中的节点
 */
function getSelectedClashNode() {
    return selectedClashNode;
}

// 导出模块
module.exports = {
    initClashManager,
    refreshClashStatus,
    showClashError,
    updateClashProfileSelect,
    onClashProfileChanged,
    switchClashProfile,
    loadClashProfileNodes,
    renderClashNodes,
    selectClashNode,
    switchClashNode,
    testNodeLatency,
    testAllNodesLatency,
    toggleSystemProxy,
    toggleTunMode,
    escapeHtml,
    getClashState,
    getSelectedClashNode,
    checkClashProcess
};
