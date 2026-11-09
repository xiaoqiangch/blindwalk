/**
 * Node 测试用的最小类型声明。
 *
 * tsconfig.test.json 设了 `"types": []`（不依赖 @types/node，保证逻辑层不混入 Node 类型），
 * 这里只补测试真正用到的 node:assert / console / process 三样。
 */
declare module 'node:assert/strict' {
  interface AssertStrict {
    (value: unknown, message?: string): void;
    ok(value: unknown, message?: string): void;
    equal(actual: unknown, expected: unknown, message?: string): void;
    strictEqual(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    deepStrictEqual(actual: unknown, expected: unknown, message?: string): void;
    match(value: string, regexp: RegExp, message?: string): void;
    throws(block: () => void, message?: string): void;
  }
  const assert: AssertStrict;
  export default assert;
}

declare const console: {
  log(...args: string[]): void;
};

declare const process: {
  exitCode: number;
};
