export function isPythonCancellationExitCode(code: number | null): boolean {
  return code === 130
}
