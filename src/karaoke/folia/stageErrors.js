export function routeReactStageError({
  error,
  ready,
  destroyed,
  onReadyError,
  onRuntimeError,
}) {
  if (destroyed) return false;
  const report = ready ? onRuntimeError : onReadyError;
  if (typeof report !== 'function') return false;
  report(error);
  return true;
}
