// Test fixture for exec detection
import { exec, execSync } from 'child_process';

export function runCommand(cmd: string) {
  exec(cmd, (error, stdout, stderr) => {
    console.log(stdout);
  });
}

export function runCommandSync(cmd: string) {
  return execSync(cmd);
}
