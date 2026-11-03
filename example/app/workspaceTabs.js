const WORKSPACE_TAB_KEYS = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);

function getNextTabIndex(currentIndex, key, tabCount) {
  if (key === "Home") return 0;
  if (key === "End") return tabCount - 1;
  if (key === "ArrowLeft") return (currentIndex - 1 + tabCount) % tabCount;
  if (key === "ArrowRight") return (currentIndex + 1) % tabCount;
  return currentIndex;
}

/**
 * 绑定工作区顶部页签，并同步视觉状态、ARIA 状态和内容面板显隐。
 *
 * 键盘方向键采用自动激活模式：焦点移动到相邻页签时立即显示对应面板。
 * 这样鼠标、键盘和屏幕阅读器始终读取同一份选中状态，也能让其他监听
 * 页签 click 事件的业务模块继续收到一致的切换通知。
 *
 * @param {object} options
 * @param {HTMLElement[]} options.tabs 具有 `data-panel` 的页签按钮。
 * @param {HTMLElement[]} options.pages 具有 `data-page` 的内容面板。
 * @param {(tab: HTMLElement) => void} [options.onSelect] 每次切换成功后的回调。
 * @returns {{ selectTab: (tab: HTMLElement, options?: { focus?: boolean }) => void, destroy: () => void }}
 */
export function bindWorkspaceTabs({ tabs, pages, onSelect = () => {} }) {
  const tabList = Array.from(tabs ?? []);
  const pageList = Array.from(pages ?? []);
  const listeners = [];

  const selectTab = (tab, { focus = false, notify = true } = {}) => {
    if (!tabList.includes(tab)) return;

    tabList.forEach((item) => {
      const selected = item === tab;
      item.classList.toggle("active", selected);
      item.setAttribute("aria-selected", String(selected));
      item.setAttribute("tabindex", selected ? "0" : "-1");
    });
    pageList.forEach((page) => {
      const selected = page.dataset.page === tab.dataset.panel;
      page.classList.toggle("active", selected);
      page.hidden = !selected;
    });

    if (focus) tab.focus();
    if (notify) onSelect(tab);
  };

  tabList.forEach((tab, index) => {
    const handleClick = () => selectTab(tab);
    const handleKeyDown = (event) => {
      if (!WORKSPACE_TAB_KEYS.has(event.key) || tabList.length === 0) return;
      event.preventDefault();

      const nextTab = tabList[getNextTabIndex(index, event.key, tabList.length)];
      // 使用 click 作为统一激活入口，确保 Fireflow 等既有业务监听器也收到切换事件。
      nextTab.focus();
      nextTab.click();
    };

    tab.addEventListener("click", handleClick);
    tab.addEventListener("keydown", handleKeyDown);
    listeners.push([tab, "click", handleClick], [tab, "keydown", handleKeyDown]);
  });

  const initialTab = tabList.find((tab) => tab.getAttribute("aria-selected") === "true")
    ?? tabList.find((tab) => tab.classList.contains("active"))
    ?? tabList[0];
  // 初始化只校正 DOM 状态，不触发移动端打开面板等用户操作回调。
  if (initialTab) selectTab(initialTab, { notify: false });

  return {
    selectTab,
    destroy() {
      listeners.forEach(([element, type, listener]) => element.removeEventListener(type, listener));
    },
  };
}
