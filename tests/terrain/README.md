# 地形控制器测试

`TerrainController.test.js` 使用最小 Viewer、Provider 和事件替身验证 `TerrainController` 的状态机，不下载真实瓦片。

主要场景：

- 并发加载时只应用最后一次请求。
- 新地形失败后保留最后成功 Provider。
- 恢复椭球时取消在途请求。
- 失败期间的瓦片进度和错误不会污染稳定快照。
- 切换和销毁时移除旧 Provider 监听。

```powershell
npx vitest run tests/terrain/TerrainController.test.js
```

新增状态字段或切换路径时，应验证成功、失败、过期请求和 `destroy()` 四类行为。真实 quantized-mesh 的网络、CORS 和视觉结果不属于该单元测试范围。
