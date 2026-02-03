// Test fixture for dynamic require detection
export function loadModule(moduleName: string) {
  return require(moduleName);
}

export function loadModuleFromVar() {
  const name = 'fs';
  return require(name);
}
