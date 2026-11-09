const orig = process.emitWarning.bind(process);
process.emitWarning = (warning, ...args) => {
  const text = typeof warning === 'string' ? warning : (warning && warning.message) || '';
  if (String(text).includes('SQLite is an experimental')) return;
  return orig(warning, ...args);
};
