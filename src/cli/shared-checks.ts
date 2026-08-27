let passed = 0;
let failed = 0;

export function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    process.stdout.write(`PASS  ${label}\n`);
  } else {
    failed += 1;
    process.stdout.write(`FAIL  ${label}${detail ? ` :: ${detail}` : ""}\n`);
  }
}

export function report(): void {
  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}
