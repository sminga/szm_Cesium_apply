import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { bindWorkspaceTabs } from "../../example/app/workspaceTabs.js";

class FakeClassList {
  constructor(initial = []) {
    this.values = new Set(initial);
  }

  contains(value) {
    return this.values.has(value);
  }

  toggle(value, force) {
    if (force) this.values.add(value);
    else this.values.delete(value);
  }
}

class FakeElement {
  constructor(dataset, attributes = {}, classes = []) {
    this.dataset = dataset;
    this.attributes = new Map(Object.entries(attributes));
    this.classList = new FakeClassList(classes);
    this.listeners = new Map();
    this.hidden = false;
    this.focused = false;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  focus() {
    this.focused = true;
  }

  click() {
    (this.listeners.get("click") ?? []).forEach((listener) => listener({ target: this }));
  }

  keydown(key) {
    const event = { key, preventDefault: vi.fn(), target: this };
    (this.listeners.get("keydown") ?? []).forEach((listener) => listener(event));
    return event;
  }
}

function createFixture() {
  const tabs = ["wind", "layers", "terrain", "tools"].map((panel, index) => new FakeElement(
    { panel },
    { "aria-selected": index === 0 ? "true" : "false", tabindex: index === 0 ? "0" : "-1" },
    index === 0 ? ["active"] : [],
  ));
  const pages = ["wind", "layers", "terrain", "tools"].map((page, index) => {
    const element = new FakeElement({ page }, {}, index === 0 ? ["active"] : []);
    element.hidden = index !== 0;
    return element;
  });
  return { tabs, pages };
}

describe("workspace tabs", () => {
  it("同步鼠标切换后的选中状态和内容面板", () => {
    const { tabs, pages } = createFixture();
    const onSelect = vi.fn();
    bindWorkspaceTabs({ tabs, pages, onSelect });

    tabs[1].click();

    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true", "false", "false"]);
    expect(tabs.map((tab) => tab.getAttribute("tabindex"))).toEqual(["-1", "0", "-1", "-1"]);
    expect(pages.map((page) => page.hidden)).toEqual([true, false, true, true]);
    expect(onSelect).toHaveBeenLastCalledWith(tabs[1]);
  });

  it("支持方向键循环以及 Home 和 End 快捷键", () => {
    const { tabs, pages } = createFixture();
    bindWorkspaceTabs({ tabs, pages });

    const leftEvent = tabs[0].keydown("ArrowLeft");
    expect(leftEvent.preventDefault).toHaveBeenCalledOnce();
    expect(tabs[3].focused).toBe(true);
    expect(tabs[3].getAttribute("aria-selected")).toBe("true");
    expect(pages[3].hidden).toBe(false);

    tabs[3].keydown("Home");
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");

    tabs[0].keydown("End");
    expect(tabs[3].getAttribute("aria-selected")).toBe("true");
  });

  it("声明完整 tablist、tab 和 tabpanel 关联", () => {
    const html = fs.readFileSync(new URL("../../example/index.html", import.meta.url), "utf8");
    expect(html).toContain('class="panel-tabs workspace-tabs" role="tablist"');
    expect(html).not.toContain('class="app-brand" aria-label=');
    expect(html).toContain('class="map-toolbar" role="toolbar" aria-label="地图工具"');

    const panelIds = {
      wind: "workspace-panel-wind",
      layers: "workspace-panel-layers",
      terrain: "workspace-panel-terrain",
      fireflow: "fireflow-panel",
      tools: "workspace-panel-tools",
    };
    Object.entries(panelIds).forEach(([name, panelId]) => {
      expect(html).toContain(`id="workspace-tab-${name}"`);
      expect(html).toContain(`aria-controls="${panelId}"`);
      expect(html).toContain(`id="${panelId}"`);
      expect(html).toContain(`aria-labelledby="workspace-tab-${name}"`);
    });
  });
});
