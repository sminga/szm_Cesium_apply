# WRF 风场离线处理方法

## 适用范围

本指南针对 WRF-ARW 的 `wrfout` NetCDF-4/HDF5 文件，以及本项目要求的 NetCDF-3 `WindData3D` 输入。浏览器加载器直接支持 NetCDF-3 Classic/64-bit offset，不负责在网页中执行 WRF 解码、网格转换或 NetCDF-4 解压缩；因此本流程是开发者离线预处理步骤。

本项目新增的 `tools/netcdf/convert_wrf.py` 面向包含标准 WRF-ARW `U`、`V`、`W`、`PH`、`PHB`、`XLAT`、`XLONG` 变量的 `wrfout`。它不是通用 NetCDF 工具，也不接受已经改名但语义不明的任意风场文件。

## 为什么不能直接使用通用转换器

WRF 使用 Arakawa C 错列网格：水平 U、V 和垂直 W 分量分别位于不同网格面，且 `XLAT`、`XLONG` 是二维变量；WRF 垂直坐标为地形跟随坐标，模型层编号不能直接作为米制高度。`tools/netcdf/convert_netcdf.py` 则要求一维、等长坐标及形状相同的 U/V/W，所以即使显式传入 `--u U --v V --w W`，也无法完成正确的去错列、坐标旋转和高度换算。

`wrf-python` 官方诊断量提供了适合本流程的基础：`uvmet` 将水平风去错列并旋转成地球坐标东/北分量，`wa` 返回质量点上的垂直速度，`z` 返回质量层位势高度（海拔基准）。本实现使用这些诊断量，而不是自行复制 WRF 的错列和旋转公式。

## 安装

建议 Windows 用户使用 WSL2/Linux，并创建独立 Conda 环境，以隔离 WRF 相关 Python 包和项目网站依赖：

```bash
conda create -n cesium-wrf -c conda-forge python=3.11 wrf-python=1.4.2 netcdf4 xarray numpy scipy
conda activate cesium-wrf
```

截至 2026-10-22，conda-forge 当前 `wrf-python` 版本为 1.4.2，但 win-64 只保留到 1.3.4.1，且该 Windows 构建要求 Python 3.11。推荐 WSL2/Linux 使用 1.4.2；如果必须原生 Windows，可尝试 `python=3.11 wrf-python=1.3.4.1`，但本项目尚未验证此旧版本组合。不建议为了离线转换工具改变项目前端依赖或 Vercel 构建。

## 转换命令

```bash
cd /mnt/d/AAAcode/CesiumLearn/Cesium-learn/cesium-wind-layer-3d
python tools/netcdf/convert_wrf.py \
  "/mnt/c/桌面/AAA正进行/毛铂涵 改进/wrfout_d01_2024-04-03_08-00-00(1).nc" \
  --time-index 0 \
  --height-step 500 \
  --nx 180 --ny 180 \
  -o "tools/converted/wrfout_d01_2024-04-03_08-00-00_wind3d.nc"
```

参数说明：

- `--time-index`：输入文件的 `Time` 索引，从 0 开始；每次运行输出一个时次文件。
- `--height-step`：统一海拔高度（MSL）层间距，单位米，默认 500。高度层只选取所有源网格柱都覆盖的交集，并按间隔取整，因此会舍去高山区域无法覆盖的低空层和高空边界层。
- `--nx`、`--ny`：目标规则经纬网格大小，默认等于 WRF 原始水平网格宽高。降低分辨率可缩小文件与网页显存/下载开销；提高分辨率不会创造源数据中不存在的细节。
- `-o`：输出路径；省略时在源文件旁生成 `<源文件名>_wind3d.nc`。默认不覆盖已有文件，需要明确覆盖时添加 `--overwrite`。

转换器先从 `wrf-python` 获取目标时次的 `uvmet`、`wa`、`z` 和二维经纬度，再逐个网格柱将 U/V/W 插值到共同 MSL 高度。随后以经纬度外接矩形建立规则目标网格，对源曲线网格做线性三角剖分插值。目标点落在源域凸包之外或其任一高度/分量无效时不写入伪零值；程序会裁取最大的完整有效矩形，以满足当前浏览器加载器要求的完整规则网格。日志会显示层数、高度范围和裁剪窗口。

## 当前示例数据的选择建议

2026-10-26 已重新读取并实际转换用户提供的当前文件。输入为 WRF V4.7.1、一个时次、180 x 180 水平质量网格和 44 个质量层；U/V 水平错列尺寸为 181，W 垂直错列尺寸为 45。纬度范围为 24.628296～25.165085，经度范围为 102.265350～102.857147。全域质量层高度约为 1809.65～20416.53 m，所有网格柱共同覆盖的 MSL 高度约为 2542.65～20399.74 m。

以 `--height-step 500 --nx 180 --ny 180` 转换后，输出 35 个真实高度层，范围为 3000～20000 m；有效矩形保留全部 180 行和目标列 1～178，最终规则网格为 `35 x 180 x 178`。该数据域属于高地形区域，MSL 共同高度交集会优先保证每个输出水平网格都有有效值，因此最低层明显高于部分地表。如果业务目标是近地风，应使用 AGL 高度并改造数据契约/渲染方式以正确表示随地形变化的高度；不能将 MSL 结果的 `lev` 简单改成 AGL 标签，也不能用复制单层代替真实垂直数据。

## 真实文件验证结果（2026-10-26）

验证使用纯英文路径的只读副本和最小权限 Docker Linux 容器。容器只读挂载一个 WRF 副本和转换脚本，只对 Git 忽略的 `tools/converted` 有写权限；环境为 Python 3.11.17、`wrf-python 1.4.2`、NumPy 2.4.6、SciPy 1.17.1、xarray 2026.9.0 和 netCDF4 1.7.4。原始中文路径文件没有被修改，副本与原文件的 SHA-256 一致。

输出 `tools/converted/wrfout_d01_2024-04-03_08-00-00_wind3d.nc` 为 13,459,224 字节，文件头为 `CDF\x02`，netCDF4 重读结果为 `NETCDF3_64BIT_OFFSET`。`lev/lat/lon` 均严格递增，`lev` 固定间隔 500 m；经纬度由规则 `linspace` 生成并存成 float32，因此相邻差值存在浮点量化差异。U/V/W 的维度均为 `(lev, lat, lon)`，形状都是 `(35, 180, 178)`，全部值有限：

- U：7.1203～47.4244 m/s。
- V：-10.1044～8.3932 m/s。
- W：-2.6579～2.9183 m/s。
- 水平风速：7.4219～47.7472 m/s；三维合成风速：7.4220～47.7472 m/s。

开发模式通过 `npm run local:server` 列出该文件，并在 Vite 桌面页面的“三维风场”目录加载。页面登记第二个三维风场图层，显示 `3000～20000 m`，高度下拉框包含全部 35 层；实际切换到 `10000 m 单层`、`15000 m 单层` 后又恢复全部高度成功。Cesium 画布可见流线，页面风速图例约为 7.4～48 m/s；间隔两秒的两张无标注截图在中央地图裁剪区有 64.05% 像素发生变化，证明动画画面持续更新。浏览器没有页面错误、Vite 错误覆盖层或 WebGL 错误；控制台存在 Cesium ion 影像瓦片网络失败日志，与本地 WRF 文件解析和风场 Shader 无关。

## 加载与核验

1. 检查转换日志中的 `grid`、MSL 高度范围和有效矩形尺寸。
2. 用 NetCDF 工具确认输出维度为 `lev`、`lat`、`lon`，坐标严格递增，U/V/W 形状完全一致且无 NaN/Inf。
3. 将输出放入开发环境 `tools/converted/`，运行 `npm run local:server`，在示例网站“风场”面板加载输出。
4. 查看高度层数、风速范围、数据覆盖范围及地形中的垂直分布。若覆盖范围过小，降低 `--nx/--ny` 或检查源域边界与高度范围；不要用修改粒子数或高度显示范围掩盖无效输入。
5. 网页可见验证需要 Cesium/WebGL2 浏览器。单元测试和转换成功只验证处理数据，不等于真实 GPU 渲染验证。

算法测试：

```powershell
python -m unittest tests.tools.test_convert_wrf
```

## Vercel 与数据发布边界

`convert_wrf.py`、Conda、WSL2 和本地 `tools/converted/` 都只属于离线维护流程；不进入网站浏览器 bundle，也不随 Vercel 自动发布。若要让访客使用转换后的风场，应单独评估数据许可与体积，再将 NetCDF-3 结果发布到 Vercel 静态资源、对象存储或 CDN，配置正确 CORS、缓存和下载范围，并通过实际 Preview 部署验证。公众直接上传 WRF 转换需要另建异步云端 worker 与任务/对象存储设计，本次没有实现。

## 已知限制

- 只处理单个 `Time` 切片和标准 WRF-ARW 变量，不做时序插值或动画打包。
- 只输出 MSL 米制高度；没有输出 AGL 或压力层产品。
- 规则经纬度重采样是线性插值，可能裁去非矩形边界；细节精度受源网格和目标分辨率共同限制。
- 当前不处理跨日期变更线区域、缺测污染、任意 WRF 变体、复杂嵌套域拼接或多文件时间合并。
- 本仓库当前原生 Python 3.14 环境仍没有安装 `wrf-python` 和 SciPy，不能直接执行 WRF 诊断；本次已在隔离的 Docker Linux/Conda 环境完成真实转换。以后在其他电脑处理新文件时仍需先准备同等依赖环境。
- 本次浏览器验证是本机桌面开发预览，不等于已经把该 13.46 MB 输出发布到 Vercel。Vercel Preview/Production、公开数据许可、CDN/缓存、下载带宽和不同 GPU/浏览器仍未验证。

## 官方资料与方案来源

- NCAR WRF Users Guide，Dynamics / Arakawa C-grid：<https://www2.mmm.ucar.edu/wrf/site/documentation/users_guide/dynamics.html>
- `wrf-python` 官方 `getvar` API（`uvmet`、`wa`、`z` 等诊断）：<https://wrf-python.readthedocs.io/en/latest/user_api/generated/wrf.getvar.html>
- `wrf-python` 官方 `interplevel` API：<https://wrf-python.readthedocs.io/en/latest/user_api/generated/wrf.interplevel.html>

本项目复用 `wrf-python` 的诊断 API，没有复制其实现代码；本项目没有新增 `wrf-python` 或 SciPy 到网页/npm 依赖中。WRF-Python 许可证、安装及平台支持请以其发行包和官方文档为准。

`wrf-python` 项目采用 Apache-2.0，SciPy 采用 BSD-3-Clause；两者仅作为此离线工具的独立 Conda 环境依赖，本项目不随网站或 npm 包再分发其源码/二进制。根据 conda-forge 包文件列表及 NCAR Windows 构建 issue，截至 2026-10-22，推荐 Linux/WSL2 使用 1.4.2；win-64 仍为较旧的 1.3.4.1，原生 Windows 方案没有在本项目验证。

- `wrf-python` Conda 安装说明：<https://wrf-python.readthedocs.io/en/main/installation.html>
- conda-forge 版本/平台文件：<https://anaconda.org/channels/conda-forge/packages/wrf-python/files>
- NCAR Windows 构建状态讨论：<https://github.com/NCAR/wrf-python/issues/307>
- `wrf-python` Apache-2.0：<https://github.com/NCAR/wrf-python>
- SciPy BSD-3-Clause：<https://github.com/scipy/scipy>
