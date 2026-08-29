// node --import ./tests/setup/register.mjs で読み込む。
// モジュール解決フック（alias-loader.mjs）を登録して、テストから Next.js のコードを素の Node で import できるようにする。
import { register } from "node:module";

register("./alias-loader.mjs", import.meta.url);
