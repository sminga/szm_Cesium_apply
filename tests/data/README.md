# 风场数据测试

## 文件职责

| 文件 | 覆盖行为 |
| --- | --- |
| `netcdfLoader.test.js` | NetCDF 变量识别、维度顺序、坐标排序、单位校验、异常高度、W 补零和警告。 |
| `weightedParticleSampler.test.js` | 高低风速权重、密度下限、粒子位置范围和高度选择。 |

```powershell
npx vitest run tests/data
```

测试使用轻量 reader 或确定性随机数，不依赖大型真实 NC 文件。新增变量别名、单位规则、维度支持或采样策略时，需要同时增加正常和拒绝路径测试。

建议先读测试构造的最小数据，再回到 `src/data/` 理解解析流程。
