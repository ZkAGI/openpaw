// Test fixture for eval() detection
export function dangerousEval(code: string) {
  return eval(code);
}
