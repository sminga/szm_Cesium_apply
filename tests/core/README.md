# 核心工具测试

`utils.test.js` 验证 `src/core/utils.js` 的纯函数行为，包括嵌套配置合并、数组或对象处理，以及由 U/V/W 分量计算速度、最小值和最大值。

```powershell
npx vitest run tests/core/utils.test.js
```

修改默认选项合并或速度计算时应在此补充正常值、零值、负分量和边界输入。高度选择不放在这里，相关测试位于 `tests/layers/verticalSelection.test.js`。
