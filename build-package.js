import { copyFileSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "cesium-wind-layer-3d");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "dist"), { recursive: true });
mkdirSync(join(OUT, "types"), { recursive: true });

// 打包产物
for (const f of ["cesium-wind-layer-3d.js", "cesium-wind-layer-3d.cjs"]) {
  copyFileSync(join(__dirname, "dist", f), join(OUT, "dist", f));
}

// 类型声明（package.json 的 types 字段指向它）
copyFileSync(join(__dirname, "types/index.d.ts"), join(OUT, "types/index.d.ts"));

// 文档与许可证
for (const f of ["readme.md", "README.en.md", "LICENSE"]) {
  copyFileSync(join(__dirname, f), join(OUT, f));
}

// 发布用 package.json：剔除开发期字段
const pkg = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8"));
delete pkg.scripts;
delete pkg.devDependencies;
pkg.files = ["dist", "types", "readme.md", "README.en.md", "LICENSE"];
writeFileSync(join(OUT, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

console.log(`✅ 发布包已生成：cesium-wind-layer-3d/  (v${pkg.version})`);
console.log("   cd cesium-wind-layer-3d && npm publish");
