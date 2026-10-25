/**
 * 创建地形源激活流程。每次激活都会取得递增版本号，只有最新请求可以更新活动源；
 * Cesium Provider 加载失败或被后续操作取代时，原活动源保持不变。
 */
export function createTerrainActivationRunner({ registry, getActiveId, setActiveId, releasePrevious }) {
  let requestVersion = 0;
  const latestVersionById = new Map();

  return async function runTerrainActivation(id, loader, { releaseBrowser = true } = {}) {
    const version = ++requestVersion;
    latestVersionById.set(id, version);
    if (registry.has(id)) registry.update(id, { status: "loading", detail: "正在切换地形" });

    let result;
    try {
      result = await loader();
    } catch (error) {
      result = { applied: false, error };
    }

    if (version !== requestVersion) {
      // 只清理当前源最后一次请求的旧状态；如果同一源已有新请求，不能由旧 Promise 覆盖。
      if (latestVersionById.get(id) === version && id !== getActiveId() && registry.has(id)) {
        registry.update(id, { status: "idle", detail: "切换请求已被其他地形取代" });
      }
      return result ?? { applied: false, reason: "superseded" };
    }

    if (!result?.applied) {
      if (registry.has(id)) registry.update(id, {
        status: "failed",
        detail: result?.error?.message || "地形切换失败，仍保留原地形",
      });
      return result ?? { applied: false };
    }

    setActiveId(id);
    registry.setExclusiveActive("terrain", id);
    if (version === requestVersion && registry.has(id)) registry.update(id, { status: "ready" });
    if (releaseBrowser) {
      try {
        await releasePrevious?.();
      } catch (error) {
        // Provider 已生效后，旧会话清理失败不能伪装成地形切换失败；保留活动状态并显示清理警告。
        if (version === requestVersion && registry.has(id)) {
          registry.update(id, { detail: `地形已切换，旧会话清理失败：${error?.message || error}` });
        }
        return { ...result, cleanupError: error };
      }
    }
    return result;
  };
}
