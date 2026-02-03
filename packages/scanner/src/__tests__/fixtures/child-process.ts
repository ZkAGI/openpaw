// Test fixture for child_process import detection
import * as cp from 'child_process';

export function spawn(cmd: string) {
  return cp.spawn(cmd);
}
