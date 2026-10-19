# 本地 Python 工具测试

## 文件职责

| 文件 | 覆盖行为 |
| --- | --- |
| `test_convert_netcdf.py` | 变量映射、维度规范化、单层高度、垂直速度单位和异常条带修复。 |
| `test_local_service.py` | 文件名安全、路径限制、目录接口、缓存/HEAD、上传转换和错误响应。 |
| `test_terrain_dataset.py` | `layer.json`、瓦片数量、层级、范围、大小和无效数据集报告。 |

```powershell
npm run test:python
```

测试应使用临时目录和小型合成数据，不依赖用户真实数据、长期运行的服务或 Docker。Docker CTB 的真实转换仍需在安装 Docker 的开发环境单独验证。

Python 运行可能生成 `__pycache__`，已由 `.gitignore` 排除，不应作为项目文件提交。
