// scripts/lib/ts-resolve-hook.mjs
// ESM 解析钩子：让 Node 能用小程序源码的风格直接 import TS 文件。
//
// 背景：微信小程序是经过编译器打包的，源码里写 import './utils/x' 不带扩展名即可；
// 但 Node 的 ESM 解析器要求路径完整。与其为了跑单测去改业务源码的 import 风格
// （那样编辑器里能跑，真机上反而容易踩坑），不如在测试侧补一个 resolve 钩子：
// 遇到没有扩展名的相对路径，自动补 .ts 后再交给默认解析器。
import path from 'node:path';

export async function resolve(specifier, context, nextResolve) {
  const isBareRelative = specifier.startsWith('./') || specifier.startsWith('../');
  if (isBareRelative && !path.extname(specifier)) {
    try {
      return await nextResolve(specifier + '.ts', context);
    } catch (e) {
      return nextResolve(specifier, context);
    }
  }
  return nextResolve(specifier, context);
}
