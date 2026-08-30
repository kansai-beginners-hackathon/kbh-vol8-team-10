/**
 * node --test 用のモジュール解決フック。
 *
 *  1. `@/lib/foo` のような tsconfig の paths エイリアスをリポジトリルートに解決する
 *     （app/api/return-home/route.ts が `@/lib/return-home` を import している）
 *  2. 拡張子なしの `@/lib/foo` を `.ts` に補完する（Next のバンドラは補完するが Node はしない）
 *  3. `import x from "./x.json"` に `with { type: "json" }` を補う
 *     （lib/return-home.ts は属性なしで JSON を import しており、Node ESM はそのままだと ERR_IMPORT_ATTRIBUTE_MISSING）
 *  4. `next/server` のように exports マップの無いパッケージ内パスで拡張子が省かれているとき `.js` を補う
 *
 * アプリ本体のコードは触らず、テスト実行時だけ Next.js のバンドラと同じ解決に寄せるのが目的。
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".json"];

function completeExtension(absPath) {
  if (path.extname(absPath) && existsSync(absPath)) return absPath;
  for (const ext of EXTENSIONS) {
    if (existsSync(absPath + ext)) return absPath + ext;
  }
  for (const ext of EXTENSIONS) {
    const index = path.join(absPath, `index${ext}`);
    if (existsSync(index)) return index;
  }
  return absPath;
}

export async function resolve(specifier, context, nextResolve) {
  let target = specifier;
  if (specifier.startsWith("@/")) {
    target = pathToFileURL(completeExtension(path.join(ROOT, specifier.slice(2)))).href;
  }

  let result;
  try {
    result = await nextResolve(target, context);
  } catch (e) {
    // bare specifier（next/server など）で拡張子が省かれている → .js を補って 1 度だけやり直す
    const bare = !target.startsWith(".") && !target.startsWith("/") && !target.startsWith("file:");
    if (e?.code === "ERR_MODULE_NOT_FOUND" && bare && !path.extname(target)) {
      result = await nextResolve(`${target}.js`, context);
    } else {
      throw e;
    }
  }

  if (result.url.endsWith(".json") && !context.importAttributes?.type) {
    return { ...result, format: "json", importAttributes: { ...context.importAttributes, type: "json" } };
  }
  return result;
}
