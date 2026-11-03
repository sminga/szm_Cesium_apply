import {
  classifyFireflowAsset,
  clearStoredFireflowSession,
  createFireflowClient,
  describeFireflowError,
  enrichFireflowProduct,
  fetchFireflowAsset,
  getFireflowConfig,
  pollFireflowRequest,
  readStoredFireflowSession,
  restoreFireflowSession,
  writeStoredFireflowSession,
} from "../services/fireflowClient.js";

function labelOf(value, fallback = "未命名") {
  if (typeof value === "string") return value;
  return value?.label || value?.name || value?.title || value?.id || fallback;
}

export function fireflowOptionValue(value) {
  return typeof value === "string"
    ? value
    : (value?.receiver_type || value?.role_id || value?.category_id || value?.request_type || value?.id || value?.value || "");
}

function replaceOptions(select, values, { emptyLabel = "暂无可选项", disabled = false } = {}) {
  select.replaceChildren();
  if (!values.length) {
    const option = new Option(emptyLabel, "");
    select.append(option);
  } else {
    for (const value of values) select.append(new Option(labelOf(value), fireflowOptionValue(value)));
  }
  select.disabled = disabled || !values.length;
}

function setResult(root, title, detail = "", state = "") {
  root.classList.remove("processing", "success", "error");
  if (state) root.classList.add(state);
  const heading = root.querySelector("b");
  const body = root.querySelector("span");
  if (heading) heading.textContent = title;
  if (body) body.textContent = detail;
}

function appendText(parent, tag, text, className = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

function formatBytes(size) {
  if (!Number.isFinite(size)) return "大小未知";
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let value = size;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[unit]}`;
}

function setButtonLabel(button, label) {
  const text = button?.querySelector("span");
  if (text) text.textContent = label;
  else if (button) button.textContent = label;
}

function createAssetCard(client, asset, onPreview) {
  const card = document.createElement("article");
  card.className = "fireflow-asset";
  const heading = document.createElement("div");
  heading.className = "fireflow-asset-heading";
  appendText(heading, "b", asset.label || asset.file_name || "附件");
  appendText(heading, "small", `${asset.media_type || asset.file_format || "未知格式"} · ${formatBytes(asset.size_bytes)}`);
  card.append(heading);

  const kind = classifyFireflowAsset(asset);
  if (kind === "image") {
    const figure = document.createElement("figure");
    figure.className = "fireflow-preview";
    const image = document.createElement("img");
    image.src = client.datasetUrl(asset.dataset_id);
    image.alt = asset.label || asset.file_name || "分发结果图片";
    image.loading = "lazy";
    image.referrerPolicy = "same-origin";
    figure.append(image);
    card.append(figure);
  } else if (kind === "map_overlay") {
    appendText(card, "p", "该附件声明可地图定位，但第一阶段暂不自动叠加，先提供原文件下载。", "fireflow-asset-note");
  } else if (kind === "wind") {
    appendText(card, "p", "风场文件已登记；当前页面暂不转换 NetCDF-4 或补充 W 分量。", "fireflow-asset-note");
  }

  const actions = document.createElement("div");
  actions.className = "fireflow-asset-actions";
  const download = document.createElement("a");
  download.className = "small-command";
  download.href = client.datasetUrl(asset.dataset_id);
  download.download = asset.file_name || "fireflow-dataset";
  download.textContent = "下载附件";
  actions.append(download);

  if (kind === "text" || /^(application\/json|text\/)/.test(asset.media_type || "")) {
    const preview = document.createElement("button");
    preview.type = "button";
    preview.className = "small-command";
    preview.textContent = "预览文字";
    preview.addEventListener("click", () => onPreview(asset, preview));
    actions.append(preview);
  }
  card.append(actions);
  return card;
}

/**
 * 管理 Fireflow 身份、目录、申请和结果侧栏。
 *
 * 控制器不直接创建 Cesium 图层：第一阶段只显示图表、摘要和可下载附件，
 * 对没有可靠地理配准或不兼容 NetCDF-3 的资源明确提示，避免把错误数据
 * 静默放入地图。轮询被暂停时只停止浏览器请求，不会取消后端计算。
 */
export class FireflowController {
  constructor({ root, serviceStatusElement, storage = globalThis.localStorage } = {}) {
    this.root = root;
    this.serviceStatusElement = serviceStatusElement;
    this.storage = storage;
    this.config = getFireflowConfig();
    this.client = null;
    this.profiles = null;
    this.catalogResponse = null;
    this.currentRequest = null;
    this.currentProduct = null;
    this.pollController = null;
    this.destroyed = false;
    this.boundTabHandler = null;
  }

  getElement(id) {
    return this.root?.querySelector(`#${id}`);
  }

  initialize() {
    if (!this.root) return;
    this.bindEvents();
    if (!this.config.enabled) {
      this.setServiceState("分发服务未启用", "当前构建未开启 VITE_FIREFLOW_ENABLED", "");
      this.disableAllControls();
      return;
    }
    try {
      this.client = createFireflowClient(this.config);
    } catch (error) {
      this.setServiceState("分发服务配置错误", describeFireflowError(error), "error");
      this.disableAllControls();
      return;
    }
    void this.loadProfiles();
  }

  bindEvents() {
    this.getElement("fireflow-identity-button")?.addEventListener("click", () => void this.selectIdentity());
    this.getElement("fireflow-catalog-refresh")?.addEventListener("click", () => void this.loadCatalog());
    this.getElement("fireflow-request-button")?.addEventListener("click", () => void this.createRequest());
    this.getElement("fireflow-receiver")?.addEventListener("change", () => this.renderRoles());
    this.getElement("fireflow-role")?.addEventListener("change", () => this.clearCatalog());
    this.getElement("fireflow-category")?.addEventListener("change", () => void this.loadCatalog());
    this.getElement("fireflow-request-type")?.addEventListener("change", () => this.renderRequestDescription());
    this.boundTabHandler = (event) => {
      const tab = event.target.closest(".panel-tab");
      if (!tab) return;
      if (tab.dataset.panel === "fireflow") void this.resumePolling();
      else this.pausePolling();
    };
    document.addEventListener("click", this.boundTabHandler);
  }

  disableAllControls() {
    this.root.querySelectorAll("button, select").forEach((element) => { element.disabled = true; });
  }

  setServiceState(title, detail, state = "") {
    setResult(this.getElement("fireflow-service-result"), title, detail, state);
    if (this.serviceStatusElement && this.config.enabled) this.serviceStatusElement.textContent = title;
  }

  setRequestState(title, detail, state = "") {
    setResult(this.getElement("fireflow-request-result"), title, detail, state);
  }

  async loadProfiles() {
    try {
      this.profiles = await this.client.profiles();
      this.renderReceiverTypes();
      const stored = readStoredFireflowSession(this.storage);
      if (stored) {
        try {
          const session = await restoreFireflowSession(this.client, stored);
          this.applySession(session);
          await this.loadCatalog();
          this.setServiceState("分发服务已连接", "已恢复上次身份会话", "success");
          return;
        } catch {
          clearStoredFireflowSession(this.storage);
        }
      }
      this.setServiceState("分发服务已连接", "请选择接收力量和岗位", "success");
    } catch (error) {
      this.setServiceState("分发服务不可用", describeFireflowError(error), "error");
      this.getElement("fireflow-identity-button").disabled = true;
    }
  }

  receiverTypes() {
    return this.profiles?.receiver_types || [];
  }

  selectedReceiver() {
    const id = this.getElement("fireflow-receiver")?.value;
    return this.receiverTypes().find((item) => fireflowOptionValue(item) === id);
  }

  renderReceiverTypes() {
    const select = this.getElement("fireflow-receiver");
    replaceOptions(select, this.receiverTypes(), { emptyLabel: "暂无接收力量" });
    this.renderRoles();
  }

  renderRoles() {
    const receiver = this.selectedReceiver();
    const roles = receiver?.roles || [];
    replaceOptions(this.getElement("fireflow-role"), roles, { emptyLabel: "暂无可选岗位" });
    this.clearCatalog();
  }

  clearCatalog() {
    this.catalogResponse = null;
    replaceOptions(this.getElement("fireflow-category"), [], { emptyLabel: "选择身份后加载分类", disabled: true });
    replaceOptions(this.getElement("fireflow-request-type"), [], { emptyLabel: "选择分类后加载产品", disabled: true });
    this.getElement("fireflow-request-button").disabled = true;
    this.getElement("fireflow-request-description").textContent = "";
  }

  applySession(session) {
    this.session = session;
    const receiver = this.getElement("fireflow-receiver");
    const role = this.getElement("fireflow-role");
    if (receiver) receiver.value = session.receiver_type || "";
    this.renderRoles();
    if (role) role.value = session.role_id || "";
    replaceOptions(this.getElement("fireflow-category"), session.categories || [], {
      emptyLabel: "当前身份没有可用分类",
    });
    const receiverProfile = this.selectedReceiver();
    const roleProfile = receiverProfile?.roles?.find((item) => fireflowOptionValue(item) === session.role_id);
    this.getElement("fireflow-session").textContent = `${labelOf(receiverProfile, session.receiver_type)} / ${labelOf(roleProfile, session.role_id)}`;
    setButtonLabel(this.getElement("fireflow-identity-button"), "重新选择身份");
  }

  async selectIdentity() {
    const receiverType = this.getElement("fireflow-receiver").value;
    const roleId = this.getElement("fireflow-role").value;
    if (!receiverType || !roleId) {
      this.setRequestState("身份未完成", "请选择接收力量和岗位", "error");
      return;
    }
    this.getElement("fireflow-identity-button").disabled = true;
    this.setRequestState("正在确认身份", "正在建立当前浏览器会话", "processing");
    try {
      const session = await this.client.selectIdentity(receiverType, roleId);
      writeStoredFireflowSession(session, this.storage);
      this.applySession(session);
      this.setRequestState("身份已确认", "可以读取当前岗位的产品目录", "success");
      await this.loadCatalog();
    } catch (error) {
      this.setRequestState("身份确认失败", describeFireflowError(error), "error");
    } finally {
      this.getElement("fireflow-identity-button").disabled = false;
    }
  }

  async loadCatalog() {
    if (!this.client?.sessionId) return;
    const category = this.getElement("fireflow-category").value || undefined;
    this.getElement("fireflow-catalog-refresh").disabled = true;
    try {
      // 交接接口的科研图片、完整 request_options 和产品详情位于 research 视图；
      // 显式传参可避免薄客户端默认 operational 后造成目录内容与页面用途不一致。
      this.catalogResponse = await this.client.catalog(category || "wind", { research: true });
      const categories = this.catalogResponse.categories || [];
      replaceOptions(this.getElement("fireflow-category"), categories, { emptyLabel: "当前岗位没有分类" });
      if (this.catalogResponse.selected_category) this.getElement("fireflow-category").value = this.catalogResponse.selected_category;
      const options = this.catalogResponse.request_options || [];
      replaceOptions(this.getElement("fireflow-request-type"), options, { emptyLabel: "当前分类暂无可申请产品" });
      this.renderRequestDescription();
      this.setRequestState("目录已更新", `${options.length} 个可申请产品`, options.length ? "success" : "");
    } catch (error) {
      this.setRequestState("目录读取失败", describeFireflowError(error), "error");
    } finally {
      this.getElement("fireflow-catalog-refresh").disabled = false;
    }
  }

  selectedRequestOption() {
    const id = this.getElement("fireflow-request-type")?.value;
    return this.catalogResponse?.request_options?.find((item) => fireflowOptionValue(item) === id);
  }

  renderRequestDescription() {
    const option = this.selectedRequestOption();
    const description = this.getElement("fireflow-request-description");
    if (!option) {
      description.textContent = "";
      this.getElement("fireflow-request-button").disabled = true;
      return;
    }
    description.textContent = `${option.description || option.label || option.request_type} · 输出 ${option.output_product_type || "未说明"}`;
    this.getElement("fireflow-request-button").disabled = false;
  }

  async createRequest() {
    const option = this.selectedRequestOption();
    if (!option || !this.client?.sessionId) return;
    this.pausePolling();
    const idempotencyKey = globalThis.crypto.randomUUID();
    this.getElement("fireflow-request-button").disabled = true;
    this.setRequestState("正在提交申请", `幂等键 ${idempotencyKey}`, "processing");
    try {
      const request = await this.client.requestProduct(option.request_type, {
        parameters: option.default_parameters || {},
        idempotencyKey,
      });
      this.currentRequest = request;
      this.renderRequestStatus(request);
      await this.trackRequest(request);
    } catch (error) {
      this.setRequestState("申请提交失败", describeFireflowError(error), "error");
    } finally {
      this.getElement("fireflow-request-button").disabled = false;
    }
  }

  renderRequestStatus(request) {
    const detail = [request.progress_hint, request.waiting_seconds ? `已等待 ${request.waiting_seconds} 秒` : ""]
      .filter(Boolean).join(" · ");
    const state = request.status === "failed" ? "error" : request.status === "completed" ? "success" : "processing";
    this.setRequestState(request.status || "处理中", detail || request.request_id || "", state);
  }

  async trackRequest(request) {
    if (!request?.request_id) throw new Error("REQUEST_ID_REQUIRED");
    this.pollController?.abort(new DOMException("开始新的申请", "AbortError"));
    const controller = new AbortController();
    this.pollController = controller;
    try {
      const finalStatus = request.status === "completed" || request.status === "failed"
        ? request
        : await pollFireflowRequest(this.client, request.request_id, {
          signal: controller.signal,
          onUpdate: (status) => {
            this.currentRequest = status;
            this.renderRequestStatus(status);
          },
        });
      this.currentRequest = finalStatus;
      this.renderRequestStatus(finalStatus);
      if (finalStatus.status === "completed" && finalStatus.result_product_id) {
        await this.loadProduct(finalStatus.result_product_id);
      } else if (finalStatus.status === "failed") {
        this.setRequestState("申请失败", finalStatus.last_error || finalStatus.progress_hint || "服务未提供失败原因", "error");
      }
    } catch (error) {
      if (error?.name !== "AbortError") this.setRequestState("状态查询失败", describeFireflowError(error), "error");
    } finally {
      if (this.pollController === controller) this.pollController = null;
    }
  }

  pausePolling() {
    this.pollController?.abort(new DOMException("侧栏已隐藏", "AbortError"));
  }

  async resumePolling() {
    if (!this.currentRequest || !["pending", "running"].includes(this.currentRequest.status) || this.pollController) return;
    await this.trackRequest(this.currentRequest);
  }

  async loadProduct(productId) {
    this.setRequestState("申请已完成", "正在读取产品摘要和附件清单", "processing");
    try {
      this.currentProduct = await enrichFireflowProduct(this.client, await this.client.product(productId));
      this.renderProduct(this.currentProduct);
      this.setRequestState("结果已就绪", `${this.currentProduct.title || productId} · ${this.currentProduct.assets?.length || 0} 个附件`, "success");
    } catch (error) {
      this.setRequestState("产品读取失败", describeFireflowError(error), "error");
    }
  }

  renderProduct(product) {
    const result = this.getElement("fireflow-product-result");
    result.replaceChildren();
    appendText(result, "h3", product.title || "分发结果");
    appendText(result, "p", product.summary || "服务未返回文字摘要", "fireflow-summary");
    if (product.quality_status) appendText(result, "small", `质量状态：${product.quality_status}`);
    const assets = document.createElement("div");
    assets.className = "fireflow-assets";
    for (const asset of [...(product.assets || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))) {
      assets.append(createAssetCard(this.client, asset, (selected, button) => void this.previewAsset(selected, button)));
    }
    if (!product.assets?.length) appendText(assets, "p", "本产品没有独立附件，以上文字摘要就是主要结果。", "fireflow-empty");
    result.append(assets);
  }

  async previewAsset(asset, button) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "读取中";
    try {
      const response = await fetchFireflowAsset(this.client, asset);
      const text = await response.text();
      const preview = document.createElement("pre");
      preview.className = "fireflow-text-preview";
      preview.textContent = text.length > 20000 ? `${text.slice(0, 20000)}\n\n[预览已截断]` : text;
      button.closest(".fireflow-asset")?.append(preview);
      button.remove();
    } catch (error) {
      const card = button.closest(".fireflow-asset");
      appendText(card, "p", describeFireflowError(error), "fireflow-asset-error");
      button.disabled = false;
      button.textContent = original;
    }
  }

  destroy() {
    this.destroyed = true;
    this.pausePolling();
    if (this.boundTabHandler) document.removeEventListener("click", this.boundTabHandler);
  }
}
