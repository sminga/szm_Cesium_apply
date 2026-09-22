# data

风场数据入口。`netcdfLoader.js` 读取 NetCDF-3、识别 U/V/W 和坐标变量并统一网格顺序；`weightedParticleSampler.js` 根据风速权重和当前高度范围生成初始粒子。

