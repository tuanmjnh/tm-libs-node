// build.mjs
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { execSync } from "child_process"; // 👈 Thêm để chạy lệnh tsc

const require = createRequire(import.meta.url);
// ❌ Loại bỏ npm-dts: const { Generator } = require("npm-dts");

const pkg = JSON.parse(fs.readFileSync("./package.json", "utf8"));
const { dependencies = {} } = pkg;

// 🧹 Xóa dist cũ
if (fs.existsSync("./dist")) {
  fs.rmSync("./dist", { recursive: true, force: true });
  console.log("🧹 Removed old dist folder");
}

const sharedConfig = {
  bundle: true,
  minify: true,
  sourcemap: false,
  target: "esnext",
  platform: "node", // 👈 FIX 1: Đổi sang "node"
  format: "esm",
  external: Object.keys(dependencies),
};

// 📦 Build từng file .ts
async function buildFile(entry) {
  const srcPath = `src/${entry}.ts`;
  if (!fs.existsSync(srcPath)) return;

  const outFile = `dist/${entry}.js`;
  console.log(`📦 Building: ${entry}.ts`);

  await build({
    ...sharedConfig,
    entryPoints: [srcPath],
    outfile: outFile,
  });

  console.log(`✅ Built: ${entry}.js`);
}

// 📂 Quét toàn bộ file .ts trong src/
function getSourceFiles() {
  return fs
    .readdirSync("./src")
    .filter((f) => f.endsWith(".ts"))
    .map((f) => f.replace(/\.ts$/, ""));
}

// 🧩 Build toàn bộ
async function buildAll() {
  fs.mkdirSync("./dist", { recursive: true });

  const libs = getSourceFiles();

  // 🏗 Build từng file riêng
  for (const lib of libs) {
    await buildFile(lib);
  }

  // 🧱 Bỏ qua việc tạo index.js & index.d.ts tự động
  generateIndexFile(libs);

  // 📝 Cập nhật package.json
  updatePackageJson();

  // ⚙️ FIX 2: Tạo tất cả file .d.ts bằng TSC
  console.log("⚙️ Generating declaration files (.d.ts) with TSC...");
  execSync("tsc --emitDeclarationOnly", { stdio: "inherit" });
  console.log("✅ Declarations generated successfully.");

  // 📝 FIX 3: Copy package.json vào dist cho lệnh publish:lib
  // fs.copyFileSync("./package.json", "./dist/package.json");
  // console.log("📋 Copied package.json to dist/");
  // (Bạn có thể thêm copy README.md tại đây nếu cần)

  console.log("🎉 Build hoàn tất!");
}

// 🧱 Tạo index.js và index.d.ts (Bây giờ chỉ là một hàm ghi log)
function generateIndexFile(modules) {
  // ❌ Không tạo index.js và index.d.ts nữa
  console.log("👉 Bỏ qua việc tạo index.js & index.d.ts");
}

// 📝 Cập nhật package.json (Xóa main/module/types)
function updatePackageJson() {
  const pkgPath = "./package.json";
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

  pkg.files = ["dist", "README.md"];
  // ❌ Xóa các trường này
  delete pkg.main;
  delete pkg.module;
  delete pkg.types;

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  console.log("📦 Updated package.json (Removed main/module/types)");
}

// 🐪 camelCase helper
function camelCase(str) {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// 🚀 Run
await buildAll();