/**
 * Cookie管理模块
 * 处理Cookie的加载、渲染、分页、积分分布等功能
 */

const { ipcRenderer } = require('electron');
const { logger } = require('../console.js');

// 全局状态
let currentCookieTab = null;
const cookieTestActionState = new Map();

// 分页配置
const COOKIES_PER_PAGE = 20;
let cookiePaginationState = {};

let cookieSelectionState = {
    selectedKeys: new Set(),
    allCookies: [],
    cookieMap: new Map()
};

function getCookieSelectionKey(cookie) {
    if (!cookie || typeof cookie !== 'object') {
        return '';
    }

    const cardName = cookie.card_name || '未分类';
    const aid = cookie.aid || cookie.id || '';
    const email = cookie.email || cookie.account || '';
    const fileName = cookie.fileName || cookie.name || '';
    return `${cardName}::${aid}::${email}::${fileName}`;
}

function getCookieTestActionKey(cookie) {
    return getCookieSelectionKey(cookie);
}

function syncCookieTestActionState(cookies = []) {
    const validKeys = new Set((Array.isArray(cookies) ? cookies : []).map(cookie => getCookieTestActionKey(cookie)).filter(Boolean));
    for (const key of cookieTestActionState.keys()) {
        if (!validKeys.has(key)) {
            cookieTestActionState.delete(key);
        }
    }
}

function setCookieTestActionState(cookieOrKey, state = {}) {
    const key = typeof cookieOrKey === 'string'
        ? String(cookieOrKey || '').trim()
        : getCookieTestActionKey(cookieOrKey);
    if (!key) {
        return false;
    }

    const normalizedState = {
        browserId: String(state.browserId || '').trim(),
        status: String(state.status || '').trim() || 'ready'
    };
    cookieTestActionState.set(key, normalizedState);
    return true;
}

function clearCookieTestActionState(cookieOrKey) {
    const key = typeof cookieOrKey === 'string'
        ? String(cookieOrKey || '').trim()
        : getCookieTestActionKey(cookieOrKey);
    if (!key) {
        return false;
    }

    cookieTestActionState.delete(key);
    return true;
}

function getCookieTestActionState(cookieOrKey) {
    const key = typeof cookieOrKey === 'string'
        ? String(cookieOrKey || '').trim()
        : getCookieTestActionKey(cookieOrKey);
    if (!key) {
        return null;
    }

    return cookieTestActionState.get(key) || null;
}

function getCookieTestActionLabel(cookie) {
    const state = getCookieTestActionState(cookie);
    if (!state) {
        return '测试账号';
    }

    if (state.status === 'busy') {
        return '刷新中...';
    }

    return '刷新';
}

function escapeHtmlAttribute(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function syncCookieSelectionState(cookies = []) {
    cookieSelectionState.allCookies = Array.isArray(cookies) ? cookies : [];
    cookieSelectionState.cookieMap = new Map();

    cookieSelectionState.allCookies.forEach(cookie => {
        const key = getCookieSelectionKey(cookie);
        if (key) {
            cookieSelectionState.cookieMap.set(key, cookie);
        }
    });

    const validKeys = new Set(cookieSelectionState.cookieMap.keys());
    cookieSelectionState.selectedKeys = new Set([...cookieSelectionState.selectedKeys].filter(key => validKeys.has(key)));
}

function getCookieSelectionSummary() {
    const total = cookieSelectionState.cookieMap.size;
    const selected = cookieSelectionState.selectedKeys.size;
    return {
        total,
        selected,
        allSelected: total > 0 && selected === total,
        hasSelection: selected > 0
    };
}

function emitCookieSelectionChanged() {
    if (typeof window !== 'undefined' && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('cookie-selection-changed', {
            detail: getCookieSelectionSummary()
        }));
    }
}

function refreshCookieSelectionClasses() {
    if (typeof document === 'undefined') {
        return;
    }

    document.querySelectorAll('tr[data-cookie-key]').forEach(row => {
        const key = row.dataset.cookieKey || '';
        const isSelected = cookieSelectionState.selectedKeys.has(key);
        row.classList.toggle('cookie-row-selected', isSelected);
        row.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    });
}

function setCookieSelected(cookie, selected = true) {
    const key = getCookieSelectionKey(cookie);
    if (!key) return false;

    if (selected) {
        cookieSelectionState.selectedKeys.add(key);
    } else {
        cookieSelectionState.selectedKeys.delete(key);
    }

    refreshCookieSelectionClasses();
    emitCookieSelectionChanged();
    return true;
}

function selectOnlyCookie(cookie) {
    const key = getCookieSelectionKey(cookie);
    if (!key) {
        return false;
    }

    cookieSelectionState.selectedKeys = new Set([key]);
    refreshCookieSelectionClasses();
    emitCookieSelectionChanged();
    return true;
}

function toggleCookieSelected(cookie) {
    const key = getCookieSelectionKey(cookie);
    if (!key) return false;

    if (cookieSelectionState.selectedKeys.has(key)) {
        cookieSelectionState.selectedKeys.delete(key);
    } else {
        cookieSelectionState.selectedKeys.add(key);
    }

    refreshCookieSelectionClasses();
    emitCookieSelectionChanged();
    return cookieSelectionState.selectedKeys.has(key);
}

function toggleCookiesSelectedInFolder(folderCookies = []) {
    const validCookies = Array.isArray(folderCookies)
        ? folderCookies.filter(cookie => getCookieSelectionKey(cookie))
        : [];

    if (!validCookies.length) {
        return false;
    }

    const allSelected = validCookies.every(cookie =>
        cookieSelectionState.selectedKeys.has(getCookieSelectionKey(cookie))
    );

    validCookies.forEach(cookie => {
        const key = getCookieSelectionKey(cookie);
        if (!key) return;

        if (allSelected) {
            cookieSelectionState.selectedKeys.delete(key);
        } else if (cookieSelectionState.selectedKeys.has(key)) {
            cookieSelectionState.selectedKeys.delete(key);
        } else {
            cookieSelectionState.selectedKeys.add(key);
        }
    });

    refreshCookieSelectionClasses();
    emitCookieSelectionChanged();
    return true;
}

function selectAllCookies() {
    cookieSelectionState.selectedKeys = new Set(cookieSelectionState.cookieMap.keys());
    refreshCookieSelectionClasses();
    emitCookieSelectionChanged();
}

function selectCurrentCookieTabCookies() {
    const currentCookies = getCurrentCookieTabCookies();
    const keys = currentCookies
        .map(cookie => getCookieSelectionKey(cookie))
        .filter(Boolean);

    cookieSelectionState.selectedKeys = new Set(keys);
    refreshCookieSelectionClasses();
    emitCookieSelectionChanged();
    return keys.length > 0;
}

function clearCookieSelection() {
    cookieSelectionState.selectedKeys.clear();
    refreshCookieSelectionClasses();
    emitCookieSelectionChanged();
}

function getSelectedCookies() {
    return cookieSelectionState.allCookies.filter(cookie => cookieSelectionState.selectedKeys.has(getCookieSelectionKey(cookie)));
}

function getCurrentCookieTabCookies() {
    if (!currentCookieTab) {
        return [];
    }

    return cookieSelectionState.allCookies.filter(cookie => (cookie.card_name || '未分类') === currentCookieTab);
}

function updatePointsDistributionSubtitle(cardName = currentCookieTab) {
    if (typeof document === 'undefined') {
        return;
    }

    const subtitle = document.getElementById('points-distribution-subtitle');
    if (!subtitle) {
        return;
    }

    subtitle.textContent = cardName
        ? `${cardName} 的积分分布`
        : '当前文件夹积分分布';
}

function refreshCurrentPointsDistribution(updatePointsDistributionFn = updatePointsDistribution) {
    updatePointsDistributionSubtitle(currentCookieTab);

    if (typeof updatePointsDistributionFn === 'function') {
        updatePointsDistributionFn('overview', getCurrentCookieTabCookies(), currentCookieTab);
    }
}

/**
 * 加载Cookie列表
 */
async function loadCookies() {
    try {
        const result = await ipcRenderer.invoke('load-cookies');
        if (result.success) {
            return result.cookies;
        } else {
            logger.error(`加载Cookie失败: ${result.error}`);
            return [];
        }
    } catch (error) {
        logger.error(`加载Cookie异常: ${error.message}`);
        return [];
    }
}

/**
 * 渲染Cookie标签页
 * @param {Array} cookies - Cookie数据数组
 * @param {Object} elements - DOM元素对象
 * @param {Function} createCardCookieTabFn - 创建卡片Cookie标签页的函数
 * @param {Function} switchCookieTabInternal - 切换标签页的内部函数
 * @param {string} testWithCardName - 测试时使用的卡片名称（可选，如果提供则所有Cookie使用此卡片配置测试）
 */
function renderCookieTabs(cookies, elements, createCardCookieTabFn, switchCookieTabInternal, testWithCardName = null) {
    syncCookieSelectionState(cookies);
    syncCookieTestActionState(cookies);

    // 按卡片名称分组Cookie
    const cardGroups = {};

    cookies.forEach(cookie => {
        const cardName = cookie.card_name || '未分类';
        if (!cardGroups[cardName]) {
            cardGroups[cardName] = [];
        }
        cardGroups[cardName].push(cookie);
    });

    // 清除现有的所有标签页
    elements.cookieTabHeaders.innerHTML = '';
    elements.cookieTabContents.innerHTML = '';

    // 为每个卡片创建标签页
    const cardNames = Object.keys(cardGroups);

    // 更新测试文件夹下拉框
    if (elements.cookieTestFolder) {
        const currentSelection = elements.cookieTestFolder.value;
        elements.cookieTestFolder.innerHTML = '';
        
        // 过滤出有Cookie的卡片
        const cardsWithCookies = cardNames.filter(cardName => cardGroups[cardName] && cardGroups[cardName].length > 0);

        if (cardsWithCookies.length === 0) {
             const option = document.createElement('option');
             option.value = "";
             option.textContent = "无可用文件夹";
             elements.cookieTestFolder.appendChild(option);
        } else {
            cardsWithCookies.forEach(cardName => {
                const option = document.createElement('option');
                option.value = cardName;
                option.textContent = cardName;
                elements.cookieTestFolder.appendChild(option);
            });

            // 尝试恢复之前的选择，如果之前选择的还在列表中
            if (currentSelection && cardsWithCookies.includes(currentSelection)) {
                elements.cookieTestFolder.value = currentSelection;
            } else if (cardsWithCookies.length > 0) {
                // 默认选择第一个
                elements.cookieTestFolder.value = cardsWithCookies[0];
            }
        }
        
        // 更新筛选下拉框的事件监听
        elements.cookieTestFolder.onchange = () => {
             updateFilterOptions(elements, cardGroups, elements.cookieTestFolder.value);
        };

        // 立即更新筛选选项
        updateFilterOptions(elements, cardGroups, elements.cookieTestFolder.value);
    }

    // 检查当前选中的卡片是否仍然存在
    const shouldKeepCurrentTab = currentCookieTab && cardNames.includes(currentCookieTab);

    cardNames.forEach((cardName, index) => {
        // 如果当前有选中的卡片且仍然存在，则保持其激活状态；否则第一个卡片激活
        const isActive = shouldKeepCurrentTab ? cardName === currentCookieTab : index === 0;
        createCardCookieTabFn(cardName, cardGroups[cardName], isActive, elements, updatePointsDistribution, testWithCardName);

        // 设置默认选中的Cookie标签页
        if (isActive) {
            currentCookieTab = cardName;
        }
    });

    // 如果当前选中的卡片不再存在，重置到第一个文件夹；如果没有文件夹则清空
    if (!shouldKeepCurrentTab && cardNames.length > 0) {
        currentCookieTab = cardNames[0];
    } else if (cardNames.length === 0) {
        currentCookieTab = null;
    }

    if (updatePointsDistribution) {
        refreshCurrentPointsDistribution(updatePointsDistribution);
    }
}

/**
 * 更新账号筛选选项
 * @param {Object} elements - DOM元素对象
 * @param {Object} cardGroups - 按卡片分组的Cookie数据
 * @param {string} selectedFolder - 当前选中的文件夹（卡片名称）
 */
function updateFilterOptions(elements, cardGroups, selectedFolder) {
    if (!elements.cookieTestFilter) return;

    const currentSelection = elements.cookieTestFilter.value;
    elements.cookieTestFilter.innerHTML = '<option value="all">所有账号</option>';

    if (!selectedFolder || !cardGroups[selectedFolder]) {
        return;
    }

    const cookies = cardGroups[selectedFolder];
    const pointsSet = new Set();
    let hasUnknown = false;

    cookies.forEach(cookie => {
        if (cookie.points === null || 
            cookie.points === undefined || 
            cookie.points === 'null' || 
            cookie.points === '' || 
            isNaN(parseInt(cookie.points, 10))) {
            hasUnknown = true;
        } else {
            pointsSet.add(parseInt(cookie.points, 10));
        }
    });

    // 排序积分
    const sortedPoints = Array.from(pointsSet).sort((a, b) => a - b);

    // 添加积分选项
    sortedPoints.forEach(points => {
        const option = document.createElement('option');
        option.value = `points_${points}`;
        option.textContent = `积分 ${points}`;
        elements.cookieTestFilter.appendChild(option);
    });

    // 添加未知积分选项
    if (hasUnknown) {
        const option = document.createElement('option');
        option.value = 'points_unknown';
        option.textContent = '未知积分';
        elements.cookieTestFilter.appendChild(option);
    }

    // 尝试恢复之前的选择
    if (currentSelection && Array.from(elements.cookieTestFilter.options).some(opt => opt.value === currentSelection)) {
        elements.cookieTestFilter.value = currentSelection;
    }
}

/**
 * 创建单个卡片的Cookie标签页
 * @param {string} cardName - 卡片名称（用于标识这个标签页）
 * @param {Array} cardCookies - 该卡片的Cookie数据
 * @param {boolean} isActive - 是否激活
 * @param {Object} elements - DOM元素对象
 * @param {Function} updatePointsDistributionFn - 更新积分分布的回调函数
 * @param {string} testWithCardName - 测试时使用的卡片名称（可选，如果提供则所有Cookie使用此卡片配置测试）
 */
function createCardCookieTab(cardName, cardCookies, isActive, elements, updatePointsDistributionFn, testWithCardName = null) {
    // 初始化分页状态
    cookiePaginationState[cardName] = {
        currentPage: 1,
        totalPages: Math.ceil(cardCookies.length / COOKIES_PER_PAGE),
        totalCount: cardCookies.length
    };

    // 创建标签页头部
    const tabHeader = document.createElement('button');
    tabHeader.className = `cookie-tab-header${isActive ? ' active' : ''}`;
    tabHeader.dataset.tab = `cookie-tab-${cardName}`;
    tabHeader.textContent = cardName.length > 10 ? cardName.substring(0, 10) + '...' : cardName;
    tabHeader.title = cardName;
    tabHeader.title = `${cardName} · 双击反选此文件夹内账号`;
    tabHeader.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        switchCookieTab(`cookie-tab-${cardName}`);
    });
    tabHeader.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleCookiesSelectedInFolder(cardCookies);
    });
    elements.cookieTabHeaders.appendChild(tabHeader);

    // 创建标签页内容
    const tabContent = document.createElement('div');
    tabContent.id = `cookie-tab-${cardName}`;
    tabContent.className = `cookie-tab-content${isActive ? ' active' : ''}`;

    tabContent.innerHTML = `
        <div class="cookie-table-container">
            <table class="cookie-table" id="cookie-table-${cardName}">
                <thead>
                    <tr>
                        <th class="email-column">邮箱</th>
                        <th>积分</th>
                        <th>创建时间</th>
                        <th>测试</th>
                    </tr>
                </thead>
                <tbody id="cookie-table-body-${cardName}">
                </tbody>
            </table>
        </div>
        <div class="cookie-pagination" id="cookie-pagination-${cardName}">
            <div class="cookie-pagination-row">
                <button class="pagination-btn" id="pagination-first-${cardName}" title="首页">首页</button>
                <button class="pagination-btn" id="pagination-prev-${cardName}" title="上一页">上一页</button>
                <span class="pagination-page-info" id="pagination-page-${cardName}"></span>
                <button class="pagination-btn" id="pagination-next-${cardName}" title="下一页">下一页</button>
                <button class="pagination-btn" id="pagination-last-${cardName}" title="末页">末页</button>
            </div>
            <div class="cookie-pagination-row">
                <span class="pagination-info" id="pagination-info-${cardName}"></span>
                <select class="pagination-jump" id="pagination-jump-${cardName}" title="跳转到指定页"></select>
            </div>
        </div>
    `;

    elements.cookieTabContents.appendChild(tabContent);

    // 渲染该卡片的Cookie表格，传入测试用卡片名称
    renderPaginatedCookieTable(cardName, cardCookies, elements, testWithCardName);

    // 绑定分页事件
    bindPaginationEvents(cardName, cardCookies, elements);
}

/**
 * 渲染Cookie表格
 * @param {HTMLElement} tableBody - 表格tbody元素
 * @param {Array} cookies - Cookie数据数组
 * @param {string} cardName - 当前卡片名称
 * @param {boolean} isOverview - 是否为概览模式
 * @param {string} testWithCardName - 测试时使用的卡片名称（可选，如果提供则所有Cookie使用此卡片配置测试）
 */
function renderCookieTable(tableBody, cookies, cardName, isOverview = false, testWithCardName = null) {
    tableBody.innerHTML = '';

    if (cookies.length === 0) {
        const colspan = isOverview ? '5' : '4';
        const emptyRow = document.createElement('tr');
        emptyRow.className = 'cookie-table-empty-row';
        emptyRow.innerHTML = `<td colspan="${colspan}" class="cookie-table-empty">暂无Cookie数据</td>`;
        tableBody.appendChild(emptyRow);
        return;
    }

    cookies.forEach(cookie => {
        const row = document.createElement('tr');
        const cookieKey = getCookieSelectionKey(cookie);
        const createdDate = new Date(cookie.createdAt).toLocaleString();
        const pointsDisplay = cookie.points === null ? '未知' : cookie.points;
        // 测试时使用的卡片名称：如果指定了testWithCardName则使用它，否则使用cookie关联的卡片
        const actualTestCardName = testWithCardName || cookie.card_name;
        const actionKey = getCookieTestActionKey(cookie);
        const actionLabel = getCookieTestActionLabel(cookie);
        const accountInfo = encodeURIComponent(JSON.stringify({
            aid: cookie.aid || cookie.id || '',
            email: cookie.email || cookie.account || '',
            account: cookie.account || cookie.email || '',
            password: cookie.password || '',
            points: cookie.points,
            card_name: cookie.card_name || cardName || '',
            fileName: cookie.fileName || '',
            name: cookie.fileName || cookie.email || '',
            source: 'cookie-manager'
        }));

        row.dataset.cookieKey = cookieKey;
        row.dataset.accountInfo = accountInfo;
        row.title = '单击单选，按住 Ctrl 可多选，右键可进行批量操作或独立测试绑卡';
        row.classList.toggle('cookie-row-selected', cookieSelectionState.selectedKeys.has(cookieKey));
        row.setAttribute('aria-selected', cookieSelectionState.selectedKeys.has(cookieKey) ? 'true' : 'false');
        row.addEventListener('click', (event) => {
            const interactiveTarget = event.target.closest('button, a, input, label, select, textarea');
            if (interactiveTarget) {
                return;
            }

            if (event.ctrlKey || event.metaKey) {
                toggleCookieSelected(cookie);
            } else {
                selectOnlyCookie(cookie);
            }
        });

        if (isOverview) {
            row.innerHTML = `
                <td>${cookie.email}</td>
                <td>${pointsDisplay}</td>
                <td class="cookie-created-at" title="${createdDate}">${createdDate}</td>
                <td>${cookie.card_name || '未分类'}</td>
                <td class="cookie-actions">
                    <button class="btn btn-primary btn-small" data-cookie-test-action="true" data-cookie-test-key="${escapeHtmlAttribute(actionKey)}" data-cookie-email="${escapeHtmlAttribute(cookie.email)}" data-cookie-test-card="${escapeHtmlAttribute(actualTestCardName)}" data-cookie-original-card="${escapeHtmlAttribute(cookie.card_name)}" onclick="window.testCookieGlobal(this)">${actionLabel}</button>
                </td>
            `;
        } else {
            row.innerHTML = `
                <td>${cookie.email}</td>
                <td>${pointsDisplay}</td>
                <td class="cookie-created-at" title="${createdDate}">${createdDate}</td>
                <td class="cookie-actions">
                    <button class="btn btn-primary btn-small" data-cookie-test-action="true" data-cookie-test-key="${escapeHtmlAttribute(actionKey)}" data-cookie-email="${escapeHtmlAttribute(cookie.email)}" data-cookie-test-card="${escapeHtmlAttribute(actualTestCardName)}" data-cookie-original-card="${escapeHtmlAttribute(cookie.card_name)}" onclick="window.testCookieGlobal(this)">${actionLabel}</button>
                </td>
            `;
        }

        tableBody.appendChild(row);
    });
}

/**
 * 渲染分页后的Cookie表格
 * @param {string} cardName - 当前卡片名称
 * @param {Array} allCookies - 所有Cookie数据
 * @param {Object} elements - DOM元素对象
 * @param {string} testWithCardName - 测试时使用的卡片名称（可选，如果提供则所有Cookie使用此卡片配置测试）
 */
function renderPaginatedCookieTable(cardName, allCookies, elements, testWithCardName = null) {
    const state = cookiePaginationState[cardName];
    if (!state) return;

    const startIndex = (state.currentPage - 1) * COOKIES_PER_PAGE;
    const endIndex = Math.min(startIndex + COOKIES_PER_PAGE, allCookies.length);
    const pageCookies = allCookies.slice(startIndex, endIndex);

    const tableBody = document.getElementById(`cookie-table-body-${cardName}`);
    if (tableBody) {
        renderCookieTable(tableBody, pageCookies, cardName, false, testWithCardName);
    }

    updatePaginationControls(cardName, allCookies.length, elements);
}

/**
 * 更新分页控件状态
 */
function updatePaginationControls(cardName, totalCount, elements) {
    const state = cookiePaginationState[cardName];
    if (!state) return;

    state.totalPages = Math.ceil(totalCount / COOKIES_PER_PAGE);
    state.totalCount = totalCount;

    // 更新页码显示
    const pageInfo = document.getElementById(`pagination-page-${cardName}`);
    if (pageInfo) {
        pageInfo.textContent = `${state.currentPage} / ${state.totalPages}`;
    }

    // 更新信息显示
    const infoEl = document.getElementById(`pagination-info-${cardName}`);
    if (infoEl) {
        const start = (state.currentPage - 1) * COOKIES_PER_PAGE + 1;
        const end = Math.min(state.currentPage * COOKIES_PER_PAGE, totalCount);
        infoEl.textContent = `显示 ${start}-${end} 条，共 ${totalCount} 条`;
    }

    // 更新按钮状态
    const firstBtn = document.getElementById(`pagination-first-${cardName}`);
    const prevBtn = document.getElementById(`pagination-prev-${cardName}`);
    const nextBtn = document.getElementById(`pagination-next-${cardName}`);
    const lastBtn = document.getElementById(`pagination-last-${cardName}`);

    if (firstBtn) firstBtn.disabled = state.currentPage === 1;
    if (prevBtn) prevBtn.disabled = state.currentPage === 1;
    if (nextBtn) nextBtn.disabled = state.currentPage >= state.totalPages;
    if (lastBtn) lastBtn.disabled = state.currentPage >= state.totalPages;

    // 更新跳转下拉框
    const jumpSelect = document.getElementById(`pagination-jump-${cardName}`);
    if (jumpSelect) {
        const currentJumpPage = jumpSelect.value;
        jumpSelect.innerHTML = '';
        for (let i = 1; i <= state.totalPages; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = `第 ${i} 页`;
            if (i === state.currentPage) {
                option.selected = true;
            }
            jumpSelect.appendChild(option);
        }
        if (currentJumpPage && parseInt(currentJumpPage) <= state.totalPages) {
            jumpSelect.value = currentJumpPage;
        }
    }
}

/**
 * 绑定分页事件
 */
function bindPaginationEvents(cardName, allCookies, elements) {
    const firstBtn = document.getElementById(`pagination-first-${cardName}`);
    const prevBtn = document.getElementById(`pagination-prev-${cardName}`);
    const nextBtn = document.getElementById(`pagination-next-${cardName}`);
    const lastBtn = document.getElementById(`pagination-last-${cardName}`);
    const jumpSelect = document.getElementById(`pagination-jump-${cardName}`);

    if (firstBtn) {
        firstBtn.addEventListener('click', () => {
            cookiePaginationState[cardName].currentPage = 1;
            renderPaginatedCookieTable(cardName, allCookies, elements);
        });
    }

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            const state = cookiePaginationState[cardName];
            if (state.currentPage > 1) {
                state.currentPage--;
                renderPaginatedCookieTable(cardName, allCookies, elements);
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const state = cookiePaginationState[cardName];
            if (state.currentPage < state.totalPages) {
                state.currentPage++;
                renderPaginatedCookieTable(cardName, allCookies, elements);
            }
        });
    }

    if (lastBtn) {
        lastBtn.addEventListener('click', () => {
            const state = cookiePaginationState[cardName];
            state.currentPage = state.totalPages;
            renderPaginatedCookieTable(cardName, allCookies, elements);
        });
    }

    if (jumpSelect) {
        jumpSelect.addEventListener('change', (e) => {
            cookiePaginationState[cardName].currentPage = parseInt(e.target.value);
            renderPaginatedCookieTable(cardName, allCookies, elements);
        });
    }

    updatePaginationControls(cardName, allCookies.length, elements);
}

/**
 * 切换Cookie标签页
 */
function switchCookieTab(targetTabId) {
    // 移除所有标签页的active类
    document.querySelectorAll('.cookie-tab-header').forEach(header => {
        header.classList.remove('active');
    });

    document.querySelectorAll('.cookie-tab-content').forEach(content => {
        content.classList.remove('active');
    });

    // 添加当前标签页的active类
    const targetHeader = document.querySelector(`[data-tab="${targetTabId}"]`);
    const targetContent = document.getElementById(targetTabId);

    if (targetHeader) {
        targetHeader.classList.add('active');
    }

    if (targetContent) {
        targetContent.classList.add('active');
    }

    // 更新当前选中的Cookie标签页
    if (targetTabId.startsWith('cookie-tab-')) {
        currentCookieTab = targetTabId.replace('cookie-tab-', '');
    }

    refreshCurrentPointsDistribution();
}

/**
 * 更新积分分布显示
 */
function updatePointsDistribution(identifier, cookiesData, sourceCardName = null) {
    const containerId = identifier === 'overview' ? 'points-distribution-overview' : `points-distribution-${identifier}`;
    const container = document.getElementById(containerId);

    if (!container) return;

    container.innerHTML = '';

    const activeCardName = sourceCardName || (identifier === 'overview' ? currentCookieTab : identifier) || '';
    updatePointsDistributionSubtitle(activeCardName);

    if (!cookiesData || cookiesData.length === 0) {
        const noDataItem = document.createElement('div');
        noDataItem.className = 'points-distribution-item no-data';
        noDataItem.textContent = activeCardName ? `${activeCardName} 暂无数据` : '暂无数据';
        container.appendChild(noDataItem);
        return;
    }

    // 统计每个积分对应的账号数量
    const pointsCounter = {};
    const unknownPointsCount = [];

    cookiesData.forEach(cookie => {
        // 检查是否为未知积分（包括 null, undefined, "null", 空字符串）
        if (cookie.points === null || cookie.points === undefined || 
            cookie.points === 'null' || cookie.points === '') {
            unknownPointsCount.push(cookie.email);
        } else {
            const points = parseInt(cookie.points, 10);
            if (!isNaN(points)) {
                pointsCounter[points] = (pointsCounter[points] || 0) + 1;
            } else {
                unknownPointsCount.push(cookie.email);
            }
        }
    });

    if (unknownPointsCount.length > 0) {
        pointsCounter['未知'] = unknownPointsCount.length;
    }

    // 按积分降序排序
    const sortedPoints = Object.entries(pointsCounter)
        .sort((a, b) => {
            if (a[0] === '未知') return 1;
            if (b[0] === '未知') return -1;
            return parseInt(b[0]) - parseInt(a[0]);
        });

    if (sortedPoints.length === 0) {
        const noDataItem = document.createElement('div');
        noDataItem.className = 'points-distribution-item no-data';
        noDataItem.textContent = '暂无数据';
        container.appendChild(noDataItem);
        return;
    }

    sortedPoints.forEach(([points, count]) => {
        const item = document.createElement('div');
        const isUnknownPoints = points === '未知' || points === 'NaN';
        item.className = `points-distribution-item${isUnknownPoints ? ' points-distribution-item--unknown' : ''}`;
        item.dataset.points = isUnknownPoints ? 'unknown' : points;

        // 所有积分类型都显示测试按钮
        const buttonHtml = `<button class="points-test-btn" data-points="${isUnknownPoints ? 'unknown' : points}" data-card="${activeCardName || identifier}" title="测试该积分的Cookie">
                <span class="test-icon">🔍</span>
               </button>`;

        item.innerHTML = `
            <span class="points-label">积分 ${points}</span>
            <span class="points-count">${count} 个账号</span>
            ${buttonHtml}
        `;

        container.appendChild(item);
    });

    // 为新添加的测试按钮绑定事件
    container.querySelectorAll('.points-test-btn').forEach(btn => {
        btn.addEventListener('click', (event) => {
            if (window.handlePointsCookieTest) {
                window.handlePointsCookieTest(event);
            }
        });
    });
}

/**
 * 删除Cookie
 */
async function deleteCookie(email, loadCookies, showMessage) {
    try {
        const result = await ipcRenderer.invoke('delete-cookie', email);
        if (result.success) {
            await loadCookies();
            showMessage('Cookie删除成功', 'success');
        } else {
            showMessage(`删除失败: ${result.error}`, 'error');
        }
    } catch (error) {
        showMessage(`删除异常: ${error.message}`, 'error');
    }
}

/**
 * 打开Cookie文件夹
 */
async function openCookieFolder(showMessage) {
    try {
        const result = await ipcRenderer.invoke('open-cookie-folder');
        if (!result.success) {
            showMessage(`打开Cookie文件夹失败: ${result.error}`, 'error');
        }
    } catch (error) {
        showMessage(`打开Cookie文件夹异常: ${error.message}`, 'error');
    }
}

/**
 * 更新Cookie计数
 */
function updateCookieCount(count, elements) {
    elements.cookieCount.textContent = `Cookie: ${count}`;
}

// 导出模块
module.exports = {
    loadCookies,
    renderCookieTabs,
    createCardCookieTab,
    renderCookieTable,
    renderPaginatedCookieTable,
    updatePaginationControls,
    bindPaginationEvents,
    switchCookieTab,
    updatePointsDistribution,
    getCookieSelectionKey,
    getCookieSelectionSummary,
    getSelectedCookies,
    selectAllCookies,
    clearCookieSelection,
    setCookieSelected,
    toggleCookieSelected,
    selectOnlyCookie,
    toggleCookiesSelectedInFolder,
    selectCurrentCookieTabCookies,
    deleteCookie,
    openCookieFolder,
    updateCookieCount,
    getCookieTestActionKey,
    getCookieTestActionState,
    setCookieTestActionState,
    clearCookieTestActionState,
    getCookieTestActionLabel,
    syncCookieTestActionState,
    COOKIES_PER_PAGE,
    cookiePaginationState
};
